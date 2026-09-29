alter table public.content_posts drop constraint if exists content_posts_status_check;
alter table public.content_posts add constraint content_posts_status_check check (status in ('draft','scheduled','publishing','published','failed'));
