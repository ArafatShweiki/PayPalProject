begin;
select plan(10);

-- Fixture initialization runs under trusted service_role, never the client role.
set local role service_role;
select public.walletwise_initialize_user('auth0|walletwise-test-a');
select public.walletwise_initialize_user('paypal|opaque-subject-b');
select public.walletwise_apply_transaction(
  'auth0|walletwise-test-a','11111111-1111-4111-8111-111111111111','fingerprint-v1',
  'opening','Test fixture','Opening',
  '[{"currency":"ILS","account":"available","amount_minor":101},{"currency":"ILS","account":"external","amount_minor":-101}]'
);
select is((select available_minor from public.wallets where auth0_sub='auth0|walletwise-test-a' and currency='ILS'),
  101::bigint, 'trusted transaction RPC updates balances atomically');
select public.walletwise_apply_transaction(
  'auth0|walletwise-test-a','11111111-1111-4111-8111-111111111111','fingerprint-v1',
  'opening','Test fixture','Opening',
  '[{"currency":"ILS","account":"available","amount_minor":101},{"currency":"ILS","account":"external","amount_minor":-101}]'
);
select is((select count(*)::int from public.transactions where request_id='11111111-1111-4111-8111-111111111111'),
  1, 'replayed idempotency key does not duplicate transaction');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"auth0|walletwise-test-a","aud":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 1, 'profile reads are limited to verified subject');
select is((select count(*)::int from public.wallets), 3, 'own empty currency wallets are visible');
select is((select count(*)::int from public.transactions), 1, 'only this subject’s transactions are visible');
select is((select available_minor from public.wallets where currency='JOD'), 0::bigint, 'new JOD wallet is empty');
select throws_ok(
  $$insert into public.profiles(auth0_sub) values ('paypal|opaque-subject-b')$$,
  '42501', null, 'authenticated client cannot insert profiles'
);
select throws_ok(
  $$update public.wallets set available_minor=100 where currency='ILS'$$,
  '42501', null, 'authenticated client cannot directly change wallet balances'
);
select throws_ok(
  $$insert into public.ledger_entries(transaction_id,auth0_sub,currency,account,amount_minor)
    values(gen_random_uuid(),'auth0|walletwise-test-a','ILS','available',100)$$,
  '42501', null, 'authenticated client cannot directly write ledger entries'
);
select set_config('request.jwt.claims',
  '{"role":"user","sub":"auth0|walletwise-test-a","aud":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 0, 'JWT without authenticated role claim receives no profile rows');

select * from finish();
rollback;
