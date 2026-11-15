-- Fase 5: cierre de curso y limpieza. 2026-11-15

-- ---------------------------------------------------------------------------
-- 1. Cerrar un curso escolar y pasar a los alumnos al siguiente
-- ---------------------------------------------------------------------------
-- p_plan: [{ "student_id": uuid, "status": "promociona"|"cursando"|"finalizado"|"baja",
--            "group_id": uuid|null,                       -- grupo principal del curso nuevo
--            "carryovers": [{ "degree_module_id": uuid, "group_id": uuid }] }]
-- Los alumnos con grupo nuevo quedan matriculados en los módulos de su nuevo curso
-- (si p_enroll_level_modules) y en los módulos que arrastran, con el grupo indicado.
create or replace function public.admin_close_academic_year(p_from_year uuid, p_to_year uuid, p_plan jsonb, p_enroll_level_modules boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid;
  v_item jsonb;
  v_carry jsonb;
  v_group record;
  v_students integer := 0;
  v_carryovers integer := 0;
begin
  select school_id into v_school from public.academic_years where id = p_from_year;
  if v_school is null or v_school is distinct from (select school_id from public.academic_years where id = p_to_year) then
    raise exception using errcode = '22023', message = 'Los dos cursos escolares deben ser de la misma escuela.';
  end if;
  if not private.can_manage_school(v_school) then
    raise exception using errcode = '42501', message = 'Solo administración puede cerrar el curso.';
  end if;
  if p_from_year = p_to_year then
    raise exception using errcode = '22023', message = 'Elige un curso escolar distinto.';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Plan no válido.';
  end if;

  -- el curso nuevo pasa a ser el actual
  update public.academic_years set is_current = false where school_id = v_school and is_current and id <> p_to_year;
  update public.academic_years set is_current = true where id = p_to_year;

  for v_item in select * from jsonb_array_elements(p_plan) loop
    update public.enrollments set status = coalesce(v_item->>'status', 'promociona')
    where student_id = (v_item->>'student_id')::uuid and academic_year_id = p_from_year;

    if nullif(v_item->>'group_id', '') is null then continue; end if;

    select g.id, g.level, g.degree_id into v_group from public.class_groups g
    where g.id = (v_item->>'group_id')::uuid and g.academic_year_id = p_to_year;
    if v_group.id is null then raise exception using errcode = '23503', message = 'Grupo del curso nuevo no válido.'; end if;

    insert into public.enrollments (student_id, academic_year_id, group_id, level)
    values ((v_item->>'student_id')::uuid, p_to_year, v_group.id, v_group.level)
    on conflict (student_id, academic_year_id) do update set group_id = excluded.group_id, level = excluded.level, status = 'cursando';
    v_students := v_students + 1;

    -- solo quien sube de curso se matricula en los módulos del curso nuevo
    if p_enroll_level_modules and v_group.level > coalesce((select level from public.enrollments
        where student_id = (v_item->>'student_id')::uuid and academic_year_id = p_from_year), 0) then
      insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
      select (v_item->>'student_id')::uuid, dm.id, p_to_year, v_group.id
      from public.degree_modules dm where dm.degree_id = v_group.degree_id and dm.level = v_group.level
      on conflict (student_id, degree_module_id, academic_year_id) do nothing;
    end if;

    for v_carry in select * from jsonb_array_elements(coalesce(v_item->'carryovers', '[]')) loop
      if not exists (select 1 from public.class_groups where id = (v_carry->>'group_id')::uuid and academic_year_id = p_to_year) then
        raise exception using errcode = '23503', message = 'Grupo de módulo arrastrado no válido.';
      end if;
      insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id, is_carryover)
      values ((v_item->>'student_id')::uuid, (v_carry->>'degree_module_id')::uuid, p_to_year, (v_carry->>'group_id')::uuid, true)
      on conflict (student_id, degree_module_id, academic_year_id) do update set group_id = excluded.group_id, is_carryover = true;
      v_carryovers := v_carryovers + 1;
    end loop;

    -- texto de compatibilidad del alumno (curso y grupo)
    update public.students set class_name = v_group.level || 'º',
      group_name = v_group.level || 'º' || (select name from public.class_groups where id = v_group.id)
    where id = (v_item->>'student_id')::uuid;
  end loop;

  -- tablas antiguas: los módulos del curso nuevo ya se añadieron al matricular;
  -- se quitan los que solo eran del curso cerrado
  delete from public.student_modules sm
  where exists (select 1 from public.students s where s.id = sm.student_id and s.school_id = v_school)
    and not exists (select 1 from public.module_enrollments me join public.degree_modules dm on dm.id = me.degree_module_id
                    where me.student_id = sm.student_id and me.academic_year_id = p_to_year and dm.module_id = sm.module_id);
  delete from public.teacher_modules tm
  where exists (select 1 from public.school_profiles sp where sp.profile_id = tm.profile_id and sp.school_id = v_school)
    and not exists (select 1 from public.teaching_assignments ta join public.degree_modules dm on dm.id = ta.degree_module_id
                    join public.class_groups g on g.id = ta.group_id
                    where ta.profile_id = tm.profile_id and g.academic_year_id = p_to_year and dm.module_id = tm.module_id);

  perform private.log_admin_action('close_academic_year', 'academic_year', p_from_year,
    jsonb_build_object('to_year', p_to_year, 'students', v_students, 'carryovers', v_carryovers));
  return jsonb_build_object('students', v_students, 'carryovers', v_carryovers);
