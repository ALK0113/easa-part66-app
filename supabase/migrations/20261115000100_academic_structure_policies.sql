-- Las políticas de escritura `for all` duplicaban la de lectura (advisor multiple_permissive_policies).
-- Se separan en insert/update/delete. No cambia quién puede hacer qué.

drop policy if exists degrees_write on public.degrees;
create policy degrees_insert on public.degrees for insert to authenticated with check (private.can_manage_school(school_id));
create policy degrees_update on public.degrees for update to authenticated using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));
create policy degrees_delete on public.degrees for delete to authenticated using (private.can_manage_school(school_id));

drop policy if exists degree_modules_write on public.degree_modules;
create policy degree_modules_insert on public.degree_modules for insert to authenticated with check (private.can_manage_school(private.degree_school(degree_id)));
create policy degree_modules_update on public.degree_modules for update to authenticated using (private.can_manage_school(private.degree_school(degree_id))) with check (private.can_manage_school(private.degree_school(degree_id)));
create policy degree_modules_delete on public.degree_modules for delete to authenticated using (private.can_manage_school(private.degree_school(degree_id)));

drop policy if exists academic_years_write on public.academic_years;
create policy academic_years_insert on public.academic_years for insert to authenticated with check (private.can_manage_school(school_id));
create policy academic_years_update on public.academic_years for update to authenticated using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));
create policy academic_years_delete on public.academic_years for delete to authenticated using (private.can_manage_school(school_id));

drop policy if exists cohorts_write on public.cohorts;
create policy cohorts_insert on public.cohorts for insert to authenticated with check (private.can_manage_school(school_id));
create policy cohorts_update on public.cohorts for update to authenticated using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));
create policy cohorts_delete on public.cohorts for delete to authenticated using (private.can_manage_school(school_id));

drop policy if exists class_groups_write on public.class_groups;
create policy class_groups_insert on public.class_groups for insert to authenticated with check (private.can_manage_school(private.year_school(academic_year_id)));
create policy class_groups_update on public.class_groups for update to authenticated using (private.can_manage_school(private.year_school(academic_year_id))) with check (private.can_manage_school(private.year_school(academic_year_id)));
create policy class_groups_delete on public.class_groups for delete to authenticated using (private.can_manage_school(private.year_school(academic_year_id)));

drop policy if exists enrollments_write on public.enrollments;
create policy enrollments_insert on public.enrollments for insert to authenticated with check (private.can_manage_school(private.year_school(academic_year_id)));
create policy enrollments_update on public.enrollments for update to authenticated using (private.can_manage_school(private.year_school(academic_year_id))) with check (private.can_manage_school(private.year_school(academic_year_id)));
create policy enrollments_delete on public.enrollments for delete to authenticated using (private.can_manage_school(private.year_school(academic_year_id)));

drop policy if exists module_enrollments_write on public.module_enrollments;
create policy module_enrollments_insert on public.module_enrollments for insert to authenticated with check (private.can_manage_school(private.year_school(academic_year_id)));
create policy module_enrollments_update on public.module_enrollments for update to authenticated using (private.can_manage_school(private.year_school(academic_year_id))) with check (private.can_manage_school(private.year_school(academic_year_id)));
create policy module_enrollments_delete on public.module_enrollments for delete to authenticated using (private.can_manage_school(private.year_school(academic_year_id)));
