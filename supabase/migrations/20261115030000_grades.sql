-- Fase 4: notas por módulo. 2026-11-15
-- Teoría: nota numérica con la escala de la escuela (grade_max / pass_mark).
-- Práctica: Apto / No apto. El estado del módulo se calcula solo.

create or replace function private.trg_module_enrollments_grade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_max numeric;
  v_pass numeric;
begin
  select dm.kind, sc.grade_max, sc.pass_mark into v_kind, v_max, v_pass
  from public.degree_modules dm
  join public.degrees d on d.id = dm.degree_id
  join public.schools sc on sc.id = d.school_id
  where dm.id = new.degree_module_id;

  if new.theory_grade is not null and new.theory_grade > v_max then
    raise exception using errcode = '22023', message = format('La nota máxima es %s.', v_max);
  end if;

  new.status := case
    when v_kind = 'teoria' and new.theory_grade is not null then case when new.theory_grade >= v_pass then 'aprobado' else 'suspendido' end
    when v_kind = 'practica' and new.practical_result is not null then case when new.practical_result = 'apto' then 'aprobado' else 'suspendido' end
    else 'cursando' end;

  if tg_op = 'INSERT' or new.theory_grade is distinct from old.theory_grade or new.practical_result is distinct from old.practical_result then
    new.graded_by := case when new.theory_grade is null and new.practical_result is null then null else auth.uid() end;
    new.graded_at := case when new.theory_grade is null and new.practical_result is null then null else now() end;
  end if;
  return new;
end;
$$;

drop trigger if exists module_enrollments_grade on public.module_enrollments;
create trigger module_enrollments_grade before insert or update of theory_grade, practical_result, degree_module_id on public.module_enrollments
  for each row execute function private.trg_module_enrollments_grade();
revoke all on function private.trg_module_enrollments_grade() from public, anon, authenticated;

-- Al cambiar la escala de una escuela se recalculan los estados
create or replace function private.trg_schools_grade_scale()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.module_enrollments me set status = case when me.theory_grade >= new.pass_mark then 'aprobado' else 'suspendido' end
  from public.degree_modules dm join public.degrees d on d.id = dm.degree_id
  where dm.id = me.degree_module_id and d.school_id = new.id and dm.kind = 'teoria' and me.theory_grade is not null;
  return null;
end;
$$;

drop trigger if exists schools_grade_scale on public.schools;
create trigger schools_grade_scale after update of pass_mark on public.schools
  for each row when (old.pass_mark is distinct from new.pass_mark)
  execute function private.trg_schools_grade_scale();
revoke all on function private.trg_schools_grade_scale() from public, anon, authenticated;

-- Califica un módulo de un alumno. Puede hacerlo administración o el profesor que
-- imparte ese módulo (teoría o práctica) a ese grupo, solo en el curso actual.
create or replace function public.set_module_grade(p_module_enrollment_id uuid, p_theory_grade numeric, p_practical_result text)
returns public.module_enrollments language plpgsql security definer set search_path = '' as $$
declare
  me record;
  v_row public.module_enrollments;
begin
  select m.id, m.group_id, m.degree_module_id, dm.kind, y.is_current, y.school_id into me
  from public.module_enrollments m
  join public.degree_modules dm on dm.id = m.degree_module_id
  join public.academic_years y on y.id = m.academic_year_id
  where m.id = p_module_enrollment_id;
  if me.id is null then raise exception using errcode = 'P0002', message = 'Matrícula no encontrada.'; end if;

  if not private.can_manage_school(me.school_id) then
    if not exists (select 1 from public.teaching_assignments ta
                   where ta.profile_id = (select auth.uid()) and ta.group_id = me.group_id and ta.degree_module_id = me.degree_module_id) then
      raise exception using errcode = '42501', message = 'Solo el profesor de este módulo y grupo puede calificar.';
    end if;
    if not me.is_current then
      raise exception using errcode = '42501', message = 'Ese curso escolar está cerrado.';
    end if;
  end if;

  if p_practical_result is not null and p_practical_result not in ('apto', 'no_apto') then
    raise exception using errcode = '22023', message = 'Resultado práctico no válido.';
  end if;
  if me.kind = 'teoria' and p_practical_result is not null then
    raise exception using errcode = '22023', message = 'Los módulos de teoría se califican con nota.';
  end if;
  if me.kind = 'practica' and p_theory_grade is not null then
    raise exception using errcode = '22023', message = 'Los módulos de práctica se califican como Apto o No apto.';
  end if;

  update public.module_enrollments set theory_grade = p_theory_grade, practical_result = p_practical_result
  where id = p_module_enrollment_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_module_grade(uuid, numeric, text) from public, anon;
grant execute on function public.set_module_grade(uuid, numeric, text) to authenticated;

-- El profesor puede leer las matrículas de sus clases (también las de alumnos que
-- arrastran el módulo con su grupo), aunque no compartan otro módulo.
alter policy module_enrollments_read on public.module_enrollments
  using (private.can_manage_school(private.year_school(academic_year_id))
    or private.is_student_profile(student_id::text)
    or exists (select 1 from public.teaching_assignments ta
               join public.degree_modules dta on dta.id = ta.degree_module_id
               join public.degree_modules dme on dme.id = module_enrollments.degree_module_id and dme.module_id = dta.module_id
               where ta.profile_id = (select auth.uid()) and ta.group_id = module_enrollments.group_id));

-- Recalcula los estados ya guardados con la regla nueva
update public.module_enrollments set theory_grade = theory_grade;
