-- Un profesor solo ve información de los alumnos a los que da clase
-- (alumnos matriculados en alguno de sus módulos). 2026-11-14

-- ¿El profesor actual da clase al alumno con este perfil de usuario?
create or replace function private.is_teacher_for_profile(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.student_profiles sp
    where sp.profile_id = p_profile_id
      and private.is_teacher_for_student(sp.student_id::text)
  );
$$;

-- ¿Puede el usuario actual ver este perfil?
--  - el propio perfil y admin: siempre
--  - perfiles de staff (profesor, supervisor...): misma escuela
--  - perfiles de alumno: supervisor de su escuela o profesor que le da clase
create or replace function private.can_view_profile(p_target uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_target = (select auth.uid())
    or private.is_global_admin()
    or exists (
      select 1
      from public.profiles t
      join public.school_profiles st on st.profile_id = t.id
      join public.school_profiles su on su.school_id = st.school_id
                                    and su.profile_id = (select auth.uid())
      where t.id = p_target
        and (t.role <> 'alumno'
             or private.is_supervisor()
             or private.is_teacher_for_profile(t.id))
    );
$$;

revoke execute on function private.is_teacher_for_profile(uuid) from public, anon;
revoke execute on function private.can_view_profile(uuid) from public, anon;
grant execute on function private.is_teacher_for_profile(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;

-- 1. profiles: los alumnos dejan de ser visibles para toda la escuela
alter policy profiles_select on public.profiles
  using (private.can_view_profile(id));

-- 2. tlb_submissions: solo entregas de TLBs de sus módulos y de alumnos suyos
drop policy if exists "profesores ven todas las submissions" on public.tlb_submissions;
create policy tlb_submissions_teacher_read on public.tlb_submissions
  for select to authenticated
  using (
    private.is_global_admin()
    or exists (
      select 1 from public.tlbs t
      where t.id = tlb_submissions.tlb_id
        and private.has_teacher_module(t.module_id)
        and private.is_teacher_for_profile(tlb_submissions.student_id)
    )
  );

-- 3. student_actions: era legible sin sesión. No se usa en el frontend;
--    queda accesible solo para admin, el propio alumno y su profesor.
drop policy if exists "Allow public read access on student_actions" on public.student_actions;
create policy student_actions_read on public.student_actions
  for select to authenticated
  using (
    private.is_global_admin()
    or private.is_student_profile(student_id::text)
    or private.is_teacher_for_student(student_id::text)
  );
