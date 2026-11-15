-- Limpieza sin cambio de comportamiento:
-- 1. Una sola fuente para «es administrador»: private.is_global_admin(). Las demás la delegan.
-- 2. Políticas de escritura duplicadas (admin + supervisor por separado) unidas en una por tabla.
--    La política restrictiva de escuela (*_school_isolation) y las de lectura no cambian.
-- 3. Claves foráneas repetidas eliminadas (dejaban ambiguos los embeds de la API).

-- 1. Comprobaciones de admin
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to ''
as $$ select private.is_global_admin(); $$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path to ''
as $$ select private.is_global_admin(); $$;

create or replace function public.check_is_admin()
returns boolean language sql stable security definer set search_path to ''
as $$ select private.is_global_admin(); $$;

-- 2. Políticas de escritura
drop policy if exists students_staff_write on public.students;
drop policy if exists students_supervisor_all on public.students;
create policy students_manage on public.students for all to authenticated
  using (private.is_global_admin() or (private.is_supervisor() and school_id = private.current_school_id()))
  with check (private.is_global_admin() or (private.is_supervisor() and school_id = private.current_school_id()));

drop policy if exists practices_staff_write on public.practices;
drop policy if exists practices_supervisor_all on public.practices;
create policy practices_manage on public.practices for all to authenticated
  using (
    private.is_global_admin()
    or (private.is_supervisor() and school_id = private.current_school_id())
    or exists (select 1 from public.teacher_modules tm where tm.profile_id = (select auth.uid()) and tm.module_id = practices.module_id)
  )
  with check (
    private.is_global_admin()
    or (private.is_supervisor() and school_id = private.current_school_id())
    or exists (select 1 from public.teacher_modules tm where tm.profile_id = (select auth.uid()) and tm.module_id = practices.module_id)
  );

drop policy if exists student_modules_admin_write on public.student_modules;
drop policy if exists student_modules_supervisor_all on public.student_modules;
create policy student_modules_manage on public.student_modules for all to authenticated
  using (private.is_global_admin() or (private.is_supervisor() and private.student_in_my_school(student_id::text)))
  with check (private.is_global_admin() or (private.is_supervisor() and private.student_in_my_school(student_id::text)));

drop policy if exists teacher_modules_admin_write on public.teacher_modules;
drop policy if exists teacher_modules_supervisor_all on public.teacher_modules;
create policy teacher_modules_manage on public.teacher_modules for all to authenticated
  using (private.is_global_admin() or (private.is_supervisor() and private.profile_in_my_school(profile_id)))
  with check (private.is_global_admin() or (private.is_supervisor() and private.profile_in_my_school(profile_id)));

-- 3. Claves foráneas repetidas (se conservan las que tienen ON DELETE CASCADE)
alter table public.defects drop constraint if exists defects_tlb_fk;
alter table public.student_modules drop constraint if exists student_modules_module_fk;
