begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create function pg_temp.metadata(video_id text, duration_seconds integer, observed_at timestamptz default clock_timestamp())
returns jsonb language sql as $$
  select jsonb_build_object(
    'videoId', video_id, 'title', 'Private cached YouTube title',
    'durationSeconds', duration_seconds, 'isPublic', true, 'embeddable', true,
    'isLive', false, 'playable', true, 'fetchedAt', observed_at,
    'expiresAt', observed_at + interval '25 days'
  )
$$;
create function pg_temp.song(title text default 'Generated application title', second_line text default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'title', title, 'aiModel', 'gemini-test', 'promptVersion', 'youtube-auto-import-v1',
    'lines', case when second_line is null then jsonb_build_array(
      jsonb_build_object('text','안녕 English','vietHan','an-nhơng English','romanization','annyeong English','meaning','Xin chào','start',0,'end',2)
    ) else jsonb_build_array(
      jsonb_build_object('text','첫 줄','vietHan','chot chul','romanization','cheot jul','meaning','Dòng đầu','start',0,'end',1),
      jsonb_build_object('text',second_line,'vietHan','rollback','romanization','rollback','meaning','Rollback','start',1,'end',2)
    ) end
  )
$$;

select ok(to_regclass('public.import_jobs_one_active_video_idx') is not null,
  'partial active-video uniqueness index exists');
select ok((select indisunique and indpred is not null from pg_index
  where indexrelid='public.import_jobs_one_active_video_idx'::regclass),
  'active-video index is unique and partial');

select ok(not has_function_privilege(role_name, signature, 'EXECUTE'), role_name || ' cannot execute ' || signature)
from unnest(array['anon','authenticated']) role_name
cross join unnest(array[
  'public.admit_import(text)',
  'public.advance_import(uuid,uuid,text)',
  'public.fail_import(uuid,uuid,text)',
  'public.complete_import(uuid,uuid,jsonb,jsonb)',
  'public.complete_cached_import(uuid,uuid,jsonb)',
  'public.read_import(uuid)'
]) signature;
select ok(has_function_privilege('service_role', signature, 'EXECUTE'), 'service_role can execute ' || signature)
from unnest(array[
  'public.admit_import(text)',
  'public.advance_import(uuid,uuid,text)',
  'public.fail_import(uuid,uuid,text)',
  'public.complete_import(uuid,uuid,jsonb,jsonb)',
  'public.complete_cached_import(uuid,uuid,jsonb)',
  'public.read_import(uuid)'
]) signature;
select ok(has_table_privilege('service_role', table_name, privilege),
  'service_role has catalog ' || privilege || ' on ' || table_name)
from unnest(array['public.songs','public.lyric_lines']) table_name
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege;

create function pg_temp.as_role(role_name text, statement text) returns void
language plpgsql as $$ begin
  execute format('set local role %I', role_name);
  execute statement;
  reset role;
end $$;
select throws_ok(format('select pg_temp.as_role(%L, %L)', role_name,
  'select * from public.admit_import(''aaaaaaaaaaa'')'), '42501', null,
  role_name || ' admission is actually denied')
from unnest(array['anon','authenticated']) role_name;
select lives_ok($$select pg_temp.as_role('service_role', 'select * from public.admit_import(''aaaaaaaaaaa'')')$$,
  'service_role admission actually executes');

update public.import_runtime set maintenance_completed_at = clock_timestamp() where id = 1;

insert into public.songs(id,title,youtube_url,status,youtube_video_id,source)
values
  ('51000000-0000-4000-8000-000000000001','Manual published','https://youtu.be/manual00001','published','manual00001','manual'),
  ('51000000-0000-4000-8000-000000000002','Manual draft','https://youtu.be/draft000001','draft','draft000001','manual'),
  ('51000000-0000-4000-8000-000000000003','AI cached','https://youtu.be/aicached001','published','aicached001','ai');
insert into public.youtube_metadata(video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at)
values ('aicached001','YouTube cache',60,true,true,false,true,clock_timestamp(),clock_timestamp()+interval '25 days');

select results_eq($$select kind from public.admit_import('manual00001')$$, array['cached'::text],
  'manual published song is cached');
