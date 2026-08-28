begin;

create or replace function public.admit_import(p_video_id text)
returns table(
  kind text,
  job_id uuid,
  status text,
  stage text,
  deadline_at timestamptz,
  song_id uuid,
  error_code text,
  lease_token uuid,
  retry_after_seconds integer
)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  found_song public.songs%rowtype;
  found_metadata public.youtube_metadata%rowtype;
  found_job public.import_jobs%rowtype;
  active_count integer;
  first_deadline timestamptz;
begin
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception using errcode = '22023', message = 'INVALID_VIDEO_ID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('public.admit_import:global', 0));
  checked_at := clock_timestamp();

  update public.import_jobs j
    set status = 'expired', stage = 'expired', lease_token = null, error_code = 'JOB_EXPIRED'
    where j.status in ('checking_video', 'transcribing', 'enriching')
      and j.deadline_at <= checked_at;

  select s.* into found_song
    from public.songs s where s.youtube_video_id = p_video_id for update;
  if found then
    checked_at := clock_timestamp();
    if found_song.status = 'draft' then
      return query select 'rejected', null::uuid, null::text, null::text, null::timestamptz,
        null::uuid, 'VIDEO_UNAVAILABLE', null::uuid, null::integer;
      return;
    end if;
    if found_song.source = 'manual' then
      return query select 'cached', null::uuid, null::text, null::text, null::timestamptz,
        found_song.id, null::text, null::uuid, null::integer;
      return;
    end if;

    select m.* into found_metadata
      from public.youtube_metadata m where m.video_id = p_video_id for update;
    checked_at := clock_timestamp();
    if not found_song.needs_reprocess and found
       and found_metadata.expires_at > checked_at
       and found_metadata.is_public and found_metadata.embeddable
       and not found_metadata.is_live and found_metadata.playable
       and found_metadata.duration_seconds <= 480 then
      return query select 'cached', null::uuid, null::text, null::text, null::timestamptz,
        found_song.id, null::text, null::uuid, null::integer;
      return;
    end if;
  end if;

  select j.* into found_job
    from public.import_jobs j
    where j.video_id = p_video_id
      and j.status in ('checking_video', 'transcribing', 'enriching')
    order by j.admitted_at desc
    limit 1;
  if found then
    return query select 'existing', found_job.id, found_job.status, found_job.stage,
      found_job.deadline_at, found_job.song_id, found_job.error_code, null::uuid, null::integer;
    return;
  end if;

  if not exists (
    select 1 from public.import_runtime r
    where r.id = 1 and r.maintenance_completed_at > checked_at - interval '48 hours'
  ) then
    return query select 'rejected', null::uuid, null::text, null::text, null::timestamptz,
      null::uuid, 'IMPORT_UNAVAILABLE', null::uuid, null::integer;
    return;
  end if;

  select count(*)::integer, min(j.deadline_at)
    into active_count, first_deadline
    from public.import_jobs j
    where j.status in ('checking_video', 'transcribing', 'enriching')
      and j.deadline_at > checked_at;
  if active_count >= 2 then
    return query select 'rejected', null::uuid, null::text, null::text, null::timestamptz,
      null::uuid, 'ACTIVE_LIMIT', null::uuid,
      greatest(1, ceil(extract(epoch from first_deadline - checked_at))::integer);
    return;
  end if;

  insert into public.import_jobs(video_id, status, stage, lease_token, admitted_at, deadline_at)
    values (p_video_id, 'checking_video', 'checking_video', gen_random_uuid(), checked_at,
      checked_at + interval '240 seconds')
    returning * into found_job;
  insert into public.import_attempts(job_id, admitted_at) values (found_job.id, checked_at);

  return query select 'created', found_job.id, found_job.status, found_job.stage,
    found_job.deadline_at, found_job.song_id, found_job.error_code, found_job.lease_token, null::integer;
end;
$$;

commit;
