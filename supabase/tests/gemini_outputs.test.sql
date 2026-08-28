begin;
select plan(8);

insert into public.import_jobs(id,video_id,status,stage,lease_token,admitted_at,deadline_at)
values ('73000000-0000-4000-8000-000000000001','rawoutput01','enriching','enriching',
  '74000000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp()+interval '4 minutes');

select ok(public.record_gemini_output(
  '73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',
  'enrichment',200,'{"status":"completed","steps":[]}'::jsonb),
  'active lease stores a raw Gemini response');
select is((select response->>'status' from public.gemini_outputs where job_id='73000000-0000-4000-8000-000000000001'),
  'completed','stored response remains queryable for debugging');
select is((select count(*) from public.gemini_outputs where job_id='73000000-0000-4000-8000-000000000001'),
  1::bigint,'only one response is stored for a job stage');
select throws_ok($$select public.record_gemini_output(
  '73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',
  'other',200,'{}'::jsonb)$$,'22023','INVALID_GEMINI_OUTPUT','invalid stage is rejected');
select throws_ok($$select public.record_gemini_output(
  '73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',
  'enrichment',99,'{}'::jsonb)$$,'22023','INVALID_GEMINI_OUTPUT','invalid HTTP status is rejected');
select throws_ok($$select public.record_gemini_output(
  '73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',
  'enrichment',200,'[]'::jsonb)$$,'22023','INVALID_GEMINI_OUTPUT','non-object response is rejected');
select ok(not public.record_gemini_output(
  '73000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000003',
  'enrichment',200,'{}'::jsonb),'stale lease cannot store output');
select throws_ok($$select public.record_gemini_output(
  '73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000002',
  'enrichment',200,jsonb_build_object('data',repeat('x',2000001)))$$,
  '22023','INVALID_GEMINI_OUTPUT','oversized response is rejected');

select * from finish();
rollback;