select results_eq($$select kind from public.admit_import('aicached001')$$, array['cached'::text],
  'fresh playable AI song is cached');
insert into public.import_jobs(id,video_id,status,stage,lease_token,deadline_at)
values ('50000000-0000-4000-8000-000000000001','aicached001','checking_video','checking_video',gen_random_uuid(),clock_timestamp()-interval '1 second');
select results_eq($$select kind from public.admit_import('aicached001')$$, array['cached'::text],
  'cache remains available while admission reclaims an expired worker');
select is((select status from public.import_jobs where id='50000000-0000-4000-8000-000000000001'), 'expired',
  'admission reclaims expired jobs even on a cache hit');
select results_eq($$select error_code from public.admit_import('draft000001')$$, array['VIDEO_UNAVAILABLE'::text],
  'draft song is blocked');
select is((select count(*) from public.import_attempts), 0::bigint, 'cached and draft results consume no attempts');

create temporary table first_admission as select * from public.admit_import('newvideo001');
select results_eq('select kind from first_admission', array['created'::text], 'new request creates a job');
select ok((select lease_token is not null from first_admission), 'created job gets a lease token');
select ok((select deadline_at between clock_timestamp()+interval '238 seconds' and clock_timestamp()+interval '241 seconds' from first_admission),
  'deadline is 240 seconds from database admission time');
select is((select count(*) from public.import_attempts), 1::bigint, 'job and attempt commit together');
select is((select kind from public.admit_import('newvideo001')), 'existing', 'same active video returns existing job');
select is((select count(*) from public.import_attempts), 1::bigint, 'existing job does not consume quota');
select throws_ok($$insert into public.import_jobs(video_id,status,stage,lease_token,deadline_at)
  values ('newvideo001','checking_video','checking_video',gen_random_uuid(),clock_timestamp()+interval '1 minute')$$,
  '23505', null, 'partial unique index rejects a second active job');

select is(public.advance_import((select job_id from first_admission), gen_random_uuid(), 'transcribing'), false,
  'wrong lease cannot advance');
select is(public.advance_import((select job_id from first_admission), (select lease_token from first_admission), 'enriching'), false,
  'stage cannot be skipped');
select is(public.advance_import((select job_id from first_admission), (select lease_token from first_admission), 'transcribing'), true,
  'valid lease advances one stage');
select is(public.advance_import((select job_id from first_admission), (select lease_token from first_admission), 'transcribing'), false,
  'stage cannot move backward or repeat');
select throws_ok($$select public.advance_import((select job_id from first_admission), (select lease_token from first_admission), 'completed')$$,
  '22023', 'INVALID_IMPORT_STAGE', 'caller cannot name a terminal stage');
select lives_ok($$select public.fail_import((select job_id from first_admission), gen_random_uuid(), 'WRONG_LEASE')$$,
  'stale fail is a no-op');
select is((select status from public.import_jobs where id=(select job_id from first_admission)), 'transcribing',
  'stale fail leaves active job unchanged');
select lives_ok($$select public.fail_import((select job_id from first_admission), (select lease_token from first_admission), 'PROVIDER_TRANSIENT')$$,
  'valid lease can fail an active job');
select is((select status from public.import_jobs where id=(select job_id from first_admission)), 'failed',
  'failure becomes terminal');
select lives_ok($$select public.fail_import((select job_id from first_admission), (select lease_token from first_admission), 'SECOND_FAILURE')$$,
  'terminal fail is a no-op');
select is((select error_code from public.import_jobs where id=(select job_id from first_admission)), 'PROVIDER_TRANSIENT',
  'terminal job is never rewritten');

create temporary table retry_admission as select * from public.admit_import('newvideo001');
select isnt((select job_id from retry_admission), (select job_id from first_admission), 'retry creates a new job ID');
select isnt((select lease_token from retry_admission), (select lease_token from first_admission), 'retry creates a new lease token');
select public.fail_import((select job_id from retry_admission), (select lease_token from retry_admission), 'TEST_DONE');

create temporary table expiring_admission as select * from public.admit_import('expire00001');
update public.import_jobs set deadline_at = clock_timestamp()-interval '1 second'
where id=(select job_id from expiring_admission);
select is((select status from public.read_import((select job_id from expiring_admission))), 'expired',
  'read reclaims an expired lease');
