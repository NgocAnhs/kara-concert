begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select results_eq($$select allowed, retry_after_seconds from public.consume_access_attempt('limit-test')$$,
  $$values (true, 0)$$, 'attempt ' || attempt || ' is allowed')
from generate_series(1, 10) attempt;
select results_eq($$select allowed, retry_after_seconds from public.consume_access_attempt('limit-test')$$,
  $$values (false, 900)$$, 'eleventh attempt is denied with the remaining window');
select is((select count(*) from public.access_attempts where ip_hash = 'limit-test'), 10::bigint,
  'denied requests do not extend the lockout');
select results_eq($$select allowed, retry_after_seconds from public.consume_access_attempt('separate-test')$$,
  $$values (true, 0)$$, 'another IP hash has an independent window');

update public.access_attempts set attempted_at = clock_timestamp() - interval '14 minutes'
where ip_hash = 'limit-test';
select results_eq($$select allowed, retry_after_seconds from public.consume_access_attempt('limit-test')$$,
  $$values (false, 60)$$, 'retry-after is based on the first attempt still in the window');
update public.access_attempts set attempted_at = clock_timestamp() - interval '15 minutes 1 second'
where ip_hash = 'limit-test';
select results_eq($$select allowed, retry_after_seconds from public.consume_access_attempt('limit-test')$$,
  $$values (true, 0)$$, 'expired attempts no longer block access');

select throws_ok($$select * from public.consume_access_attempt(null)$$, '22023', 'INVALID_IP_HASH', 'null hash is rejected');
select throws_ok($$select * from public.consume_access_attempt('')$$, '22023', 'INVALID_IP_HASH', 'empty hash is rejected');

create function pg_temp.reject_attempt() returns trigger language plpgsql as $$
begin raise exception using errcode = 'XX000', message = 'simulated storage failure'; end;
$$;
create trigger test_reject_attempt before insert on public.access_attempts
for each row execute function pg_temp.reject_attempt();
select throws_ok($$select * from public.consume_access_attempt('storage-error-test')$$, 'XX000', 'simulated storage failure',
  'database errors propagate instead of permitting access');
select is((select count(*) from public.access_attempts where ip_hash = 'storage-error-test'), 0::bigint,
  'failed writes leave no attempt');

select * from finish();
rollback;
