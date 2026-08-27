begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.metadata(video_id text, duration_seconds integer, observed_at timestamptz default clock_timestamp())
returns jsonb language sql as $$
  select jsonb_build_object('videoId', video_id, 'title', 'refreshed title',
    'durationSeconds', duration_seconds, 'isPublic', true, 'embeddable', true,
    'isLive', false, 'playable', true, 'fetchedAt', observed_at,
    'expiresAt', observed_at + interval '30 days')
$$;

select ok(has_function_privilege('service_role', 'public.begin_maintenance()', 'EXECUTE'), 'service role can begin maintenance');
select ok(not has_function_privilege('anon', 'public.begin_maintenance()', 'EXECUTE'), 'anon cannot begin maintenance');
select ok(not has_function_privilege('authenticated', 'public.cleanup_import_data(uuid)', 'EXECUTE'), 'authenticated cannot run cleanup');
select ok(not has_function_privilege('authenticator', 'public.apply_metadata_refresh(uuid,jsonb)', 'EXECUTE'), 'authenticator cannot inherit refresh execution from PUBLIC');

insert into public.songs(id, title, youtube_url, status, youtube_video_id, source) values
 ('72000000-0000-4000-8000-000000000001', 'day 24', 'https://youtu.be/aaaaaaaaaaa', 'published', 'aaaaaaaaaaa', 'ai'),
 ('72000000-0000-4000-8000-000000000002', 'day 25', 'https://youtu.be/bbbbbbbbbbb', 'published', 'bbbbbbbbbbb', 'ai'),
 ('72000000-0000-4000-8000-000000000003', 'day 29', 'https://youtu.be/ccccccccccc', 'published', 'ccccccccccc', 'ai'),
 ('72000000-0000-4000-8000-000000000004', 'day 30', 'https://youtu.be/ddddddddddd', 'published', 'ddddddddddd', 'ai'),
 ('72000000-0000-4000-8000-000000000005', 'duration', 'https://youtu.be/eeeeeeeeeee', 'published', 'eeeeeeeeeee', 'ai');
insert into public.youtube_metadata(video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at) values
 ('aaaaaaaaaaa','24',200,true,true,false,true,clock_timestamp()-interval '24 days',clock_timestamp()+interval '6 days'),
 ('bbbbbbbbbbb','25',200,true,true,false,true,clock_timestamp()-interval '25 days 1 second',clock_timestamp()+interval '4 days'),
 ('ccccccccccc','29',200,true,true,false,true,clock_timestamp()-interval '29 days 1 second',clock_timestamp()+interval '23 hours'),
 ('ddddddddddd','30',200,true,true,false,true,clock_timestamp()-interval '30 days',clock_timestamp()+interval '1 hour'),
 ('eeeeeeeeeee','duration',200,true,true,false,true,clock_timestamp()-interval '25 days 2 seconds',clock_timestamp()+interval '4 days');

insert into public.import_jobs(id,video_id,status,stage,admitted_at,deadline_at)
values ('72000000-0000-4000-8000-000000000010','zzzzzzzzzzz','failed','failed',clock_timestamp()-interval '8 days',clock_timestamp()-interval '8 days');
insert into public.import_attempts(job_id,admitted_at) values
 ('72000000-0000-4000-8000-000000000010',clock_timestamp()-interval '8 days');
insert into public.access_attempts(ip_hash,attempted_at) values ('old-access',clock_timestamp()-interval '25 hours');

create temp table maintenance_lease as select * from public.begin_maintenance();
select is((select count(*) from maintenance_lease), 1::bigint, 'first runner acquires the maintenance lease');
select is((select count(*) from public.begin_maintenance()), 0::bigint, 'concurrent runner cannot acquire the lease');
create temp table due_metadata as
  select * from public.cleanup_import_data((select lease_token from maintenance_lease));

select is((select array_agg(video_id) from due_metadata),
  array['eeeeeeeeeee','bbbbbbbbbbb']::text[], 'refresh starts after day 25 and returns the oldest eligible metadata first');
select ok(exists(select 1 from public.youtube_metadata where video_id='aaaaaaaaaaa'), 'day 24 metadata remains cached');
select ok(not exists(select 1 from public.youtube_metadata where video_id in ('ccccccccccc','ddddddddddd')), 'day 29 and day 30 metadata are deleted');
select ok((select bool_and(needs_reprocess) from public.songs where youtube_video_id in ('ccccccccccc','ddddddddddd')),
  'metadata deletion atomically makes affected AI songs require reprocessing');
