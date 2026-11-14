-- Rendimiento según Supabase advisors (2026-11-14).
-- Ningún cambio altera quién puede leer o escribir qué.

-- 1. Índices duplicados
drop index if exists public.students_student_number_unique_idx; -- duplica la constraint students_student_number_key
drop index if exists public.idx_tlbs_practice;                  -- duplica tlbs_practice_id_idx

-- 2. Claves foráneas sin índice
create index if not exists practice_records_updated_by_idx on public.practice_records (updated_by);
create index if not exists records_practice_id_idx on public.records (practice_id);
create index if not exists student_actions_tlb_id_idx on public.student_actions (tlb_id);

-- 3. Políticas redundantes (contenidas por completo en otra política)
drop policy if exists profiles_admin_emergency on public.profiles;                 -- ⊂ profiles_admin_all
drop policy if exists "alumnos ven sus submissions" on public.tlb_submissions;     -- ⊂ "alumnos gestionan sus submissions"

-- 4. auth.uid() evaluado una sola vez por consulta: (select auth.uid())
alter policy tlbs_staff_write on public.tlbs
  using ((private.current_profile_role() = 'admin') or exists (
    select 1 from public.teacher_modules tm
    where tm.profile_id = (select auth.uid()) and tm.module_id = tlbs.module_id))
  with check ((private.current_profile_role() = 'admin') or exists (
    select 1 from public.teacher_modules tm
    where tm.profile_id = (select auth.uid()) and tm.module_id = tlbs.module_id));

alter policy videos_staff_write on public.videos
  using ((private.current_profile_role() = 'admin') or exists (
    select 1 from public.teacher_modules tm
    where tm.profile_id = (select auth.uid()) and tm.module_id = videos.module_id))
  with check ((private.current_profile_role() = 'admin') or exists (
    select 1 from public.teacher_modules tm
    where tm.profile_id = (select auth.uid()) and tm.module_id = videos.module_id));

alter policy defects_staff_write on public.defects
  using ((private.current_profile_role() = 'admin') or exists (
    select 1 from public.tlbs t join public.teacher_modules tm on tm.module_id = t.module_id
    where tm.profile_id = (select auth.uid()) and t.id = defects.tlb_id))
  with check ((private.current_profile_role() = 'admin') or exists (
    select 1 from public.tlbs t join public.teacher_modules tm on tm.module_id = t.module_id
    where tm.profile_id = (select auth.uid()) and t.id = defects.tlb_id));

alter policy records_authenticated_read on public.records
  using ((private.current_profile_role() = 'admin')
    or private.is_student_profile(student_id::text)
    or exists (
      select 1 from public.teacher_modules tm join public.practices p on p.module_id = tm.module_id
      where tm.profile_id = (select auth.uid()) and p.id = records.practice_id));

alter policy admin_audit_log_select_admin on public.admin_audit_log
  using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid()) and profiles.role = 'admin'));

alter policy profiles_admin_all on public.profiles
  using ((id::text = (select auth.uid())::text) or private.is_admin())
  with check ((id::text = (select auth.uid())::text) or private.is_admin());

alter policy profiles_update on public.profiles
  using ((id::text = (select auth.uid())::text) or private.is_admin())
  with check ((id::text = (select auth.uid())::text) or private.is_admin());

alter policy profiles_select on public.profiles
  using ((id::text = (select auth.uid())::text) or private.is_admin() or exists (
    select 1 from public.school_profiles sp_user
    join public.school_profiles sp_target on sp_target.school_id = sp_user.school_id
    where sp_user.profile_id::text = (select auth.uid())::text
      and sp_target.profile_id::text = profiles.id::text));

-- tlb_submissions: las políticas aplicaban a `public` (incluido anon, que nunca
-- tiene auth.uid()); se limitan a `authenticated`.
alter policy "alumnos gestionan sus submissions" on public.tlb_submissions
  to authenticated
  using ((select auth.uid()) = student_id)
  with check ((select auth.uid()) = student_id);

alter policy "profesores ven todas las submissions" on public.tlb_submissions
  to authenticated
  using (exists (select 1 from public.teacher_modules where teacher_modules.profile_id = (select auth.uid()))
    or exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin'));
