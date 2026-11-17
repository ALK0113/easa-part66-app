-- El rol «supervisor» se muestra como «Coordinador» (el valor interno no cambia).
-- El admin puede nombrar coordinador desde Perfiles, pero solo a quien ya tiene escuela.

create or replace function public.admin_set_profile_role(p_profile_id uuid, p_role text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
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

  if p_role = 'supervisor' and not exists (select 1 from public.school_profiles where profile_id = p_profile_id) then
    raise exception using errcode = '22023', message = 'Un coordinador necesita una escuela. Asígnale una antes de cambiar el rol.';
  end if;

  update public.profiles set role = p_role where id = p_profile_id;
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
$function$;

create or replace function public.admin_make_supervisor(p_profile_id uuid, p_school_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
    raise exception using errcode = '22023', message = 'Solo un profesor puede ser coordinador.';
  end if;

  update public.profiles set role = 'supervisor' where id = p_profile_id and role <> 'supervisor';
  insert into public.school_profiles (profile_id, school_id) values (p_profile_id, p_school_id)
  on conflict (profile_id) do update set school_id = excluded.school_id;

  perform private.log_admin_action('ASSIGN_SUPERVISOR', 'school', p_school_id, jsonb_build_object('profile_id', p_profile_id));
end;
$function$;
