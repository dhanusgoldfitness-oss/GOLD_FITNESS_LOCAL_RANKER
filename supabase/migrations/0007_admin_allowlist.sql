-- Emails that become super_admin automatically when they sign up (or immediately if they already have an account).
create table if not exists public.admin_emails (email text primary key check (email = lower(email)));
alter table public.admin_emails enable row level security;   -- no policies: server/SQL only
insert into public.admin_emails values ('prashanthdgf@gmail.com') on conflict do nothing;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
          case when exists (select 1 from public.admin_emails a where a.email = lower(new.email)) then 'super_admin' else 'owner' end);
  return new;
end $$;

update public.profiles set role = 'super_admin' where lower(email) in (select email from public.admin_emails);
