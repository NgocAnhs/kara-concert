begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- SET ROLE executes the statement with the real role, not a mocked JWT claim.
create function pg_temp.as_role(role_name text, statement text) returns void
language plpgsql as $$
begin
  execute format('set local role %I', role_name);
  execute statement;
  reset role;
end;
$$;

select ok(not has_function_privilege('anon', 'public.consume_access_attempt(text)', 'EXECUTE'), 'anon cannot execute access RPC');
select ok(not has_function_privilege('authenticated', 'public.consume_access_attempt(text)', 'EXECUTE'), 'authenticated cannot execute access RPC');
select ok(has_function_privilege('service_role', 'public.consume_access_attempt(text)', 'EXECUTE'), 'service_role can execute access RPC');
select throws_ok(format('select pg_temp.as_role(%L, %L)', role_name,
  'select * from public.consume_access_attempt(''permission-test'')'), '42501', null,
  role_name || ' RPC call actually denied')
from unnest(array['anon', 'authenticated']) role_name;
select lives_ok($$select pg_temp.as_role('service_role', 'select * from public.consume_access_attempt(''backend-test'')')$$,
  'backend RPC call succeeds');

select ok(c.relrowsecurity, c.relname || ' has RLS enabled')
from pg_class c join pg_namespace n on c.relnamespace = n.oid
where n.nspname = 'public' and c.relname in ('import_jobs', 'import_attempts', 'access_attempts', 'youtube_metadata', 'import_runtime');
select is((select count(*) from pg_policies where schemaname = 'public'
  and tablename in ('import_jobs', 'import_attempts', 'access_attempts', 'youtube_metadata', 'import_runtime')), 0::bigint,
  'internal tables have no client policies');

select throws_ok(format('select pg_temp.as_role(%L, %L)', role_name, statement), '42501', null,
  role_name || ' denied ' || operation || ' on ' || table_name)
from unnest(array['anon', 'authenticated']) role_name
cross join unnest(array['import_jobs', 'import_attempts', 'access_attempts', 'youtube_metadata', 'import_runtime']) table_name
cross join lateral (values
  ('select', format('select * from public.%I', table_name)),
  ('insert', format('insert into public.%I default values', table_name)),
  ('update', format('update public.%I set %I = %I', table_name,
    case when table_name = 'youtube_metadata' then 'video_id' when table_name = 'access_attempts' then 'ip_hash'
      when table_name = 'import_attempts' then 'job_id' else 'id' end,
    case when table_name = 'youtube_metadata' then 'video_id' when table_name = 'access_attempts' then 'ip_hash'
      when table_name = 'import_attempts' then 'job_id' else 'id' end)),
  ('delete', format('delete from public.%I', table_name))
) operations(operation, statement);

select lives_ok($$select pg_temp.as_role('service_role', 'insert into public.access_attempts(ip_hash) values (''backend-write'')')$$,
  'backend can write internal storage');
select lives_ok($$select pg_temp.as_role('service_role', 'select * from public.import_runtime')$$,
  'backend can read internal storage');

insert into public.songs(id, title, youtube_url, status) values
  ('10000000-0000-0000-0000-000000000001', 'Existing manual published', 'https://youtu.be/legacy', 'published'),
  ('10000000-0000-0000-0000-000000000002', 'Existing manual draft', 'https://youtu.be/legacy-draft', 'draft');
insert into public.lyric_lines(song_id, korean, romanization, meaning, display_order, start_seconds, end_seconds) values
  ('10000000-0000-0000-0000-000000000001', '원문 English', 'original English', 'original meaning', 0, 0, 1),
  ('10000000-0000-0000-0000-000000000002', '비공개', 'draft', 'draft', 0, 0, 1);

-- The SELECT is evaluated as anon, and a mismatched result raises in that role.
select lives_ok($test$select pg_temp.as_role('anon', $sql$
  do $body$ begin
    if (select count(*) from public.songs where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')) <> 1 then
      raise exception 'manual catalog visibility changed';
    end if;
    if not exists(select 1 from public.songs where id = '10000000-0000-0000-0000-000000000001' and title = 'Existing manual published' and source = 'manual') then
      raise exception 'manual published song changed';
    end if;
    if (select count(*) from public.lyric_lines where song_id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002')) <> 1 then
      raise exception 'manual lyric visibility changed';
    end if;
    if not exists(select 1 from public.lyric_lines where song_id = '10000000-0000-0000-0000-000000000001' and korean = '원문 English' and romanization = 'original English') then
      raise exception 'manual lyrics changed';
    end if;
  end $body$;
$sql$)$test$, 'manual published song/lyrics remain readable, draft stays hidden, contents preserved');

select ok(not has_table_privilege('service_role', 'public.import_jobs', 'TRUNCATE'), 'backend has no unnecessary truncate privilege');

select * from finish();
rollback;
