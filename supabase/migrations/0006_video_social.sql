create table public.ai_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid references public.business_locations(id) on delete set null,
  prompt text not null,
  operation_name text,
  status text not null default 'processing' check (status in ('processing','ready','failed')),
  storage_path text,
  error text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ai_videos (user_id, created_at desc);
create index on public.ai_videos (location_id);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid references public.business_locations(id) on delete set null,
  topic text not null,
  platform text not null check (platform in ('instagram','facebook','x','whatsapp')),
  caption text not null,
  hashtags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','posted')),
  created_at timestamptz not null default now()
);
create index on public.social_posts (user_id, created_at desc);
create index on public.social_posts (location_id);

alter table public.ai_videos enable row level security;
alter table public.social_posts enable row level security;
create policy ai_videos_owner_read on public.ai_videos for select using (user_id = (select auth.uid()) or public.is_super_admin());
create policy social_posts_owner_read on public.social_posts for select using (user_id = (select auth.uid()) or public.is_super_admin());
create trigger trg_ai_videos_upd before update on public.ai_videos for each row execute function public.set_updated_at();
