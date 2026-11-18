-- WhatsApp inbox: unread tracking for inbound messages and thread lookups.
alter table public.whatsapp_messages add column if not exists read_at timestamptz;
update public.whatsapp_messages set read_at = created_at where direction = 'in' and read_at is null;
create index if not exists whatsapp_messages_from_idx on public.whatsapp_messages (user_id, from_number, created_at desc);
create index if not exists whatsapp_messages_to_idx on public.whatsapp_messages (user_id, to_number, created_at desc);
