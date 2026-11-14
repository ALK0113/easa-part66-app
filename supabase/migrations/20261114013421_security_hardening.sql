-- Endurecimiento de seguridad tras revisión de Supabase advisors (2026-11-14)

-- 1. get_student_stats: SECURITY DEFINER sin control de acceso, ejecutable por anon.
--    No se usa desde el frontend: se retira de la API pública.
revoke execute on function public.get_student_stats(uuid) from public, anon, authenticated;
alter function public.get_student_stats(uuid) set search_path = public;

-- 2. Funciones de trigger: no deben poder invocarse vía /rest/v1/rpc.
--    Los triggers siguen funcionando (se ejecutan con permisos del propietario).
revoke execute on function public.handle_new_auth_profile() from public, anon, authenticated;
revoke execute on function public.protect_role_column() from public, anon, authenticated;
revoke execute on function public.protect_student_sensitive_columns() from public, anon, authenticated;

-- 3. search_path fijo
alter function private.validate_email(text) set search_path = public;

-- 4. Resto de funciones SECURITY DEFINER ejecutables sin sesión.
--    Solo se usan con usuario autenticado (frontend o políticas RLS de
--    `authenticated`); se retira el acceso a anon como defensa en profundidad.
revoke execute on function public.admin_list_schools_with_stats() from public, anon;
revoke execute on function public.admin_update_school_brand(uuid, text) from public, anon;
revoke execute on function public.check_is_admin() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_student_owner(uuid) from public, anon;
