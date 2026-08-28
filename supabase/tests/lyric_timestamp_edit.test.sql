begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.songs(id, title, youtube_url, status) values
  ('30000000-0000-4000-8000-000000000001', 'Timestamp edit test', 'https://youtu.be/timestamp', 'published');
insert into public.lyric_lines(id, song_id, korean, display_order, start_seconds, end_seconds) values
  ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '첫 줄', 0, 1, 3),
  ('31000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '둘째 줄', 1, 4, 6),
  ('31000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', '셋째 줄', 2, 7, 9);

select ok(not has_function_privilege('anon', 'public.update_lyric_timestamps(uuid, jsonb)', 'EXECUTE'), 'anon cannot update lyric timestamps');
select ok(has_function_privilege('service_role', 'public.update_lyric_timestamps(uuid, jsonb)', 'EXECUTE'), 'service role can update lyric timestamps');
select is(
  public.update_lyric_timestamps('30000000-0000-4000-8000-000000000001', $$[
    {"id":"31000000-0000-4000-8000-000000000001","start_seconds":2,"end_seconds":4},
    {"id":"31000000-0000-4000-8000-000000000002","start_seconds":5,"end_seconds":7},
    {"id":"31000000-0000-4000-8000-000000000003","start_seconds":8,"end_seconds":10}
  ]$$::jsonb), true, 'moves both timestamp boundaries atomically');
select is((select start_seconds from public.lyric_lines where id = '31000000-0000-4000-8000-000000000002'), 5::numeric, 'new start timestamp is stored');
select is((select end_seconds from public.lyric_lines where id = '31000000-0000-4000-8000-000000000002'), 7::numeric, 'new end timestamp is stored');
select is(
  public.update_lyric_timestamps('30000000-0000-4000-8000-000000000001', $$[
    {"id":"31000000-0000-4000-8000-000000000001","start_seconds":2,"end_seconds":4},
    {"id":"31000000-0000-4000-8000-000000000002","start_seconds":2,"end_seconds":7},
    {"id":"31000000-0000-4000-8000-000000000003","start_seconds":8,"end_seconds":10}
  ]$$::jsonb), false, 'rejects duplicate start timestamps');
select is(
  public.update_lyric_timestamps('30000000-0000-4000-8000-000000000001', $$[
    {"id":"31000000-0000-4000-8000-000000000001","start_seconds":2,"end_seconds":5},
    {"id":"31000000-0000-4000-8000-000000000002","start_seconds":4,"end_seconds":7},
    {"id":"31000000-0000-4000-8000-000000000003","start_seconds":8,"end_seconds":10}
  ]$$::jsonb), true, 'allows a one-second overlap between adjacent lyric ranges');
select is(
  public.update_lyric_timestamps('30000000-0000-4000-8000-000000000001', $$[
    {"id":"31000000-0000-4000-8000-000000000001","start_seconds":1,"end_seconds":100},
    {"id":"31000000-0000-4000-8000-000000000002","start_seconds":2,"end_seconds":3},
    {"id":"31000000-0000-4000-8000-000000000003","start_seconds":4,"end_seconds":5}
  ]$$::jsonb), false, 'rejects an adjacent overlap longer than one second');
select is(
  public.update_lyric_timestamps('30000000-0000-4000-8000-000000000001', $$[
    {"id":"31000000-0000-4000-8000-000000000001","start_seconds":1,"end_seconds":10},
    {"id":"31000000-0000-4000-8000-000000000002","start_seconds":9,"end_seconds":10},
    {"id":"31000000-0000-4000-8000-000000000003","start_seconds":9.5,"end_seconds":11}
  ]$$::jsonb), false, 'rejects overlap between non-adjacent lyric ranges');

select * from finish();
rollback;
