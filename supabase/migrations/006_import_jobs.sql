begin;

create unique index import_jobs_one_active_video_idx
  on public.import_jobs(video_id)
  where status in ('checking_video', 'transcribing', 'enriching');

-- The backend writes the public catalog only through the fenced completion RPCs.
grant select, insert, update, delete on table public.songs, public.lyric_lines to service_role;
grant usage, select on all sequences in schema public to service_role;

create function public.admit_import(p_video_id text)
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
  attempt_count integer;
  first_attempt timestamptz;
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

  -- Admissions without a job lock songs before metadata, matching maintenance.
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

  select count(*)::integer, min(a.admitted_at)
    into attempt_count, first_attempt
    from public.import_attempts a
    where a.admitted_at > checked_at - interval '24 hours';
  if attempt_count >= 20 then
    return query select 'rejected', null::uuid, null::text, null::text, null::timestamptz,
      null::uuid, 'DAILY_LIMIT', null::uuid,
      greatest(1, ceil(extract(epoch from first_attempt + interval '24 hours' - checked_at))::integer);
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

create function public.advance_import(p_job_id uuid, p_lease_token uuid, p_stage text)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  found_job public.import_jobs%rowtype;
  expected_status text;
begin
  if p_stage = 'transcribing' then expected_status := 'checking_video';
  elsif p_stage = 'enriching' then expected_status := 'transcribing';
  else raise exception using errcode = '22023', message = 'INVALID_IMPORT_STAGE';
  end if;

  select j.* into found_job from public.import_jobs j where j.id = p_job_id for update;
  if not found then return false; end if;
  checked_at := clock_timestamp();
  if found_job.status in ('checking_video', 'transcribing', 'enriching')
     and found_job.deadline_at <= checked_at then
    update public.import_jobs set status = 'expired', stage = 'expired', lease_token = null,
      error_code = 'JOB_EXPIRED' where id = found_job.id;
    return false;
  end if;
  if found_job.status <> expected_status or found_job.lease_token is distinct from p_lease_token then
    return false;
  end if;
  update public.import_jobs set status = p_stage, stage = p_stage where id = found_job.id;
  return true;
end;
$$;

create function public.fail_import(p_job_id uuid, p_lease_token uuid, p_error_code text)
returns void
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  found_job public.import_jobs%rowtype;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception using errcode = '22023', message = 'INVALID_ERROR_CODE';
  end if;
  select j.* into found_job from public.import_jobs j where j.id = p_job_id for update;
  if not found then return; end if;
  checked_at := clock_timestamp();
  if found_job.status not in ('checking_video', 'transcribing', 'enriching')
     or found_job.lease_token is distinct from p_lease_token then return; end if;
  if found_job.deadline_at <= checked_at then
    update public.import_jobs set status = 'expired', stage = 'expired', lease_token = null,
      error_code = 'JOB_EXPIRED' where id = found_job.id;
  else
    update public.import_jobs set status = 'failed', stage = 'failed', lease_token = null,
      error_code = p_error_code where id = found_job.id;
  end if;
end;
$$;

create function public.read_import(p_job_id uuid)
returns table(job_id uuid, status text, stage text, deadline_at timestamptz, song_id uuid, error_code text)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  found_job public.import_jobs%rowtype;
begin
  select j.* into found_job from public.import_jobs j where j.id = p_job_id for update;
  if not found then return; end if;
  checked_at := clock_timestamp();
  if found_job.status in ('checking_video', 'transcribing', 'enriching')
     and found_job.deadline_at <= checked_at then
    update public.import_jobs set status = 'expired', stage = 'expired', lease_token = null,
      error_code = 'JOB_EXPIRED' where id = found_job.id returning * into found_job;
  end if;
  return query select found_job.id, found_job.status, found_job.stage, found_job.deadline_at,
    found_job.song_id, found_job.error_code;
end;
$$;

create function public.complete_import(
  p_job_id uuid,
  p_lease_token uuid,
  p_metadata jsonb,
  p_song jsonb
)
returns uuid
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  found_job public.import_jobs%rowtype;
  found_song public.songs%rowtype;
  found_metadata public.youtube_metadata%rowtype;
  metadata_title text;
  metadata_duration integer;
  metadata_fetched timestamptz;
  metadata_expires timestamptz;
  song_title text;
  validated_ai_model text;
  validated_prompt_version text;
  line jsonb;
  line_start numeric;
  line_end numeric;
  previous_end numeric := 0;
  line_count integer;
  song_result uuid;
