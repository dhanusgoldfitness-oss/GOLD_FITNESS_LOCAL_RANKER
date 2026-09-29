-- rls_auto_enable() is a SECURITY DEFINER helper; it must not be callable through the REST API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
