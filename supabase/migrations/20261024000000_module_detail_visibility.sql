drop policy if exists teacher_modules_read on public.teacher_modules;
create policy teacher_modules_read on public.teacher_modules
  for select to authenticated
  using (
    private.current_profile_role() = 'admin'
    or profile_id = auth.uid()
    or private.is_student_in_module(module_id)
  );

drop policy if exists profiles_read_associated_teachers on public.profiles;
create policy profiles_read_associated_teachers on public.profiles
  for select to authenticated
  using (
    role::text = 'profesor'
    and exists (
      select 1 from public.teacher_modules tm
      where tm.profile_id = profiles.id
        and (
          private.current_profile_role() = 'admin'
          or private.has_teacher_module(tm.module_id)
          or private.is_student_in_module(tm.module_id)
        )
    )
  );