select is((select count(*) from public.import_jobs where id='72000000-0000-4000-8000-000000000010'), 0::bigint, 'jobs and attempts older than seven days are purged');
select is((select count(*) from public.access_attempts where ip_hash='old-access'), 0::bigint, 'access attempts older than 24 hours are purged');

select ok(public.apply_metadata_refresh((select lease_token from maintenance_lease),
  pg_temp.metadata('eeeeeeeeeee', 201)), 'fresh maintenance observation applies');
select ok((select needs_reprocess from public.songs where youtube_video_id='eeeeeeeeeee'), 'duration change sets sticky reprocess');
select ok((select needs_reprocess from public.songs where youtube_video_id='eeeeeeeeeee'), 'metadata refresh never clears sticky reprocess');
select ok(public.mark_metadata_unavailable((select lease_token from maintenance_lease), 'bbbbbbbbbbb'), 'known unavailable observation is recorded');
select ok(not (select playable from public.youtube_metadata where video_id='bbbbbbbbbbb'), 'known unavailable only marks cached metadata unplayable');
select is((select fetched_at from public.youtube_metadata where video_id='bbbbbbbbbbb'),
  (select fetched_at from public.youtube_metadata where video_id='bbbbbbbbbbb'), 'unavailable path does not extend fetched timestamp');

select ok(public.finish_maintenance((select lease_token from maintenance_lease)), 'heartbeat completes only after every due item was handled');
select ok((select maintenance_completed_at is not null from public.import_runtime where id=1), 'completed maintenance updates heartbeat');
select ok(not public.apply_metadata_refresh((select lease_token from maintenance_lease), pg_temp.metadata('aaaaaaaaaaa',200)),
  'completed lease cannot apply a late response');

create temp table completed_heartbeat as
  select maintenance_completed_at from public.import_runtime where id = 1;
insert into public.youtube_metadata(video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at)
select 'z' || lpad(value::text, 10, '0'), 'retention backlog', 60, true, true, false, false,
  clock_timestamp() - interval '29 days' - value * interval '1 second',
  clock_timestamp() - interval '28 days' - value * interval '1 second'
from generate_series(1, 101) value;
create temp table backlog_lease as select * from public.begin_maintenance();
select * from public.cleanup_import_data((select lease_token from backlog_lease));
select is((select count(*) from public.youtube_metadata where video_id like 'z%'), 1::bigint,
  'retention cleanup processes a fixed oldest-first batch and leaves backlog for the next lease');
select ok(not public.finish_maintenance((select lease_token from backlog_lease)),
  'retention backlog prevents a false healthy heartbeat even when no playable refresh is due');
select is((select maintenance_completed_at from public.import_runtime where id = 1),
  (select maintenance_completed_at from completed_heartbeat), 'incomplete retention cleanup preserves the prior heartbeat');
create temp table continuation_lease as select * from public.begin_maintenance();
select * from public.cleanup_import_data((select lease_token from continuation_lease));
select is((select count(*) from public.youtube_metadata where video_id like 'z%'), 0::bigint,
  'the following lease continues and finishes the retention backlog');
select ok(public.finish_maintenance((select lease_token from continuation_lease)),
  'heartbeat succeeds after the continuation lease handles the remaining retention work');

insert into public.youtube_metadata(video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at)
values ('yyyyyyyyyyy', 'deadline cache', 60, true, true, false, false,
  clock_timestamp() - interval '30 days', clock_timestamp() - interval '29 days');
create temp table deadline_lease as select * from public.begin_maintenance();
update public.import_runtime set maintenance_deadline_at = clock_timestamp() - interval '1 second' where id = 1;
select is((select count(*) from public.cleanup_import_data((select lease_token from deadline_lease))), 0::bigint,
  'expired database lease prevents retention cleanup before rows are locked');
select ok(exists(select 1 from public.youtube_metadata where video_id = 'yyyyyyyyyyy'),
  'expired maintenance lease leaves retained metadata untouched');
select ok(not public.finish_maintenance((select lease_token from deadline_lease)),
  'expired maintenance lease cannot publish a heartbeat');

update public.import_runtime set maintenance_lease_token=gen_random_uuid(), maintenance_deadline_at=clock_timestamp()-interval '1 second';
select ok(not public.mark_metadata_unavailable((select maintenance_lease_token from public.import_runtime where id=1),'aaaaaaaaaaa'),
  'expired lease cannot mutate metadata');

select * from finish();
rollback;