begin
  select j.* into found_job from public.import_jobs j where j.id = p_job_id for update;
  if not found then return null; end if;

  -- All completion paths use job -> song -> metadata lock order.
  select s.* into found_song from public.songs s
    where s.youtube_video_id = found_job.video_id for update;
  select m.* into found_metadata from public.youtube_metadata m
    where m.video_id = found_job.video_id for update;
  checked_at := clock_timestamp();

  if found_job.status <> 'enriching'
     or found_job.lease_token is distinct from p_lease_token then return null; end if;
  if found_job.deadline_at <= checked_at then
    update public.import_jobs set status = 'expired', stage = 'expired', lease_token = null,
      error_code = 'JOB_EXPIRED' where id = found_job.id;
    return null;
  end if;
  if found_song.id is not null and (found_song.status <> 'published' or found_song.source <> 'ai') then
    return null;
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
     or not (p_metadata ?& array['videoId','title','durationSeconds','isPublic','embeddable','isLive','playable','fetchedAt','expiresAt'])
     or (select count(*) from jsonb_object_keys(p_metadata)) <> 9
     or jsonb_typeof(p_metadata->'videoId') <> 'string'
     or p_metadata->>'videoId' <> found_job.video_id
     or jsonb_typeof(p_metadata->'title') <> 'string'
     or char_length(trim(p_metadata->>'title')) not between 1 and 200
     or jsonb_typeof(p_metadata->'durationSeconds') <> 'number'
     or jsonb_typeof(p_metadata->'isPublic') <> 'boolean'
     or jsonb_typeof(p_metadata->'embeddable') <> 'boolean'
     or jsonb_typeof(p_metadata->'isLive') <> 'boolean'
     or jsonb_typeof(p_metadata->'playable') <> 'boolean'
     or jsonb_typeof(p_metadata->'fetchedAt') <> 'string'
     or jsonb_typeof(p_metadata->'expiresAt') <> 'string' then
    raise exception using errcode = '22023', message = 'INVALID_METADATA';
  end if;
  begin
    metadata_duration := (p_metadata->>'durationSeconds')::integer;
    metadata_fetched := (p_metadata->>'fetchedAt')::timestamptz;
    metadata_expires := (p_metadata->>'expiresAt')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'INVALID_METADATA';
  end;
  metadata_title := p_metadata->>'title';
  if metadata_duration not between 1 and 480
     or not (p_metadata->>'isPublic')::boolean
     or not (p_metadata->>'embeddable')::boolean
     or (p_metadata->>'isLive')::boolean
     or not (p_metadata->>'playable')::boolean
     or metadata_fetched < found_job.admitted_at
     or metadata_fetched > checked_at
     or metadata_expires <= checked_at
     or metadata_expires <= metadata_fetched
     or metadata_expires > metadata_fetched + interval '30 days'
     or metadata_expires > checked_at + interval '30 days'
     or (found_metadata.video_id is not null and found_metadata.fetched_at > metadata_fetched) then
    raise exception using errcode = '22023', message = 'INVALID_METADATA';
  end if;

  if p_song is null or jsonb_typeof(p_song) <> 'object'
     or not (p_song ?& array['title','lines','aiModel','promptVersion'])
     or (select count(*) from jsonb_object_keys(p_song)) <> 4
     or jsonb_typeof(p_song->'title') <> 'string'
     or char_length(trim(p_song->>'title')) not between 1 and 200
     or jsonb_typeof(p_song->'aiModel') <> 'string'
     or (p_song->>'aiModel') !~ '^[A-Za-z0-9._-]{1,128}$'
     or jsonb_typeof(p_song->'promptVersion') <> 'string'
     or (p_song->>'promptVersion') !~ '^[A-Za-z0-9._:-]{1,64}$'
     or jsonb_typeof(p_song->'lines') <> 'array'
     or jsonb_array_length(p_song->'lines') not between 1 and 500 then
    raise exception using errcode = '22023', message = 'INVALID_SONG';
  end if;
  song_title := p_song->>'title';
  validated_ai_model := p_song->>'aiModel';
  validated_prompt_version := p_song->>'promptVersion';
  line_count := jsonb_array_length(p_song->'lines');
  for line in select value from jsonb_array_elements(p_song->'lines') loop
    if jsonb_typeof(line) <> 'object'
       or not (line ?& array['text','start','end','vietHan','romanization','meaning'])
       or (select count(*) from jsonb_object_keys(line)) <> 6
       or jsonb_typeof(line->'text') <> 'string'
       or char_length(trim(line->>'text')) not between 1 and 2000
       or jsonb_typeof(line->'vietHan') <> 'string'
       or char_length(trim(line->>'vietHan')) not between 1 and 2000
       or jsonb_typeof(line->'romanization') <> 'string'
       or char_length(trim(line->>'romanization')) not between 1 and 2000
       or jsonb_typeof(line->'meaning') <> 'string'
       or char_length(trim(line->>'meaning')) not between 1 and 2000
       or jsonb_typeof(line->'start') <> 'number'
       or jsonb_typeof(line->'end') <> 'number' then
      raise exception using errcode = '22023', message = 'INVALID_SONG';
    end if;
    begin
      line_start := (line->>'start')::numeric;
      line_end := (line->>'end')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'INVALID_SONG';
    end;
    if line_start < 0 or line_end <= line_start or line_end > metadata_duration
       or line_start < previous_end then
      raise exception using errcode = '22023', message = 'INVALID_SONG';
    end if;
    previous_end := line_end;
  end loop;

  if found_song.id is null then
    insert into public.songs(title, youtube_url, status, youtube_video_id, source,
      ai_model, prompt_version, needs_reprocess, created_at, updated_at)
    values (song_title, 'https://www.youtube.com/watch?v=' || found_job.video_id,
      'published', found_job.video_id, 'ai', validated_ai_model, validated_prompt_version, false, checked_at, checked_at)
    returning id into song_result;
  else
    song_result := found_song.id;
    update public.songs set
      youtube_url = 'https://www.youtube.com/watch?v=' || found_job.video_id,
      ai_model = validated_ai_model,
      prompt_version = validated_prompt_version,
      needs_reprocess = false,
      updated_at = checked_at
    where id = song_result;
    delete from public.lyric_lines where song_id = song_result;
  end if;

  insert into public.lyric_lines(song_id, korean, viet_han, romanization, meaning,
    display_order, start_seconds, end_seconds, created_at, updated_at)
  select song_result, item->>'text', item->>'vietHan', item->>'romanization', item->>'meaning',
    ordinality::integer - 1, (item->>'start')::numeric, (item->>'end')::numeric, checked_at, checked_at
  from jsonb_array_elements(p_song->'lines') with ordinality as lines(item, ordinality);
  if not found or line_count <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_SONG';
  end if;

  insert into public.youtube_metadata(video_id, title, duration_seconds, is_public,
    embeddable, is_live, playable, fetched_at, expires_at)
  values (found_job.video_id, metadata_title, metadata_duration,
    (p_metadata->>'isPublic')::boolean, (p_metadata->>'embeddable')::boolean,
    (p_metadata->>'isLive')::boolean, (p_metadata->>'playable')::boolean,
    metadata_fetched, metadata_expires)
  on conflict (video_id) do update set
    title = excluded.title, duration_seconds = excluded.duration_seconds,
    is_public = excluded.is_public, embeddable = excluded.embeddable,
    is_live = excluded.is_live, playable = excluded.playable,
    fetched_at = excluded.fetched_at, expires_at = excluded.expires_at;

  update public.import_jobs set status = 'completed', stage = 'completed', lease_token = null,
    song_id = song_result, error_code = null where id = found_job.id;
  return song_result;
