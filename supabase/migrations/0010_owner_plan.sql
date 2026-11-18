-- Owner plan: no expiry, no location/keyword/scan limits, effectively unlimited AI credits.
insert into public.plans (id, name, price_inr, location_limit, monthly_credits, keyword_limit, scan_limit, features)
values ('owner', 'Owner (Unlimited)', 0, 1000000, 1000000, 1000000, 1000000, '["Unlimited locations","Unlimited AI credits","No expiry"]'::jsonb)
on conflict (id) do update set name = excluded.name, location_limit = excluded.location_limit, monthly_credits = excluded.monthly_credits,
  keyword_limit = excluded.keyword_limit, scan_limit = excluded.scan_limit, features = excluded.features;

-- Move every super admin to the owner plan with a far-future end date.
update public.subscriptions s set plan_id = 'owner', status = 'active', period_end = date '2099-12-31'
where s.user_id in (select id from public.profiles where role = 'super_admin');
update public.profiles set ai_credits = 1000000 where role = 'super_admin';