select is((select lease_token from public.import_jobs where id=(select job_id from expiring_admission)), null::uuid,
  'expired job no longer retains its lease');

create temporary table complete_admission as select * from public.admit_import('complete001');
select is(public.complete_import(
  (select job_id from complete_admission), (select lease_token from complete_admission),
  pg_temp.metadata('complete001',60), pg_temp.song()), null::uuid,
  'full completion is fenced until the enriching stage');
select is((select count(*) from public.songs where youtube_video_id='complete001'), 0::bigint,
  'premature completion has no catalog side effect');
select public.advance_import((select job_id from complete_admission),(select lease_token from complete_admission),'transcribing');
select public.advance_import((select job_id from complete_admission),(select lease_token from complete_admission),'enriching');
create temporary table completion_result as select public.complete_import(
  (select job_id from complete_admission), (select lease_token from complete_admission),
  pg_temp.metadata('complete001',60), pg_temp.song()) as song_id;
select ok((select song_id is not null from completion_result), 'valid completion returns a song ID');
select is((select song_id from completion_result),
  (select song_id from public.import_jobs where id=(select job_id from complete_admission)),
  'valid completion links the same song to the job');
select is((select source from public.songs where youtube_video_id='complete001'), 'ai', 'completion records AI source');
select is((select ai_model from public.songs where youtube_video_id='complete001'), 'gemini-test', 'completion records server model');
select is((select prompt_version from public.songs where youtube_video_id='complete001'), 'youtube-auto-import-v1', 'completion records prompt version');
select is((select youtube_url from public.songs where youtube_video_id='complete001'),
  'https://www.youtube.com/watch?v=complete001', 'canonical URL is derived from locked video ID');
select is((select title from public.songs where youtube_video_id='complete001'), 'Generated application title',
  'application title comes from prepared song rather than private metadata');
select is((select count(*) from public.lyric_lines l join public.songs s on s.id=l.song_id where s.youtube_video_id='complete001'),
  1::bigint, 'completion stores all lyric fields');
select is((select status from public.import_jobs where id=(select job_id from complete_admission)), 'completed',
  'completion terminalizes the job in the same transaction');
select is(public.complete_import(
  (select job_id from complete_admission), (select lease_token from complete_admission),
  pg_temp.metadata('complete001',60), pg_temp.song('late title')), null::uuid,
  'late completion cannot rewrite a terminal job');
select is((select title from public.songs where youtube_video_id='complete001'), 'Generated application title',
  'late completion leaves the published result unchanged');

create temporary table invalid_admission as select * from public.admit_import('invalid0001');
select public.advance_import((select job_id from invalid_admission),(select lease_token from invalid_admission),'transcribing');
select public.advance_import((select job_id from invalid_admission),(select lease_token from invalid_admission),'enriching');
select throws_ok(format($sql$select public.complete_import(%L,%L,%L::jsonb,%L::jsonb)$sql$,
  (select job_id from invalid_admission), (select lease_token from invalid_admission),
  pg_temp.metadata('invalid0001',481)::text, pg_temp.song()::text), '22023', 'INVALID_METADATA',
  'database rejects duration beyond eight minutes');
select is((select count(*) from public.songs where youtube_video_id='invalid0001'), 0::bigint,
  'invalid completion exposes no song');
select is((select status from public.import_jobs where id=(select job_id from invalid_admission)), 'enriching',
  'invalid completion rolls back the job mutation');
select public.fail_import((select job_id from invalid_admission),(select lease_token from invalid_admission),'TEST_DONE');

create temporary table full_future_admission as select * from public.admit_import('fullfuture1');
select public.advance_import((select job_id from full_future_admission),(select lease_token from full_future_admission),'transcribing');
select public.advance_import((select job_id from full_future_admission),(select lease_token from full_future_admission),'enriching');
select throws_ok(format($sql$select public.complete_import(%L,%L,%L::jsonb,%L::jsonb)$sql$,
  (select job_id from full_future_admission),(select lease_token from full_future_admission),
  pg_temp.metadata('fullfuture1',60,clock_timestamp()+interval '1 hour')::text,pg_temp.song()::text),
  '22023','INVALID_METADATA','full completion rejects a future provider observation');
