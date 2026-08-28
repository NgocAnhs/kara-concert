begin;

create table public.gemini_outputs (
  job_id uuid not null references public.import_jobs(id) on delete cascade,
  stage text not null check (stage in ('transcription', 'enrichment')),
  http_status smallint not null check (http_status between 100 and 599),
  response jsonb not null check (jsonb_typeof(response) = 'object' and octet_length(response::text) <= 2000000),
  created_at timestamptz not null default clock_timestamp(),
  primary key (job_id, stage)
);

alter table public.gemini_outputs enable row level security;
revoke all on table public.gemini_outputs from public, anon, authenticated;
grant select, insert, delete on table public.gemini_outputs to service_role;

create function public.record_gemini_output(
  p_job_id uuid,
  p_lease_token uuid,
  p_stage text,
  p_http_status integer,
  p_response jsonb
)
returns boolean
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  found_job public.import_jobs%rowtype;
  expected_status text;
begin
  if p_stage = 'transcription' then expected_status := 'transcribing';
  elsif p_stage = 'enrichment' then expected_status := 'enriching';
  else raise exception using errcode = '22023', message = 'INVALID_GEMINI_OUTPUT';
  end if;
  if p_http_status is null or p_http_status not between 100 and 599
     or p_response is null or jsonb_typeof(p_response) <> 'object'
     or octet_length(p_response::text) > 2000000 then
    raise exception using errcode = '22023', message = 'INVALID_GEMINI_OUTPUT';
  end if;

  select j.* into found_job from public.import_jobs j where j.id = p_job_id for update;
  if not found or found_job.status <> expected_status
     or found_job.lease_token is distinct from p_lease_token
     or found_job.deadline_at <= clock_timestamp() then return false;
  end if;

  insert into public.gemini_outputs(job_id, stage, http_status, response)
    values (p_job_id, p_stage, p_http_status::smallint, p_response);
  return true;
end;
$$;

revoke execute on function public.record_gemini_output(uuid, uuid, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_gemini_output(uuid, uuid, text, integer, jsonb)
  to service_role;

commit;
