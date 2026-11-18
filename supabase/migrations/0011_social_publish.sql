-- Direct publishing to Instagram / Facebook Page via the Meta Graph API.
alter table public.social_posts add column if not exists image_url text, add column if not exists external_ref text, add column if not exists publish_error text;