select is((select status from public.import_jobs where id=(select job_id from full_future_admission)), 'enriching',
  'future full observation cannot terminalize the job');
select is((select count(*) from public.songs where youtube_video_id='fullfuture1'),0::bigint,
  'future full observation writes no song');
select is((select count(*) from public.youtube_metadata where video_id='fullfuture1'),0::bigint,
  'future full observation writes no metadata');
select public.fail_import((select job_id from full_future_admission),(select lease_token from full_future_admission),'TEST_DONE');

create temporary table full_prior_admission as select * from public.admit_import('fullprior01');
select public.advance_import((select job_id from full_prior_admission),(select lease_token from full_prior_admission),'transcribing');
select public.advance_import((select job_id from full_prior_admission),(select lease_token from full_prior_admission),'enriching');
select throws_ok(format($sql$select public.complete_import(%L,%L,%L::jsonb,%L::jsonb)$sql$,
  (select job_id from full_prior_admission),(select lease_token from full_prior_admission),
  pg_temp.metadata('fullprior01',60,(select admitted_at-interval '1 second' from public.import_jobs where id=(select job_id from full_prior_admission)))::text,
  pg_temp.song()::text),'22023','INVALID_METADATA','full completion rejects an observation made before admission');
select is((select status from public.import_jobs where id=(select job_id from full_prior_admission)), 'enriching',
  'pre-admission full observation cannot terminalize the job');
select is((select count(*) from public.songs where youtube_video_id='fullprior01'),0::bigint,
  'pre-admission full observation writes no song');
select is((select count(*) from public.youtube_metadata where video_id='fullprior01'),0::bigint,
  'pre-admission full observation writes no metadata');
select public.fail_import((select job_id from full_prior_admission),(select lease_token from full_prior_admission),'TEST_DONE');

create temporary table draft_race_admission as select * from public.admit_import('draftrace01');
select public.advance_import((select job_id from draft_race_admission),(select lease_token from draft_race_admission),'transcribing');
select public.advance_import((select job_id from draft_race_admission),(select lease_token from draft_race_admission),'enriching');
insert into public.songs(id,title,youtube_url,status,youtube_video_id,source,needs_reprocess)
values ('51000000-0000-4000-8000-000000000004','Admin draft','https://youtu.be/draftrace01','draft','draftrace01','ai',true);
select is(public.complete_import(
  (select job_id from draft_race_admission),(select lease_token from draft_race_admission),
  pg_temp.metadata('draftrace01',60),pg_temp.song('replacement')), null::uuid,
  'completion refuses an admin draft race');
select results_eq($$select status,title,needs_reprocess from public.songs where youtube_video_id='draftrace01'$$,
  $$values ('draft'::text,'Admin draft'::text,true)$$, 'admin draft is neither republished nor overwritten');
select public.fail_import((select job_id from draft_race_admission),(select lease_token from draft_race_admission),'TEST_DONE');

create function pg_temp.reject_rollback_line() returns trigger language plpgsql as $$
begin if new.korean='ROLLBACK' then raise exception 'forced lyric rollback'; end if; return new; end $$;
create trigger reject_rollback_line before insert on public.lyric_lines
for each row execute function pg_temp.reject_rollback_line();
create temporary table rollback_admission as select * from public.admit_import('rollback001');
select public.advance_import((select job_id from rollback_admission),(select lease_token from rollback_admission),'transcribing');
select public.advance_import((select job_id from rollback_admission),(select lease_token from rollback_admission),'enriching');
select throws_ok(format($sql$select public.complete_import(%L,%L,%L::jsonb,%L::jsonb)$sql$,
  (select job_id from rollback_admission),(select lease_token from rollback_admission),
  pg_temp.metadata('rollback001',60)::text,pg_temp.song('rollback title','ROLLBACK')::text),
  'P0001', 'forced lyric rollback', 'failure between lyric inserts aborts the completion transaction');
select is((select count(*) from public.songs where youtube_video_id='rollback001'), 0::bigint,
  'lyric failure leaves no half-created song');
select is((select count(*) from public.youtube_metadata where video_id='rollback001'), 0::bigint,
  'lyric failure leaves no metadata side effect');
