begin;

alter table public.import_runtime
  add column maintenance_started_at timestamptz;

create function public.begin_maintenance()
returns table(lease_token uuid, deadline_at timestamptz)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  runtime public.import_runtime%rowtype;
begin
  select r.* into runtime from public.import_runtime r where r.id = 1 for update;
  checked_at := clock_timestamp();
  if runtime.maintenance_lease_token is not null
     and runtime.maintenance_deadline_at > checked_at then
    return;
  end if;

  lease_token := gen_random_uuid();
  deadline_at := checked_at + interval '240 seconds';
  update public.import_runtime
    set maintenance_lease_token = lease_token,
        maintenance_started_at = checked_at,
        maintenance_deadline_at = deadline_at
    where id = 1;
  return next;
end;
$$;

create function public.cleanup_import_data(p_lease_token uuid)
returns table(video_id text)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  runtime public.import_runtime%rowtype;
  candidate record;
  locked_song public.songs%rowtype;
  locked_metadata public.youtube_metadata%rowtype;
begin
  select r.* into runtime from public.import_runtime r where r.id = 1 for update;
  checked_at := clock_timestamp();
  if runtime.maintenance_lease_token is distinct from p_lease_token
     or runtime.maintenance_deadline_at <= checked_at then
    return;
  end if;

  delete from public.import_attempts a where a.admitted_at <= checked_at - interval '7 days';
  delete from public.import_jobs j where j.admitted_at <= checked_at - interval '7 days';
  delete from public.access_attempts a where a.attempted_at <= checked_at - interval '24 hours';

  for candidate in
    select m.video_id, m.fetched_at
    from public.youtube_metadata m
    where m.fetched_at <= checked_at - interval '29 days'
    order by m.fetched_at, m.video_id
    limit 100
  loop
    checked_at := clock_timestamp();
    if runtime.maintenance_deadline_at <= checked_at then return; end if;
    locked_song := null;
    locked_metadata := null;
    select s.* into locked_song from public.songs s
      where s.youtube_video_id = candidate.video_id for update;
    select m.* into locked_metadata from public.youtube_metadata m
      where m.video_id = candidate.video_id for update;
    checked_at := clock_timestamp();
    if runtime.maintenance_deadline_at <= checked_at then return; end if;
    if locked_metadata.video_id is not null
       and locked_metadata.fetched_at = candidate.fetched_at
       and locked_metadata.fetched_at <= checked_at - interval '29 days' then
      if locked_song.id is not null and locked_song.source = 'ai' then
        update public.songs set needs_reprocess = true, updated_at = checked_at
          where id = locked_song.id;
      end if;
      delete from public.youtube_metadata m where m.video_id = candidate.video_id;
    end if;
  end loop;

  return query
    select m.video_id
    from public.youtube_metadata m
    where m.playable
      and m.fetched_at <= checked_at - interval '25 days'
    order by m.fetched_at, m.video_id
    limit 12;
end;
$$;

create function public.apply_metadata_refresh(p_lease_token uuid, p_metadata jsonb)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  runtime public.import_runtime%rowtype;
  locked_song public.songs%rowtype;
  locked_metadata public.youtube_metadata%rowtype;
  metadata_video_id text;
  metadata_title text;
  metadata_duration integer;
  metadata_fetched timestamptz;
  metadata_expires timestamptz;
