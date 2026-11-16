-- El profesor (y el supervisor, que también da clase) puede crear grupos del curso actual
-- de su escuela. Al crearlo elige los módulos que imparte en él y queda como su profesor,
-- así el grupo le aparece en «Mis grupos». La dirección sigue creándolos en Escuela → Grupos.
create or replace function public.teacher_create_group(p_degree_id uuid, p_level integer, p_name text, p_degree_module_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_school uuid := private.current_school_id();
  v_year uuid;
  v_group uuid;
  v_name text := upper(trim(coalesce(p_name, '')));
begin
  if not private.is_teaching_role() or v_school is null then
    raise exception using errcode = '42501', message = 'Solo el profesorado de la escuela puede crear grupos.';
  end if;
  if not exists (select 1 from public.degrees where id = p_degree_id and school_id = v_school) then
    raise exception using errcode = '42501', message = 'Ese grado no es de tu escuela.';
  end if;
  select id into v_year from public.academic_years where school_id = v_school and is_current;
  if v_year is null then
    raise exception using errcode = '22023', message = 'La escuela no tiene curso escolar actual.';
  end if;
  if p_level is null or p_level < 1 or p_level > 9 then
    raise exception using errcode = '22023', message = 'El curso debe estar entre 1 y 9.';
  end if;
  if length(v_name) < 1 or length(v_name) > 20 then
    raise exception using errcode = '22023', message = 'El nombre del grupo debe tener entre 1 y 20 caracteres.';
  end if;
  if coalesce(array_length(p_degree_module_ids, 1), 0) = 0 then
    raise exception using errcode = '22023', message = 'Elige al menos un módulo que impartes en el grupo.';
  end if;
  if exists (select 1 from unnest(p_degree_module_ids) m
             where not exists (select 1 from public.degree_modules dm where dm.id = m and dm.degree_id = p_degree_id)) then
    raise exception using errcode = '22023', message = 'Algún módulo no es de ese grado.';
  end if;
  if exists (select 1 from public.class_groups where academic_year_id = v_year and degree_id = p_degree_id and level = p_level and upper(name) = v_name) then
    raise exception using errcode = '23505', message = 'Ese grupo ya existe. Pide a coordinación que te asigne sus módulos.';
  end if;

  insert into public.class_groups (academic_year_id, degree_id, level, name)
  values (v_year, p_degree_id, p_level, v_name)
  returning id into v_group;

  insert into public.teaching_assignments (profile_id, degree_module_id, group_id)
  select (select auth.uid()), m, v_group from unnest(p_degree_module_ids) m
  on conflict do nothing;

  return v_group;
end;
$$;

revoke execute on function public.teacher_create_group(uuid, integer, text, uuid[]) from public, anon;
grant execute on function public.teacher_create_group(uuid, integer, text, uuid[]) to authenticated;
