begin;

-- Recent local Supabase versions do not implicitly grant these table reads.
-- Existing published-only RLS policies continue to restrict the public catalog.
grant select on table public.songs, public.lyric_lines to anon;

alter table public.songs
  add column youtube_video_id text,
  add column source text not null default 'manual',
  add column ai_model text,
  add column prompt_version text,
  add column needs_reprocess boolean not null default false,
  add constraint songs_source_check check (source in ('manual', 'ai')),
  add constraint songs_youtube_video_id_check check (
    youtube_video_id is null or youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'
  );

create function pg_temp.youtube_video_id_from_url(raw_url text) returns text
language plpgsql immutable strict as $$
declare
  matched text[];
  query_string text;
  video_id text;
begin
  -- A question mark is legal inside a query value: preserve everything after
  -- the first delimiter so later list/v parameters are still validated.
  query_string := coalesce(substring(split_part(raw_url, '#', 1) from '[?](.*)$'), '');
  -- Be conservative for legacy URLs with encoded query names. URLSearchParams
  -- would decode them; leaving their ID null is safer than missing a list/v key.
  if query_string ~ '(^|&)list(=|&|$)' or query_string ~ '(^|&)[^=&]*%'
     or (select count(*) from unnest(string_to_array(query_string, '&')) parameter
         where split_part(parameter, '=', 1) = 'v') > 1 then
    return null;
  end if;
  matched := regexp_match(raw_url,
    '^https://youtu[.]be/([A-Za-z0-9_-]{11})(?:[?]([^#]*))?(?:#.*)?$');
  if matched is not null then
    query_string := coalesce(matched[2], '');
    if query_string !~ '(^|&)list=' then return matched[1]; end if;
    return null;
  end if;

  matched := regexp_match(raw_url,
    '^https://(?:(?:www|m)[.])?youtube[.]com/(?:shorts|embed)/([A-Za-z0-9_-]{11})(?:[?]([^#]*))?(?:#.*)?$');
  if matched is not null then
    query_string := coalesce(matched[2], '');
    if query_string !~ '(^|&)list=' then return matched[1]; end if;
    return null;
  end if;

  matched := regexp_match(raw_url,
    '^https://(?:(?:www|m)[.])?youtube[.]com/watch[?]([^#]*)(?:#.*)?$');
  if matched is null then return null; end if;
  query_string := matched[1];
  if query_string ~ '(^|&)list=' or
     (select count(*) from unnest(string_to_array(query_string, '&')) parameter
      where split_part(parameter, '=', 1) = 'v') <> 1 then
    return null;
  end if;
  matched := regexp_match(query_string, '(^|&)v=([A-Za-z0-9_-]{11})(&|$)');
  if matched is null then return null; end if;
  video_id := matched[2];
  return video_id;
end;
$$;

update public.songs
set youtube_video_id = pg_temp.youtube_video_id_from_url(youtube_url);
drop function pg_temp.youtube_video_id_from_url(text);

do $$
begin
  if exists (
    select 1 from public.songs where youtube_video_id is not null
    group by youtube_video_id having count(*) > 1
  ) then
    raise exception using errcode = '23505', message = 'DUPLICATE_YOUTUBE_VIDEO_ID';
  end if;
end;
$$;

create unique index songs_youtube_video_id_key on public.songs(youtube_video_id)
where youtube_video_id is not null;

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  status text not null check (status in ('checking_video', 'transcribing', 'enriching', 'completed', 'failed', 'expired')),
  stage text not null check (stage in ('checking_video', 'transcribing', 'enriching', 'completed', 'failed', 'expired')),
  lease_token uuid,
  admitted_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null,
  song_id uuid references public.songs(id),
  error_code text
);

create table public.import_attempts (
  job_id uuid primary key references public.import_jobs(id) on delete cascade,
  admitted_at timestamptz not null default clock_timestamp()
);
create index import_attempts_admitted_at_idx on public.import_attempts(admitted_at);

create table public.access_attempts (
  ip_hash text not null check (char_length(ip_hash) > 0),
  attempted_at timestamptz not null default clock_timestamp()
);
create index access_attempts_ip_hash_attempted_at_idx on public.access_attempts(ip_hash, attempted_at);

create table public.youtube_metadata (
  video_id text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check (char_length(trim(title)) > 0),
  duration_seconds integer not null check (duration_seconds > 0),
  is_public boolean not null,
  embeddable boolean not null,
  is_live boolean not null,
  playable boolean not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > fetched_at)
);

create table public.import_runtime (
  id smallint primary key default 1 check (id = 1),
  maintenance_completed_at timestamptz,
  maintenance_lease_token uuid,
  maintenance_deadline_at timestamptz
);
insert into public.import_runtime(id) values (1);

alter table public.import_jobs enable row level security;
alter table public.import_attempts enable row level security;
alter table public.access_attempts enable row level security;
alter table public.youtube_metadata enable row level security;
alter table public.import_runtime enable row level security;

revoke all on table public.import_jobs, public.import_attempts, public.access_attempts,
  public.youtube_metadata, public.import_runtime from public, anon, authenticated, service_role;
-- UUID keys avoid sequences; no new sequence privileges are needed.
grant select, insert, update, delete on table public.import_jobs, public.import_attempts,
  public.access_attempts, public.youtube_metadata, public.import_runtime to service_role;

create function public.consume_access_attempt(p_ip_hash text)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  checked_at timestamptz;
  first_attempt timestamptz;
  attempt_count integer;
begin
  if p_ip_hash is null or char_length(p_ip_hash) = 0 then
    raise exception using errcode = '22023', message = 'INVALID_IP_HASH';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));
  checked_at := clock_timestamp();
  delete from public.access_attempts
    where ip_hash = p_ip_hash and attempted_at <= checked_at - interval '24 hours';
  select count(*)::integer, min(a.attempted_at)
    into attempt_count, first_attempt
    from public.access_attempts a
    where a.ip_hash = p_ip_hash and a.attempted_at > checked_at - interval '15 minutes';

  if attempt_count >= 10 then
    return query select false,
      greatest(1, ceil(extract(epoch from first_attempt + interval '15 minutes' - checked_at))::integer);
    return;
  end if;

  insert into public.access_attempts(ip_hash, attempted_at) values (p_ip_hash, checked_at);
  return query select true, 0;
end;
$$;

revoke execute on function public.consume_access_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_access_attempt(text) to service_role;

commit;