begin
  select r.* into runtime from public.import_runtime r where r.id = 1 for update;
  checked_at := clock_timestamp();
  if runtime.maintenance_lease_token is distinct from p_lease_token
     or runtime.maintenance_deadline_at <= checked_at then
    return false;
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
     or not (p_metadata ?& array['videoId','title','durationSeconds','isPublic','embeddable','isLive','playable','fetchedAt','expiresAt'])
     or (select count(*) from jsonb_object_keys(p_metadata)) <> 9
     or jsonb_typeof(p_metadata->'videoId') <> 'string'
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
    metadata_video_id := p_metadata->>'videoId';
    metadata_title := p_metadata->>'title';
    metadata_duration := (p_metadata->>'durationSeconds')::integer;
    metadata_fetched := (p_metadata->>'fetchedAt')::timestamptz;
    metadata_expires := (p_metadata->>'expiresAt')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'INVALID_METADATA';
  end;
  if metadata_video_id !~ '^[A-Za-z0-9_-]{11}$'
     or metadata_duration not between 1 and 480
     or not (p_metadata->>'isPublic')::boolean
     or not (p_metadata->>'embeddable')::boolean
     or (p_metadata->>'isLive')::boolean
     or not (p_metadata->>'playable')::boolean
     or metadata_fetched < runtime.maintenance_started_at
     or metadata_fetched > checked_at
     or metadata_expires <= checked_at
     or metadata_expires <= metadata_fetched
     or metadata_expires > metadata_fetched + interval '30 days' then
    raise exception using errcode = '22023', message = 'INVALID_METADATA';
  end if;

  select s.* into locked_song from public.songs s
    where s.youtube_video_id = metadata_video_id for update;
  select m.* into locked_metadata from public.youtube_metadata m
    where m.video_id = metadata_video_id for update;
  checked_at := clock_timestamp();
  if runtime.maintenance_deadline_at <= checked_at then return false; end if;
  if locked_metadata.video_id is null then return false; end if;
  if locked_metadata.fetched_at > runtime.maintenance_started_at
     or metadata_fetched < locked_metadata.fetched_at then
    return false;
  end if;

  if locked_song.id is not null and locked_song.source = 'ai'
     and locked_song.needs_reprocess = false
     and locked_song.youtube_video_id = metadata_video_id
     and locked_metadata.duration_seconds <> metadata_duration then
    update public.songs set needs_reprocess = true, updated_at = checked_at
      where id = locked_song.id;
  end if;

  update public.youtube_metadata set
    title = metadata_title,
    duration_seconds = metadata_duration,
    is_public = (p_metadata->>'isPublic')::boolean,
    embeddable = (p_metadata->>'embeddable')::boolean,
    is_live = (p_metadata->>'isLive')::boolean,
    playable = (p_metadata->>'playable')::boolean,
    fetched_at = metadata_fetched,
    expires_at = metadata_expires
  where video_id = metadata_video_id;
  return true;
end;
$$;

create function public.mark_metadata_unavailable(p_lease_token uuid, p_video_id text)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  runtime public.import_runtime%rowtype;
  locked_song public.songs%rowtype;
  locked_metadata public.youtube_metadata%rowtype;
begin
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception using errcode = '22023', message = 'INVALID_VIDEO_ID';
  end if;
  select r.* into runtime from public.import_runtime r where r.id = 1 for update;
  checked_at := clock_timestamp();
  if runtime.maintenance_lease_token is distinct from p_lease_token
     or runtime.maintenance_deadline_at <= checked_at then
    return false;
  end if;

  select s.* into locked_song from public.songs s
    where s.youtube_video_id = p_video_id for update;
  select m.* into locked_metadata from public.youtube_metadata m
    where m.video_id = p_video_id for update;
  checked_at := clock_timestamp();
  if runtime.maintenance_deadline_at <= checked_at then return false; end if;
  if locked_metadata.video_id is null then return true; end if;
  if locked_metadata.fetched_at > runtime.maintenance_started_at then return true; end if;
  update public.youtube_metadata set playable = false where video_id = p_video_id;
  return true;
end;
$$;

create function public.finish_maintenance(p_lease_token uuid)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  runtime public.import_runtime%rowtype;
begin
  select r.* into runtime from public.import_runtime r where r.id = 1 for update;
  checked_at := clock_timestamp();
  if runtime.maintenance_lease_token is distinct from p_lease_token
     or runtime.maintenance_deadline_at <= checked_at then
    return false;
  end if;
  if exists (
    select 1 from public.youtube_metadata m
    where m.fetched_at <= checked_at - interval '29 days'
       or (m.playable and m.fetched_at <= checked_at - interval '25 days')
  ) then
    update public.import_runtime set maintenance_lease_token = null,
      maintenance_started_at = null, maintenance_deadline_at = null where id = 1;
    return false;
  end if;
  update public.import_runtime set maintenance_completed_at = checked_at,
    maintenance_lease_token = null, maintenance_started_at = null,
    maintenance_deadline_at = null where id = 1;
  return true;
end;
$$;

revoke execute on function public.begin_maintenance() from public, anon, authenticated;
revoke execute on function public.cleanup_import_data(uuid) from public, anon, authenticated;
revoke execute on function public.apply_metadata_refresh(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.mark_metadata_unavailable(uuid, text) from public, anon, authenticated;
revoke execute on function public.finish_maintenance(uuid) from public, anon, authenticated;

grant execute on function public.begin_maintenance() to service_role;
grant execute on function public.cleanup_import_data(uuid) to service_role;
grant execute on function public.apply_metadata_refresh(uuid, jsonb) to service_role;
grant execute on function public.mark_metadata_unavailable(uuid, text) to service_role;
grant execute on function public.finish_maintenance(uuid) to service_role;

commit;
