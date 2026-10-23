create or replace function public.admin_assign_class_modules(
  p_group_name text,
  p_promo text,
  p_module_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_students integer;
  v_assignments integer;
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede asignar módulos a una clase.';
  end if;
  if nullif(trim(p_group_name), '') is null or nullif(trim(p_promo), '') is null then
    raise exception using errcode = '22023', message = 'Clase y promoción son obligatorias.';
  end if;
  if coalesce(cardinality(p_module_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'Selecciona al menos un módulo.';
  end if;
  if exists (
    select 1
    from unnest(p_module_ids) requested(module_id)
    where not exists (select 1 from public.modules m where m.id = requested.module_id)
  ) then
    raise exception using errcode = '23503', message = 'Uno o más módulos no existen.';
  end if;

  select count(*) into v_students
  from public.students
  where group_name = trim(p_group_name) and promo = trim(p_promo);
  if v_students = 0 then
    raise exception using errcode = 'P0002', message = 'No hay alumnos en esa clase y promoción.';
  end if;

  insert into public.student_modules (student_id, module_id)
  select students.id::text, requested.module_id
  from public.students
  cross join (select distinct unnest(p_module_ids) as module_id) requested
  where students.group_name = trim(p_group_name)
    and students.promo = trim(p_promo)
  on conflict (student_id, module_id) do nothing;
  get diagnostics v_assignments = row_count;

  return jsonb_build_object('students', v_students, 'assignments_added', v_assignments);
end;
$$;

revoke all on function public.admin_assign_class_modules(text, text, text[]) from public, anon;
grant execute on function public.admin_assign_class_modules(text, text, text[]) to authenticated;