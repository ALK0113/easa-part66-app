-- Rol supervisor: gestiona una sola escuela. 2026-11-16
-- Solo un admin puede nombrarlo o quitarlo. Un supervisor gestiona usuarios
-- (alumno/profesor), estructura, asignaciones, notas y prácticas de su escuela.

-- ---------------------------------------------------------------------------
-- 1. Nombrar y quitar supervisores (solo admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_make_supervisor(p_profile_id uuid, p_school_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text;
begin
  perform private.assert_admin();
  if not exists (select 1 from public.schools where id = p_school_id) then
    raise exception using errcode = 'P0002', message = 'Escuela no encontrada.';
  end if;
  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception using errcode = 'P0002', message = 'Perfil no encontrado.';
  end if;
  if v_role not in ('profesor', 'supervisor') then
    raise exception using errcode = '22023', message = 'Solo un profesor puede ser supervisor.';
  end if;

  update public.profiles set role = 'supervisor' where id = p_profile_id and role <> 'supervisor';
  insert into public.school_profiles (profile_id, school_id) values (p_profile_id, p_school_id)
  on conflict (profile_id) do update set school_id = excluded.school_id;

  perform private.log_admin_action('ASSIGN_SUPERVISOR', 'school', p_school_id, jsonb_build_object('profile_id', p_profile_id));
end;
$$;
revoke all on function public.admin_make_supervisor(uuid, uuid) from public, anon;
grant execute on function public.admin_make_supervisor(uuid, uuid) to authenticated;

-- Quitar: vuelve a profesor y sigue perteneciendo a la escuela.
create or replace function public.admin_remove_supervisor(p_school_id uuid, p_profile_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  update public.profiles set role = 'profesor'
  where id = p_profile_id and role = 'supervisor'
    and exists (select 1 from public.school_profiles sp where sp.profile_id = p_profile_id and sp.school_id = p_school_id);
  if found then
    perform private.log_admin_action('REMOVE_SUPERVISOR', 'school', p_school_id, jsonb_build_object('profile_id', p_profile_id));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Cambiar roles: el supervisor solo alumno <-> profesor dentro de su escuela
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_profile_role(p_profile_id uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_current text;
begin
  if p_role not in ('alumno', 'profesor') then
    raise exception using errcode = '22023', message = 'Rol no válido.';
  end if;
  select role into v_current from public.profiles where id = p_profile_id;
  if v_current is null then
    raise exception using errcode = '23503', message = 'Perfil no encontrado.';
  end if;
  if not private.is_global_admin() then
    if not private.is_supervisor() or not private.profile_in_my_school(p_profile_id) or v_current not in ('alumno', 'profesor') then
      raise exception using errcode = '42501', message = 'Solo puedes cambiar el rol de alumnos y profesores de tu escuela.';
    end if;
  end if;
  if p_profile_id = (select auth.uid()) then
    raise exception using errcode = '42501', message = 'No puedes cambiar tu propio rol.';
  end if;

  update public.profiles set role = p_role where id = p_profile_id;
  if p_role <> 'profesor' then
    delete from public.teacher_modules where profile_id = p_profile_id;
    delete from public.teaching_assignments where profile_id = p_profile_id;
  end if;
  if p_role <> 'alumno' then
    delete from public.student_profiles where profile_id = p_profile_id;
  end if;
end;
$$;

-- El trigger antiguo bloqueaba cualquier cambio de rol que no hiciera un admin.
-- Las reglas de rol ya las aplica protect_role_column; aquí solo queda el correo.
create or replace function public.protect_sensitive_columns()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if auth.uid() is not null and not coalesce(public.check_is_admin(), false) then
    if new.email is distinct from old.email then
      raise exception 'No tienes permiso para cambiar la dirección de correo.';
    end if;
  end if;
  return new;
end;
$$;

-- El supervisor edita los perfiles de alumnos y profesores de su escuela.
create policy profiles_supervisor_update on public.profiles for update to authenticated
  using (private.is_supervisor() and private.profile_in_my_school(id) and role in ('alumno', 'profesor'))
  with check (private.is_supervisor() and private.profile_in_my_school(id) and role in ('alumno', 'profesor'));

-- ---------------------------------------------------------------------------
-- 3. Funciones de gestión que la app usa: admin o supervisor de esa escuela
-- ---------------------------------------------------------------------------
create or replace function public.admin_link_student_profile(p_student_id text, p_profile_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_school uuid;
begin
  select school_id into v_school from public.students where id::text = p_student_id;
  if not found then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if not private.can_manage_school(v_school) then
    raise exception using errcode = '42501', message = 'Solo administración puede vincular cuentas.';
  end if;
  if p_profile_id is not null and not exists (
    select 1 from public.profiles where id = p_profile_id and role::text = 'alumno'
  ) then
    raise exception using errcode = '23503', message = 'La cuenta seleccionada no es un alumno válido.';
  end if;
  if p_profile_id is not null and not private.is_global_admin() and not private.profile_in_my_school(p_profile_id) then
    raise exception using errcode = '42501', message = 'Esa cuenta no es de tu escuela.';
  end if;

  delete from public.student_profiles where student_id = p_student_id;
  if p_profile_id is not null then
    insert into public.student_profiles (student_id, profile_id) values (p_student_id, p_profile_id);
  end if;
end;
$$;

create or replace function public.admin_delete_practice(p_practice_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_school uuid;
begin
  select school_id into v_school from public.practices where id::text = p_practice_id;
  if not found then
    raise exception using errcode = '23503', message = 'Práctica no encontrada.';
  end if;
  if not private.can_manage_school(v_school) then
    raise exception using errcode = '42501', message = 'Solo administración puede eliminar prácticas.';
  end if;
  if exists (select 1 from public.tlbs where practice_id::text = p_practice_id) then
    raise exception using errcode = '23503', message = 'No se puede eliminar una práctica con TLB asociados.';
  end if;
  delete from public.practice_records where practice_id = p_practice_id;
  delete from public.practices where id::text = p_practice_id;
end;
$$;

create or replace function public.set_attendance(p_student_id uuid, p_practice_id text, p_attendance text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text := private.current_profile_role(); v_module_id text;
begin
  if v_role is null or v_role not in ('admin', 'supervisor', 'profesor') then
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
  if v_role = 'supervisor' and not private.student_in_my_school(p_student_id) then
    raise exception using errcode = '42501', message = 'Este alumno no es de tu escuela.';
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
  if v_role is null or v_role not in ('admin', 'supervisor', 'profesor') then
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
  if v_role = 'supervisor' and not private.student_in_my_school(p_student_id) then
    raise exception using errcode = '42501', message = 'Este alumno no es de tu escuela.';
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

-- ---------------------------------------------------------------------------
-- 4. TLB: el supervisor actúa como profesor de los módulos que imparte
-- ---------------------------------------------------------------------------
create or replace function private.is_teaching_role()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_profile_role() in ('profesor', 'supervisor'), false);
$$;
revoke all on function private.is_teaching_role() from public, anon;
grant execute on function private.is_teaching_role() to authenticated;

create or replace function public.toggle_tlb_publish(p_tlb_id uuid, p_published boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_module_id text;
begin
  if not (private.is_global_admin() or private.is_teaching_role()) then
    raise exception using errcode = '42501', message = 'No autorizado para publicar TLB.';
  end if;
  select module_id into v_module_id from public.tlbs where id = p_tlb_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'TLB no encontrado.';
  end if;
  if not private.is_global_admin() and not private.has_teacher_module(v_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado el módulo de este TLB.';
  end if;
  update public.tlbs set published = p_published where id = p_tlb_id;
end;
$$;

create or replace function public.add_defect_to_tlb(p_tlb_id uuid, p_defect_number integer, p_ata text, p_pirep text, p_defect_description text, p_correct_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_module_id text;
  v_defect_id uuid;
  v_defect_number integer;
begin
  if not (private.is_global_admin() or private.is_teaching_role()) then
    raise exception using errcode = '42501', message = 'No autorizado para añadir defectos.';
  end if;
  if nullif(trim(p_ata), '') is null
    or nullif(trim(p_defect_description), '') is null
    or nullif(trim(p_correct_action), '') is null then
    raise exception using errcode = '22023', message = 'ATA, defecto y acción correctiva son obligatorios.';
  end if;

  select module_id into v_module_id from public.tlbs where id = p_tlb_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'TLB no encontrado.';
  end if;
  if not private.is_global_admin() and not private.has_teacher_module(v_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado el módulo de este TLB.';
  end if;

  select greatest(coalesce(p_defect_number, 1), coalesce(max(defect_number) + 1, 1))
  into v_defect_number from public.defects where tlb_id = p_tlb_id;

  insert into public.defects (tlb_id, defect_number, ata, pirep, defect_description)
  values (p_tlb_id, v_defect_number, trim(p_ata), nullif(trim(p_pirep), ''), trim(p_defect_description))
  returning id into v_defect_id;

  insert into public.defect_answers (defect_id, correct_action) values (v_defect_id, trim(p_correct_action));

  return v_defect_id;
end;
$$;

create or replace function public.admin_create_tlb_with_defect(p_module_id text, p_practice_id text, p_aircraft_id text, p_date date, p_teacher_name text, p_defect_description text, p_correct_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_practice record;
  v_aircraft record;
  v_tlb public.tlbs%rowtype;
  v_defect public.defects%rowtype;
begin
  if not (private.is_global_admin() or private.is_teaching_role()) then
    raise exception using errcode = '42501', message = 'No autorizado para crear un TLB.';
  end if;
  if not private.is_global_admin() and not private.has_teacher_module(p_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado este módulo.';
  end if;
  select id, ata into v_practice from public.practices where id::text = p_practice_id and module_id = p_module_id;
  if not found then
    raise exception using errcode = '23503', message = 'La práctica no pertenece al módulo seleccionado.';
  end if;
  select type, registration, msn into v_aircraft from public.aircraft where id::text = p_aircraft_id;
  if not found then
    raise exception using errcode = '23503', message = 'Aeronave no encontrada.';
  end if;
  if nullif(trim(p_defect_description), '') is null or nullif(trim(p_correct_action), '') is null then
    raise exception using errcode = '22023', message = 'El defecto y la acción correctiva son obligatorios.';
  end if;

  insert into public.tlbs (module_id, practice_id, aircraft, registration, msn, date, teacher_name, published, crs)
  values (
    p_module_id, p_practice_id, v_aircraft.type, v_aircraft.registration, v_aircraft.msn,
    p_date, p_teacher_name, false,
    'CERTIFICATE OF RELEASE TO SERVICE - CERTIFIES THAT THE WORK SPECIFIED WAS CARRIED OUT IN ACCORDANCE WITH PART-145'
  ) returning * into v_tlb;

  insert into public.defects (tlb_id, defect_number, ata, pirep, defect_description)
  values (v_tlb.id, 1, v_practice.ata, 'CPT', trim(p_defect_description))
  returning * into v_defect;

  insert into public.defect_answers (defect_id, correct_action) values (v_defect.id, trim(p_correct_action));

  return jsonb_build_object('tlb', to_jsonb(v_tlb), 'defect', to_jsonb(v_defect) || jsonb_build_object('correct_action', trim(p_correct_action)));
end;
$$;