select is((select status from public.import_jobs where id=(select job_id from rollback_admission)), 'enriching',
  'lyric failure keeps the lease active for explicit failure handling');
drop trigger reject_rollback_line on public.lyric_lines;
select public.fail_import((select job_id from rollback_admission),(select lease_token from rollback_admission),'TEST_DONE');

insert into public.songs(id,title,youtube_url,status,youtube_video_id,source,ai_model,prompt_version,needs_reprocess)
values ('51000000-0000-4000-8000-000000000005','Stable slug title','https://youtu.be/reprocess01','published','reprocess01','ai','old-model','old-prompt',true);
insert into public.lyric_lines(song_id,korean,viet_han,romanization,meaning,display_order,start_seconds,end_seconds)
values ('51000000-0000-4000-8000-000000000005','old','old','old','old',0,0,1);
create temporary table reprocess_admission as select * from public.admit_import('reprocess01');
select public.advance_import((select job_id from reprocess_admission),(select lease_token from reprocess_admission),'transcribing');
select public.advance_import((select job_id from reprocess_admission),(select lease_token from reprocess_admission),'enriching');
select is(public.complete_import((select job_id from reprocess_admission),(select lease_token from reprocess_admission),
  pg_temp.metadata('reprocess01',60),pg_temp.song('New generated title')),
  '51000000-0000-4000-8000-000000000005'::uuid, 'full reprocess reuses the existing song ID');
select results_eq($$select title,needs_reprocess,ai_model,prompt_version from public.songs where youtube_video_id='reprocess01'$$,
  $$values ('Stable slug title'::text,false,'gemini-test'::text,'youtube-auto-import-v1'::text)$$,
  'reprocess preserves title/slug identity and clears sticky flag only on success');

insert into public.songs(id,title,youtube_url,status,youtube_video_id,source,ai_model,prompt_version,needs_reprocess)
values ('51000000-0000-4000-8000-000000000006','Cached baseline','https://youtu.be/cachebase01','published','cachebase01','ai','old-model','old-prompt',false);
insert into public.lyric_lines(song_id,korean,viet_han,romanization,meaning,display_order,start_seconds,end_seconds)
values ('51000000-0000-4000-8000-000000000006','stable','stable','stable','stable',0,0,1);
insert into public.youtube_metadata(video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at)
values ('cachebase01','old metadata',60,true,true,false,true,clock_timestamp()-interval '29 days',clock_timestamp()-interval '1 day');
create temporary table cache_admission as select * from public.admit_import('cachebase01');
select is(public.complete_cached_import((select job_id from cache_admission),(select lease_token from cache_admission),
  pg_temp.metadata('cachebase01',60)), '51000000-0000-4000-8000-000000000006'::uuid,
  'cache shortcut succeeds only with a comparable baseline and unchanged duration');
select is((select korean from public.lyric_lines where song_id='51000000-0000-4000-8000-000000000006'), 'stable',
  'cache shortcut does not rewrite lyrics');

update public.youtube_metadata set fetched_at=clock_timestamp()-interval '29 days',
  expires_at=clock_timestamp()-interval '1 day' where video_id='cachebase01';
create temporary table changed_duration_admission as select * from public.admit_import('cachebase01');
select is(public.complete_cached_import((select job_id from changed_duration_admission),(select lease_token from changed_duration_admission),
  pg_temp.metadata('cachebase01',61)), null::uuid, 'cache shortcut rejects changed duration');
select is((select duration_seconds from public.youtube_metadata where video_id='cachebase01'), 60,
  'rejected shortcut leaves baseline metadata unchanged');
select public.fail_import((select job_id from changed_duration_admission),(select lease_token from changed_duration_admission),'TEST_DONE');

insert into public.songs(id,title,youtube_url,status,youtube_video_id,source,ai_model,prompt_version,needs_reprocess)
values
  ('51000000-0000-4000-8000-000000000007','Future cache baseline','https://youtu.be/cachefutur1','published','cachefutur1','ai','old-model','old-prompt',false),
  ('51000000-0000-4000-8000-000000000008','Prior cache baseline','https://youtu.be/cacheprior1','published','cacheprior1','ai','old-model','old-prompt',false);
