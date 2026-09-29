-- Phases 10-24: keywords, geo-grid, competitors, performance, reports, leads, automation, WhatsApp, jobs, AI media
alter table public.plans add column if not exists keyword_limit int not null default 5;
alter table public.plans add column if not exists scan_limit int not null default 2;
update public.plans set keyword_limit = 5, scan_limit = 2 where id = 'trial';
update public.plans set keyword_limit = 25, scan_limit = 20 where id = 'growth';
update public.plans set keyword_limit = 100, scan_limit = 100 where id = 'pro';
alter table public.business_locations add column if not exists place_id text;
alter table public.business_locations add column if not exists lat double precision;
alter table public.business_locations add column if not exists lng double precision;

create table public.keywords (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  keyword text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (location_id, keyword)
);
create table public.keyword_rank_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  keyword_id uuid not null references public.keywords(id) on delete cascade,
  rank int,                       -- null = not in top results (or check failed)
  status text not null default 'ok' check (status in ('ok','not_found','failed')),
  error text,
  checked_at timestamptz not null default now()
);
create index on public.keyword_rank_history (keyword_id, checked_at desc);
create index on public.keyword_rank_history (user_id);

create table public.geo_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  keyword text not null,
  center_lat double precision not null, center_lng double precision not null,
  grid_size int not null check (grid_size in (3,5,7)),
  radius_km numeric(5,2) not null,
  status text not null default 'running' check (status in ('running','done','partial','failed')),
  created_at timestamptz not null default now()
);
create table public.geo_scan_points (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.geo_scans(id) on delete cascade,
  idx int not null, lat double precision not null, lng double precision not null,
  rank int, status text not null default 'ok' check (status in ('ok','not_found','failed')),
  error text, checked_at timestamptz not null default now()
);
create index on public.geo_scan_points (scan_id);
create index on public.geo_scans (user_id);
create index on public.geo_scans (location_id);

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  place_id text not null, name text not null, address text,
  created_at timestamptz not null default now(),
  unique (location_id, place_id)
);
create table public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  rating numeric(3,2), review_count int, primary_type text, source text not null default 'google_places',
  captured_at timestamptz not null default now()
);
create index on public.competitor_snapshots (competitor_id, captured_at desc);
create index on public.competitors (user_id);
create index on public.competitors (location_id);

create table public.performance_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  metric text not null, day date not null, value int not null,
  synced_at timestamptz not null default now(),
  unique (location_id, metric, day)
);
create index on public.performance_metrics (user_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid references public.business_locations(id) on delete set null,
  title text not null, period_start date not null, period_end date not null,
  snapshot jsonb not null,        -- frozen at generation: later data never changes a past report
  created_at timestamptz not null default now()
);
create index on public.reports (user_id);
create index on public.reports (location_id);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, phone text, source text not null default 'manual', interest text, assigned_to text,
  status text not null default 'new' check (status in ('new','contacted','interested','trial_booked','visited','joined','lost')),
  next_follow_up date, member_ref text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.leads (user_id, status);
create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  body text not null, created_at timestamptz not null default now()
);
create index on public.lead_notes (lead_id);
create index on public.lead_notes (user_id);
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null, detail text, created_at timestamptz not null default now()
);
create index on public.lead_activities (lead_id);
create index on public.lead_activities (user_id);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  trigger text not null check (trigger in ('negative_review','new_lead','rank_drop','failed_post')),
  condition jsonb not null default '{}',
  action text not null check (action in ('notify','whatsapp_owner','draft_review_reply','whatsapp_lead')),
  action_config jsonb not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.automation_rules (user_id);
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  event_key text not null, ok boolean not null, error text,
  created_at timestamptz not null default now(),
  unique (rule_id, event_key)     -- idempotency: the same event never runs a rule twice
);
create index on public.automation_runs (user_id);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null check (direction in ('out','in')),
  to_number text, from_number text, body text,
  provider_id text, status text not null default 'queued', error text,
  created_at timestamptz not null default now()
);
create index on public.whatsapp_messages (user_id, created_at desc);
create index on public.whatsapp_messages (provider_id);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null, window_key text not null,
  status text not null default 'running' check (status in ('running','ok','failed')),
  detail text, started_at timestamptz not null default now(), finished_at timestamp with time zone,
  unique (job, window_key)        -- job lock / idempotency: duplicate scheduler invocations cannot double-run
);

create table public.ai_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid references public.business_locations(id) on delete set null,
  prompt text not null, storage_path text not null,
  status text not null default 'draft' check (status in ('draft','approved')),
  created_at timestamptz not null default now()
);
create index on public.ai_media (user_id);
create index on public.ai_media (location_id);

do $$
declare t text;
begin
  foreach t in array array['keywords','keyword_rank_history','geo_scans','competitors','performance_metrics','reports','leads','lead_notes','lead_activities','automation_rules','automation_runs','whatsapp_messages','ai_media']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (user_id = (select auth.uid()) or public.is_super_admin())', t||'_owner_read', t);
  end loop;
end $$;
alter table public.geo_scan_points enable row level security;
create policy geo_points_read on public.geo_scan_points for select using (exists (select 1 from public.geo_scans s where s.id = scan_id and (s.user_id = (select auth.uid()) or public.is_super_admin())));
alter table public.competitor_snapshots enable row level security;
create policy comp_snap_read on public.competitor_snapshots for select using (exists (select 1 from public.competitors c where c.id = competitor_id and (c.user_id = (select auth.uid()) or public.is_super_admin())));
alter table public.job_runs enable row level security;
create policy job_runs_admin on public.job_runs for select using (public.is_super_admin());
create trigger trg_leads_upd before update on public.leads for each row execute function public.set_updated_at();