end;
$$;

create function public.complete_cached_import(
  p_job_id uuid,
  p_lease_token uuid,
  p_metadata jsonb
)
returns uuid
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  found_job public.import_jobs%rowtype;
  found_song public.songs%rowtype;
  found_metadata public.youtube_metadata%rowtype;
  metadata_title text;
  metadata_duration integer;
  metadata_fetched timestamptz;
  metadata_expires timestamptz;
begin
  select j.* into found_job from public.import_jobs j where j.id = p_job_id for update;
  if not found then return null; end if;
  select s.* into found_song from public.songs s
    where s.youtube_video_id = found_job.video_id for update;
  select m.* into found_metadata from public.youtube_metadata m
    where m.video_id = found_job.video_id for update;
  checked_at := clock_timestamp();

  if found_job.status <> 'checking_video'
     or found_job.lease_token is distinct from p_lease_token then return null; end if;
  if found_job.deadline_at <= checked_at then
    update public.import_jobs set status = 'expired', stage = 'expired', lease_token = null,
      error_code = 'JOB_EXPIRED' where id = found_job.id;
    return null;
  end if;
  if found_song.id is null or found_song.source <> 'ai' or found_song.status <> 'published'
     or found_song.needs_reprocess or found_metadata.video_id is null then return null; end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
     or not (p_metadata ?& array['videoId','title','durationSeconds','isPublic','embeddable','isLive','playable','fetchedAt','expiresAt'])
     or (select count(*) from jsonb_object_keys(p_metadata)) <> 9
     or jsonb_typeof(p_metadata->'videoId') <> 'string'
     or p_metadata->>'videoId' <> found_job.video_id
     or jsonb_typeof(p_metadata->'title') <> 'string'
     or char_length(trim(p_metadata->>'title')) not between 1 and 200
     or jsonb_typeof(p_metadata->'durationSeconds') <> 'number'
     or jsonb_typeof(p_metadata->'isPublic') <> 'boolean'
     or jsonb_typeof(p_metadata->'embeddable') <> 'boolean'
     or jsonb_typeof(p_metadata->'isLive') <> 'boolean'
     or jsonb_typeof(p_metadata->'playable') <> 'boolean'
     or jsonb_typeof(p_metadata->'fetchedAt') <> 'string'
     or jsonb_typeof(p_metadata->'expiresAt') <> 'string' then
    raise exception using errcode = '22023', message = 'INVALID_METADATA';
  end if;
  begin
    metadata_duration := (p_metadata->>'durationSeconds')::integer;
    metadata_fetched := (p_metadata->>'fetchedAt')::timestamptz;
    metadata_expires := (p_metadata->>'expiresAt')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'INVALID_METADATA';
  end;
  metadata_title := p_metadata->>'title';
  if metadata_duration <> found_metadata.duration_seconds
     or metadata_duration not between 1 and 480
     or not (p_metadata->>'isPublic')::boolean
     or not (p_metadata->>'embeddable')::boolean
     or (p_metadata->>'isLive')::boolean
     or not (p_metadata->>'playable')::boolean
     or metadata_fetched < found_job.admitted_at
     or metadata_fetched > checked_at
     or metadata_expires <= checked_at
     or metadata_expires <= metadata_fetched
     or metadata_expires > metadata_fetched + interval '30 days'
     or metadata_expires > checked_at + interval '30 days'
     or metadata_fetched < found_metadata.fetched_at then
    return null;
  end if;

  update public.youtube_metadata set title = metadata_title,
    is_public = (p_metadata->>'isPublic')::boolean,
    embeddable = (p_metadata->>'embeddable')::boolean,
    is_live = (p_metadata->>'isLive')::boolean,
    playable = (p_metadata->>'playable')::boolean,
    fetched_at = metadata_fetched,
    expires_at = metadata_expires
  where video_id = found_job.video_id;
  update public.import_jobs set status = 'completed', stage = 'completed', lease_token = null,
    song_id = found_song.id, error_code = null where id = found_job.id;
  return found_song.id;
end;
$$;

revoke execute on function public.admit_import(text) from public, anon, authenticated;
revoke execute on function public.advance_import(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.fail_import(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.complete_import(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.complete_cached_import(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.read_import(uuid) from public, anon, authenticated;

grant execute on function public.admit_import(text) to service_role;
grant execute on function public.advance_import(uuid, uuid, text) to service_role;
grant execute on function public.fail_import(uuid, uuid, text) to service_role;
grant execute on function public.complete_import(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.complete_cached_import(uuid, uuid, jsonb) to service_role;
grant execute on function public.read_import(uuid) to service_role;

commit;
