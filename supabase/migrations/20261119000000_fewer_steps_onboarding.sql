-- Menos pasos en las altas:
-- 1. Matricular en un grupo (curso actual + sus módulos) es una sola función, reutilizada al aprobar y al crear.
-- 2. Un alumno creado desde Perfiles nace con su ficha y, si se elige, ya matriculado en su grupo.
-- 3. Un único RPC para cambiar cualquier rol (también a administrador), con registro de auditoría.

-- 1. Matrícula en un grupo
create or replace function private.enroll_student_in_group(p_student_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare g record;
begin
  select cg.id, cg.academic_year_id, cg.degree_id, cg.level into g
  from public.class_groups cg where cg.id = p_group_id;
  if g.id is null then
    raise exception using errcode = '23503', message = 'Grupo no encontrado.';
  end if;

  insert into public.enrollments (student_id, academic_year_id, group_id, level)
  values (p_student_id, g.academic_year_id, g.id, g.level)
  on conflict (student_id, academic_year_id) do nothing;

  insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
  select p_student_id, x.degree_module_id, g.academic_year_id, g.id
  from (
    select distinct degree_module_id from public.module_enrollments where group_id = g.id
    union
    -- Grupo aún vacío: los módulos de su grado y curso
    select dm.id from public.degree_modules dm
    where dm.degree_id = g.degree_id and dm.level = g.level
      and not exists (select 1 from public.module_enrollments where group_id = g.id)
  ) x
  on conflict (student_id, degree_module_id, academic_year_id) do nothing;
end;
$$;
revoke all on function private.enroll_student_in_group(uuid, uuid) from public, anon, authenticated;

-- approve_profile: misma lógica, ahora con la función común
create or replace function public.approve_profile(p_profile_id uuid, p_group_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_profile record;
  v_school uuid;
  v_student uuid;
  v_group_school uuid;
begin
  select p.id, p.role, p.status, sp.school_id into v_profile
  from public.profiles p left join public.school_profiles sp on sp.profile_id = p.id
  where p.id = p_profile_id;
  if v_profile.id is null then
    raise exception using errcode = 'P0002', message = 'Solicitud no encontrada.';
  end if;
  if v_profile.status <> 'pendiente' then
    raise exception using errcode = '22023', message = 'Esta solicitud ya se revisó.';
  end if;
  if not private.can_review_profile(p_profile_id) then
    raise exception using errcode = '42501', message = case when v_profile.role = 'profesor'
      then 'Solo la supervisión de la escuela puede aprobar profesores.'
      else 'No puedes aprobar esta solicitud.' end;
  end if;
  v_school := v_profile.school_id;

  if p_group_id is not null then
    if v_profile.role <> 'alumno' then
      raise exception using errcode = '22023', message = 'Solo se matricula en un grupo a los alumnos.';
    end if;
    select y.school_id into v_group_school
    from public.class_groups cg join public.academic_years y on y.id = cg.academic_year_id
    where cg.id = p_group_id;
    if v_group_school is null or v_group_school <> v_school then
      raise exception using errcode = '23503', message = 'El grupo no es de la escuela del alumno.';
    end if;
    if not private.can_manage_school(v_school) and not private.teaches_group(p_group_id) then
      raise exception using errcode = '42501', message = 'Solo puedes matricular en grupos donde das clase.';
    end if;
  end if;

  update public.profiles set status = 'activo' where id = p_profile_id;

  if v_profile.role = 'alumno' then
    v_student := private.create_student_for_profile(p_profile_id);
    if p_group_id is not null then
      perform private.enroll_student_in_group(v_student, p_group_id);
    end if;
  end if;

  perform private.log_admin_action('approve_profile', 'profile', p_profile_id,
    jsonb_build_object('role', v_profile.role, 'group_id', p_group_id));
  return jsonb_build_object('profile_id', p_profile_id, 'student_id', v_student);
end;
$$;

-- 2. Ficha (y grupo opcional) de un alumno creado por la función de servidor admin-create-user.
-- Solo la llama el servidor (service_role), que ya comprobó quién crea y en qué escuela.
create or replace function public.service_setup_student(p_profile_id uuid, p_group_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_student uuid;
  v_school uuid;
  v_group_school uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Solo el servidor puede usar esta función.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and role = 'alumno') then
    raise exception using errcode = '23503', message = 'Perfil de alumno no encontrado.';
  end if;
  select school_id into v_school from public.school_profiles where profile_id = p_profile_id;
  if p_group_id is not null then
    select y.school_id into v_group_school
    from public.class_groups cg join public.academic_years y on y.id = cg.academic_year_id
    where cg.id = p_group_id;
    if v_group_school is null or v_group_school is distinct from v_school then
      raise exception using errcode = '23503', message = 'El grupo no es de la escuela del alumno.';
    end if;
  end if;

  v_student := private.create_student_for_profile(p_profile_id);
  if p_group_id is not null then
    perform private.enroll_student_in_group(v_student, p_group_id);
  end if;
  return v_student;
end;
$$;
revoke all on function public.service_setup_student(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_setup_student(uuid, uuid) to service_role;

-- 3. Un único cambio de rol. Administrador y supervisor solo los da el admin.
create or replace function public.admin_set_profile_role(p_profile_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare v_current text;
begin
  if p_role not in ('alumno', 'profesor', 'supervisor', 'admin') then
    raise exception using errcode = '22023', message = 'Rol no válido.';
  end if;
  select role into v_current from public.profiles where id = p_profile_id;
  if v_current is null then
    raise exception using errcode = '23503', message = 'Perfil no encontrado.';
  end if;
  if p_profile_id = (select auth.uid()) then
    raise exception using errcode = '42501', message = 'No puedes cambiar tu propio rol.';
  end if;
  if not private.is_global_admin() then
    if not private.is_supervisor() or not private.profile_in_my_school(p_profile_id)
       or v_current not in ('alumno', 'profesor') or p_role not in ('alumno', 'profesor') then
      raise exception using errcode = '42501', message = 'Solo puedes cambiar el rol de alumnos y profesores de tu escuela.';
    end if;
  end if;
  if v_current = p_role then return; end if;

  update public.profiles set role = p_role where id = p_profile_id;
  -- Quien deja de dar clase pierde sus asignaciones; quien deja de ser alumno, su vínculo con la ficha
  if p_role not in ('profesor', 'supervisor') then
    delete from public.teacher_modules where profile_id = p_profile_id;
    delete from public.teaching_assignments where profile_id = p_profile_id;
  end if;
  if p_role <> 'alumno' then
    delete from public.student_profiles where profile_id = p_profile_id;
  end if;

  perform private.log_admin_action('SET_ROLE', 'profile', p_profile_id,
    jsonb_build_object('from', v_current, 'to', p_role));
end;
$$;
