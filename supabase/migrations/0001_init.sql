-- DGF Local Ranker — initial schema (phases 0-9 + billing modules)
create extension if not exists "pgcrypto";

-- ---------- helpers ----------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  role text not null default 'owner' check (role in ('super_admin','owner','manager','staff','client')),
  ai_credits int not null default 10,
  notif_whatsapp boolean not null default false,
  notif_review_alerts boolean not null default true,
  notif_email boolean not null default true,
  auto_reply boolean not null default false,
  reply_tone text not null default 'friendly',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_upd before update on public.profiles for each row execute function public.set_updated_at();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin');
$$;

-- ---------- google connections (tokens encrypted by backend; NO client access) ----------
create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_email text,
  google_name text,
  google_picture text,
  status text not null default 'NOT_CONNECTED' check (status in ('NOT_CONNECTED','CONNECTING','CONNECTED','API_PENDING','REAUTH_REQUIRED','ERROR')),
  status_detail text,
  refresh_token_enc text,
  scopes text,
  connected_at timestamptz,
  last_checked_at timestamptz,
  unique (user_id)
);

-- ---------- locations ----------
create table public.business_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_account_id text not null,
  google_location_id text not null,
  title text not null,
  store_code text,
  address text,
  city text,
  phone text,
  website text,
  primary_category text,
  verified boolean not null default false,
  enabled boolean not null default false,
  profile jsonb,
  last_synced_at timestamptz,
  reviews_synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_account_id, google_location_id)
);
create trigger trg_loc_upd before update on public.business_locations for each row execute function public.set_updated_at();

-- ---------- audits ----------
create table public.gbp_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  score int not null check (score between 0 and 100),
  breakdown jsonb not null,
  recommendations jsonb not null,
  rules_version text not null,
  created_at timestamptz not null default now()
);
create index on public.gbp_audits (location_id, created_at desc);

-- ---------- AI suggestions ----------
create table public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  kind text not null check (kind in ('description','categories','services','content')),
  payload jsonb not null,
  status text not null default 'draft' check (status in ('draft','approved','rejected','applied')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  model text,
  ok boolean not null default true,
  credits int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- reviews ----------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  google_review_id text not null,
  reviewer_name text,
  rating int not null check (rating between 1 and 5),
  comment text,
  sentiment text check (sentiment in ('positive','neutral','negative')),
  reply_text text,
  reply_status text not null default 'none' check (reply_status in ('none','draft','published')),
  reply_time timestamptz,
  review_time timestamptz,
  created_at timestamptz not null default now(),
  unique (location_id, google_review_id)
);
create index on public.reviews (location_id, review_time desc);

create table public.review_reply_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  action text not null,
  body text,
  created_at timestamptz not null default now()
);

-- ---------- posts ----------
create table public.content_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid references public.business_locations(id) on delete set null,
  post_type text not null default 'standard' check (post_type in ('standard','offer','event')),
  title text,
  body text not null,
  image_url text,
  status text not null default 'draft' check (status in ('draft','scheduled','published','failed')),
  scheduled_at timestamptz,
  external_ref text,
  publish_error text,
  created_at timestamptz not null default now()
);

-- ---------- notifications + audit ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  read boolean not null default false,
  dedupe_key text,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- ---------- plans / credits ----------
create table public.plans (
  id text primary key,
  name text not null,
  price_inr int not null default 0,
  location_limit int not null default 1,
  monthly_credits int not null default 0,
  features jsonb not null default '[]'
);
insert into public.plans (id, name, price_inr, location_limit, monthly_credits, features) values
 ('trial','Trial',0,1,10,'["Business Profile","Google Audit","Reviews","AI Replies"]'),
 ('growth','Growth',999,5,100,'["Business Profile","Google Audit","Reviews","AI Replies","Google Posts","Keywords"]'),
 ('pro','Pro',2499,20,400,'["Everything in Growth","Geo-grid","Competitors","Reports"]')
on conflict do nothing;
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'active',
  period_start date not null default current_date,
  period_end date not null default (current_date + 14),
  created_at timestamptz not null default now()
);

-- ---------- billing modules ----------
create table public.billing_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  business_type text default 'Service Business',
  business_name text, phone text, email text, address text, gstin text, state text,
  invoice_prefix text not null default 'INV',
  next_number int not null default 1,
  round_total boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, phone text, email text, status text not null default 'active',
  created_at timestamptz not null default now()
);
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, created_at timestamptz not null default now(),
  unique (user_id, name)
);
create table public.services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, category text, price numeric(12,2) not null default 0, unit text default 'each',
  status text not null default 'active', created_at timestamptz not null default now()
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  number text not null,
  customer_id uuid references public.customers(id) on delete set null,
  invoice_date date not null default current_date,
  due_date date,
  items jsonb not null default '[]',
  total numeric(12,2) not null default 0,
  paid numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','partially_paid','paid','cancelled')),
  created_at timestamptz not null default now(),
  unique (user_id, number)
);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expense_date date not null default current_date,
  title text not null, category text, method text, amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.google_connections enable row level security;   -- no policies => no client access
alter table public.business_locations enable row level security;
alter table public.gbp_audits enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.ai_usage enable row level security;
alter table public.reviews enable row level security;
alter table public.review_reply_log enable row level security;
alter table public.content_posts enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_settings enable row level security;
alter table public.customers enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;

create policy profiles_self_read on public.profiles for select using (id = auth.uid() or public.is_super_admin());
-- role / credits are backend-controlled: users may only edit safe columns via the API
create policy plans_read on public.plans for select using (true);
create policy audit_admin_read on public.audit_logs for select using (public.is_super_admin());

-- owner-read policies (writes go through the backend with the service role)
do $$
declare t text;
begin
  foreach t in array array['business_locations','gbp_audits','ai_suggestions','ai_usage','reviews','review_reply_log','content_posts','notifications','subscriptions','billing_settings','customers','service_categories','services','invoices','expenses']
  loop
    execute format('create policy %I on public.%I for select using (user_id = auth.uid() or public.is_super_admin())', t||'_owner_read', t);
  end loop;
end $$;

-- storage bucket for AI / uploaded media
insert into storage.buckets (id, name, public) values ('dgf-media','dgf-media', false) on conflict do nothing;