insert into public.youtube_metadata(video_id,title,duration_seconds,is_public,embeddable,is_live,playable,fetched_at,expires_at)
values
  ('cachefutur1','future baseline',60,true,true,false,true,clock_timestamp()-interval '29 days',clock_timestamp()-interval '1 day'),
  ('cacheprior1','prior baseline',60,true,true,false,true,clock_timestamp()-interval '29 days',clock_timestamp()-interval '1 day');

create temporary table cache_future_admission as select * from public.admit_import('cachefutur1');
select is(public.complete_cached_import((select job_id from cache_future_admission),(select lease_token from cache_future_admission),
  pg_temp.metadata('cachefutur1',60,clock_timestamp()+interval '1 hour')),null::uuid,
  'cached completion rejects a future provider observation');
select is((select status from public.import_jobs where id=(select job_id from cache_future_admission)),'checking_video',
  'future cached observation cannot terminalize the job');
select ok((select fetched_at < admitted_at from public.youtube_metadata m cross join public.import_jobs j
  where m.video_id='cachefutur1' and j.id=(select job_id from cache_future_admission)),
  'future cached observation leaves baseline metadata unchanged');
select public.fail_import((select job_id from cache_future_admission),(select lease_token from cache_future_admission),'TEST_DONE');

create temporary table cache_prior_admission as select * from public.admit_import('cacheprior1');
select is(public.complete_cached_import((select job_id from cache_prior_admission),(select lease_token from cache_prior_admission),
  pg_temp.metadata('cacheprior1',60,(select admitted_at-interval '1 second' from public.import_jobs where id=(select job_id from cache_prior_admission)))),null::uuid,
  'cached completion rejects an observation made before admission');
select is((select status from public.import_jobs where id=(select job_id from cache_prior_admission)),'checking_video',
  'pre-admission cached observation cannot terminalize the job');
select ok((select fetched_at < admitted_at-interval '1 day' from public.youtube_metadata m cross join public.import_jobs j
  where m.video_id='cacheprior1' and j.id=(select job_id from cache_prior_admission)),
  'pre-admission cached observation leaves baseline metadata unchanged');
select public.fail_import((select job_id from cache_prior_admission),(select lease_token from cache_prior_admission),'TEST_DONE');

delete from public.import_attempts;
delete from public.import_jobs;
insert into public.import_jobs(id,video_id,status,stage,deadline_at,admitted_at)
select gen_random_uuid(), 'quota' || lpad(n::text,6,'0'), 'failed','failed',clock_timestamp(),clock_timestamp()-interval '1 hour'
from generate_series(1,20) n;
insert into public.import_attempts(job_id,admitted_at)
select id,admitted_at from public.import_jobs;
select results_eq($$select error_code from public.admit_import('quota000021')$$, array['DAILY_LIMIT'::text],
  'rolling 24 hour attempt 21 is rejected');
select results_eq($$select kind from public.admit_import('manual00001')$$, array['cached'::text],
  'cached song remains available after quota is exhausted');
insert into public.import_jobs(id,video_id,status,stage,lease_token,deadline_at,admitted_at)
values ('52000000-0000-4000-8000-000000000001','existing001','checking_video','checking_video',gen_random_uuid(),clock_timestamp()+interval '1 minute',clock_timestamp());
select results_eq($$select kind from public.admit_import('existing001')$$, array['existing'::text],
  'existing job remains available after quota is exhausted');

delete from public.import_attempts;
delete from public.import_jobs;
update public.import_runtime set maintenance_completed_at=clock_timestamp() where id=1;
create temporary table active_one as select * from public.admit_import('active00001');
create temporary table active_two as select * from public.admit_import('active00002');
select results_eq($$select error_code from public.admit_import('active00003')$$, array['ACTIVE_LIMIT'::text],
  'third simultaneous active job is rejected');

delete from public.import_attempts;
delete from public.import_jobs;
update public.import_runtime set maintenance_completed_at=null where id=1;
select results_eq($$select error_code from public.admit_import('heartbeat01')$$, array['IMPORT_UNAVAILABLE'::text],
  'missing maintenance heartbeat rejects a new job');
select results_eq($$select kind from public.admit_import('manual00001')$$, array['cached'::text],
  'missing heartbeat does not hide a cached result');

select * from finish();
rollback;
