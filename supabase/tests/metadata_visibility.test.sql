begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.as_role(role_name text, statement text) returns void
language plpgsql as $$
begin
  execute format('set local role %I', role_name);
  execute statement;
  reset role;
end;
$$;

insert into public.songs(id, title, youtube_url, status, youtube_video_id, source, needs_reprocess) values
  ('71000000-0000-4000-8000-000000000001', 'manual published', 'https://youtu.be/manual', 'published', null, 'manual', false),
  ('71000000-0000-4000-8000-000000000002', 'manual draft', 'https://youtu.be/manual-draft', 'draft', null, 'manual', false),
  ('71000000-0000-4000-8000-000000000003', 'ai fresh', 'https://youtu.be/aaaaaaaaaaa', 'published', 'aaaaaaaaaaa', 'ai', false),
  ('71000000-0000-4000-8000-000000000004', 'ai stale', 'https://youtu.be/bbbbbbbbbbb', 'published', 'bbbbbbbbbbb', 'ai', false),
  ('71000000-0000-4000-8000-000000000005', 'ai missing', 'https://youtu.be/ccccccccccc', 'published', 'ccccccccccc', 'ai', false),
  ('71000000-0000-4000-8000-000000000006', 'ai reprocess', 'https://youtu.be/ddddddddddd', 'published', 'ddddddddddd', 'ai', true),
  ('71000000-0000-4000-8000-000000000007', 'ai private', 'https://youtu.be/eeeeeeeeeee', 'published', 'eeeeeeeeeee', 'ai', false),
  ('71000000-0000-4000-8000-000000000008', 'ai draft', 'https://youtu.be/fffffffffff', 'draft', 'fffffffffff', 'ai', false);

insert into public.youtube_metadata(video_id, title, duration_seconds, is_public, embeddable, is_live, playable, fetched_at, expires_at) values
  ('aaaaaaaaaaa', 'private title fresh', 200, true, true, false, true, clock_timestamp(), clock_timestamp() + interval '1 day'),
  ('bbbbbbbbbbb', 'private title stale', 200, true, true, false, true, clock_timestamp() - interval '30 days', clock_timestamp() - interval '1 second'),
  ('ddddddddddd', 'private title reprocess', 200, true, true, false, true, clock_timestamp(), clock_timestamp() + interval '1 day'),
  ('eeeeeeeeeee', 'private title unavailable', 200, false, true, false, false, clock_timestamp(), clock_timestamp() + interval '1 day'),
  ('fffffffffff', 'private title draft', 200, true, true, false, true, clock_timestamp(), clock_timestamp() + interval '1 day');

insert into public.lyric_lines(song_id, korean, display_order, start_seconds, end_seconds)
select id, title || ' lyric', 0, 0, 1 from public.songs where id::text like '71000000-%';

select ok(not exists(select 1 from pg_policies where schemaname = 'public' and policyname in
  ('anon reads published songs', 'anon reads lines for published songs')), 'permissive legacy policies were replaced');
select ok(has_function_privilege('anon', 'public.can_read_imported_song(uuid)', 'EXECUTE'), 'anon may execute only the visibility predicate');
select ok(not has_function_privilege('authenticated', 'public.can_read_imported_song(uuid)', 'EXECUTE'), 'authenticated is not granted the visibility predicate');
select ok(not has_function_privilege('authenticator', 'public.can_read_imported_song(uuid)', 'EXECUTE'), 'authenticator cannot inherit visibility predicate execution from PUBLIC');

select lives_ok($test$select pg_temp.as_role('anon', $sql$
  do $body$ begin
    if (select array_agg(title order by title) from public.songs where id::text like '71000000-%')
       is distinct from array['ai fresh', 'manual published']::text[] then
      raise exception 'song RLS visibility mismatch';
    end if;
    if (select array_agg(korean order by korean) from public.lyric_lines where song_id::text like '71000000-%')
       is distinct from array['ai fresh lyric', 'manual published lyric']::text[] then
      raise exception 'nested lyric RLS visibility mismatch';
    end if;
  end $body$;
$sql$)$test$, 'manual published and fresh playable AI song/lyrics are readable; draft, stale, missing and reprocess are hidden');

select throws_ok($$select pg_temp.as_role('anon', 'select * from public.youtube_metadata')$$,
  '42501', null, 'visibility helper does not expose private metadata');
select * from finish();
rollback;