end;
$$;
revoke all on function public.admin_close_academic_year(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.admin_close_academic_year(uuid, uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. `records` duplicaba `practice_records`: deja de escribirse y se archiva
-- ---------------------------------------------------------------------------
create or replace function public.set_attendance(p_student_id uuid, p_practice_id text, p_attendance text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text := private.current_profile_role(); v_module_id text;
begin
  if v_role is null or v_role not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para cambiar asistencia.';
  end if;
  if p_attendance is null or p_attendance not in ('P', 'L', 'A') then
    raise exception using errcode = '22023', message = 'Estado de asistencia no válido.';
  end if;
  select module_id into v_module_id from public.practices where id = p_practice_id;
  if not found then raise exception using errcode = '23503', message = 'Práctica no encontrada.'; end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if v_role = 'profesor' and not (private.has_teacher_module(v_module_id) and private.is_teacher_for_student(p_student_id::text)) then
    raise exception using errcode = '42501', message = 'Este alumno no es de tus grupos en este módulo.';
  end if;
  if not exists (select 1 from public.student_modules where student_id = p_student_id::text and module_id = v_module_id)
     and not exists (select 1 from public.students s where s.id = p_student_id and v_module_id = any(coalesce(s.modules, array[]::text[]))) then
    raise exception using errcode = '23503', message = 'El alumno no está matriculado en el módulo.';
  end if;
  insert into public.practice_records (student_id, practice_id, attendance, updated_by, updated_at)
  values (p_student_id::text, p_practice_id, p_attendance, auth.uid(), now())
  on conflict (student_id, practice_id) do update set attendance = excluded.attendance, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.set_evaluation(p_student_id uuid, p_practice_id text, p_evaluation text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text := private.current_profile_role(); v_module_id text;
begin
  if v_role is null or v_role not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para cambiar evaluaciones.';
  end if;
  if p_evaluation is not null and p_evaluation not in ('Apto', 'No Apto') then
    raise exception using errcode = '22023', message = 'Evaluación no válida.';
  end if;
  select module_id into v_module_id from public.practices where id = p_practice_id;
  if not found then raise exception using errcode = '23503', message = 'Práctica no encontrada.'; end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if v_role = 'profesor' and not (private.has_teacher_module(v_module_id) and private.is_teacher_for_student(p_student_id::text)) then
    raise exception using errcode = '42501', message = 'Este alumno no es de tus grupos en este módulo.';
  end if;
  if not exists (select 1 from public.student_modules where student_id = p_student_id::text and module_id = v_module_id)
     and not exists (select 1 from public.students s where s.id = p_student_id and v_module_id = any(coalesce(s.modules, array[]::text[]))) then
    raise exception using errcode = '23503', message = 'El alumno no está matriculado en el módulo.';
  end if;
  insert into public.practice_records (student_id, practice_id, evaluation, updated_by, updated_at)
  values (p_student_id::text, p_practice_id, p_evaluation, auth.uid(), now())
  on conflict (student_id, practice_id) do update set evaluation = excluded.evaluation, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

-- Se conserva como archivo, fuera de la API.
alter table if exists public.records rename to records_archive;
revoke all on public.records_archive from anon, authenticated;
