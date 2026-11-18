-- Review sync upserts mix rows with and without Google replies; PostgREST sends NULL for the
-- missing columns, which violated NOT NULL on reply_status. Fill defaults and keep local drafts.
create or replace function public.reviews_fill_reply_defaults() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.reply_status := coalesce(new.reply_status, 'none');
  else
    new.reply_status := coalesce(new.reply_status, old.reply_status, 'none');
    new.reply_text   := coalesce(new.reply_text, old.reply_text);
    new.reply_time   := coalesce(new.reply_time, old.reply_time);
  end if;
  return new;
end $$;

drop trigger if exists reviews_fill_reply_defaults on public.reviews;
create trigger reviews_fill_reply_defaults before insert or update on public.reviews
for each row execute function public.reviews_fill_reply_defaults();

revoke execute on function public.reviews_fill_reply_defaults() from public, anon, authenticated;
