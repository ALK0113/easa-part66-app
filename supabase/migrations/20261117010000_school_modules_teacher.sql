-- Módulos propios de cada escuela y autonomía del profesor. 2026-11-17
-- · modules.school_id: null = catálogo EASA común (lo edita el admin);
--   con valor = módulo propio de esa escuela (lo crea su supervisor y lo ve solo ella).
-- · El profesor edita el contenido de los módulos de escuela que imparte.
-- · El profesor cambia día, hora y aula de sus propias clases semanales.
-- · El profesor añade alumnos de su escuela a sus grupos y los matricula en sus módulos.

-- ---------------------------------------------------------------------------
-- 1. Módulos de escuela
-- ---------------------------------------------------------------------------
alter table public.modules
  add column if not exists school_id uuid references public.schools(id) on delete cascade;
create index if not exists modules_school_id_idx on public.modules (school_id);

drop policy if exists modules_authenticated_read on public.modules;
create policy modules_read on public.modules for select to authenticated
  using (school_id is null or private.is_school_member(school_id));

-- El admin lo gestiona todo (modules_staff_write); el supervisor, los de su escuela
create policy modules_school_write on public.modules for all to authenticated
  using (school_id is not null and private.can_manage_school(school_id))
  with check (school_id is not null and private.can_manage_school(school_id));

-- Un grado solo puede usar módulos del catálogo o de su propia escuela
create or replace function private.check_degree_module_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.modules m
    where m.id = new.module_id and m.school_id is not null
      and m.school_id is distinct from private.degree_school(new.degree_id)
  ) then
    raise exception using errcode = '42501', message = 'Ese módulo pertenece a otra escuela.';
  end if;
  return new;
end;
$$;
drop trigger if exists degree_modules_scope on public.degree_modules;
create trigger degree_modules_scope before insert or update of module_id, degree_id on public.degree_modules
  for each row execute function private.check_degree_module_scope();

-- Contenido de un módulo de escuela: su supervisor o un profesor que lo imparte
create or replace function public.update_module_content(p_module_id text, p_name text, p_description text, p_color integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid;
begin
  select school_id into v_school from public.modules where id = p_module_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Módulo no encontrado.';
  end if;
  if v_school is null then
    if not private.is_global_admin() then
      raise exception using errcode = '42501', message = 'Los módulos del catálogo EASA solo los edita administración.';
    end if;
  elsif not (private.can_manage_school(v_school)
             or (private.is_teaching_role() and private.has_teacher_module(p_module_id) and private.is_school_member(v_school))) then
    raise exception using errcode = '42501', message = 'Solo puedes editar los módulos que impartes.';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'El nombre es obligatorio.';
  end if;
  update public.modules
  set name = trim(p_name),
      description = coalesce(trim(p_description), ''),
      color = least(greatest(coalesce(p_color, 1), 1), 18)
  where id = p_module_id;
end;
$$;
revoke all on function public.update_module_content(text, text, text, integer) from public, anon;
grant execute on function public.update_module_content(text, text, text, integer) to authenticated;

create or replace function public.admin_delete_module(p_module_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_school uuid;
begin
  select school_id into v_school from public.modules where id = p_module_id;
  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'Módulo no encontrado.');
  end if;
  if not (private.is_global_admin() or (v_school is not null and private.can_manage_school(v_school))) then
    raise exception using errcode = '42501', message = 'No autorizado';
  end if;

  if exists (select 1 from public.practices where module_id = p_module_id)
     or exists (select 1 from public.tlbs where module_id = p_module_id)
     or exists (select 1 from public.videos where module_id = p_module_id) then
    return jsonb_build_object('deleted', false,
      'reason', 'No se puede eliminar: hay prácticas, TLB o vídeos asociados a este módulo.');
  end if;

  delete from public.student_modules where module_id = p_module_id;
  delete from public.teacher_modules where module_id = p_module_id;
  delete from public.modules where id = p_module_id;
  return jsonb_build_object('deleted', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Horario semanal: el profesor gestiona las franjas de sus clases
-- ---------------------------------------------------------------------------
drop policy if exists schedule_slots_insert on public.schedule_slots;
drop policy if exists schedule_slots_update on public.schedule_slots;
drop policy if exists schedule_slots_delete on public.schedule_slots;
create policy schedule_slots_insert on public.schedule_slots for insert to authenticated
  with check (private.can_manage_school(private.assignment_school(teaching_assignment_id))
              or private.is_assignment_teacher(teaching_assignment_id));
create policy schedule_slots_update on public.schedule_slots for update to authenticated
  using (private.can_manage_school(private.assignment_school(teaching_assignment_id))
         or private.is_assignment_teacher(teaching_assignment_id))
  with check (private.can_manage_school(private.assignment_school(teaching_assignment_id))
              or private.is_assignment_teacher(teaching_assignment_id));
create policy schedule_slots_delete on public.schedule_slots for delete to authenticated
  using (private.can_manage_school(private.assignment_school(teaching_assignment_id))
         or private.is_assignment_teacher(teaching_assignment_id));

-- ---------------------------------------------------------------------------
-- 3. Matrícula por el profesor (solo en sus grupos y sus módulos)
-- ---------------------------------------------------------------------------
-- Módulos (degree_modules) que el usuario actual imparte en un grupo
create or replace function private.my_group_modules(p_group_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select ta.degree_module_id from public.teaching_assignments ta
  where ta.group_id = p_group_id and ta.profile_id = (select auth.uid()) and private.is_active();
$$;
revoke all on function private.my_group_modules(uuid) from public, anon;

-- Alumnos de un grupo donde imparto, con los módulos míos que cursan
create or replace function public.teacher_group_roster(p_group_id uuid)
returns table (student_id uuid, name text, student_number integer, my_modules uuid[], other_modules integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.teaches_group(p_group_id) then
    raise exception using errcode = '42501', message = 'No das clase en este grupo.';
  end if;
  return query
  select s.id, s.name, s.student_number,
    coalesce(array_agg(me.degree_module_id) filter (where me.degree_module_id in (select private.my_group_modules(p_group_id))), '{}'),
    (count(me.id) filter (where me.degree_module_id not in (select private.my_group_modules(p_group_id))))::integer
  from public.enrollments e
  join public.students s on s.id = e.student_id
  left join public.module_enrollments me on me.student_id = e.student_id and me.group_id = e.group_id
  where e.group_id = p_group_id
  group by s.id, s.name, s.student_number
  order by s.name;
end;
$$;
revoke all on function public.teacher_group_roster(uuid) from public, anon;
grant execute on function public.teacher_group_roster(uuid) to authenticated;

-- Alumnos activos de mi escuela que aún no tienen grupo este curso
create or replace function public.teacher_list_enrollable_students()
returns table (student_id uuid, name text, student_number integer)
language sql stable security definer set search_path = '' as $$
  select s.id, s.name, s.student_number
  from public.students s
  where private.is_teaching_role()
    and s.school_id = private.current_school_id()
    and not exists (
      select 1 from public.enrollments e
      join public.academic_years y on y.id = e.academic_year_id and y.is_current
      where e.student_id = s.id)
  order by s.name;
$$;
revoke all on function public.teacher_list_enrollable_students() from public, anon;
grant execute on function public.teacher_list_enrollable_students() to authenticated;

-- Añade un alumno sin grupo a uno de mis grupos y lo matricula en mis módulos de ese grupo
create or replace function public.teacher_add_student_to_group(p_student_id uuid, p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g record;
begin
  if not private.teaches_group(p_group_id) then
    raise exception using errcode = '42501', message = 'Solo puedes añadir alumnos a grupos donde das clase.';
  end if;
  select cg.id, cg.academic_year_id, cg.level, y.school_id into g
  from public.class_groups cg join public.academic_years y on y.id = cg.academic_year_id where cg.id = p_group_id;
  if not exists (select 1 from public.students where id = p_student_id and school_id = g.school_id) then
    raise exception using errcode = '42501', message = 'El alumno no es de tu escuela.';
  end if;
  if exists (select 1 from public.enrollments where student_id = p_student_id and academic_year_id = g.academic_year_id) then
    raise exception using errcode = '22023', message = 'Este alumno ya tiene grupo este curso. Para cambiarlo, habla con la supervisión.';
  end if;

  insert into public.enrollments (student_id, academic_year_id, group_id, level)
  values (p_student_id, g.academic_year_id, g.id, g.level);
  insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
  select p_student_id, m, g.academic_year_id, g.id from private.my_group_modules(p_group_id) m
  on conflict (student_id, degree_module_id, academic_year_id) do nothing;
end;
$$;
revoke all on function public.teacher_add_student_to_group(uuid, uuid) from public, anon;
grant execute on function public.teacher_add_student_to_group(uuid, uuid) to authenticated;

-- Matricula o desmatricula a un alumno del grupo en uno de mis módulos
create or replace function public.teacher_set_module_enrollment(p_student_id uuid, p_group_id uuid, p_degree_module_id uuid, p_enrolled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_year uuid;
begin
  if p_degree_module_id not in (select private.my_group_modules(p_group_id)) then
    raise exception using errcode = '42501', message = 'No impartes ese módulo en este grupo.';
  end if;
  select academic_year_id into v_year from public.enrollments where student_id = p_student_id and group_id = p_group_id;
  if v_year is null then
    raise exception using errcode = '22023', message = 'El alumno no está en este grupo.';
  end if;

  if p_enrolled then
    insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
    values (p_student_id, p_degree_module_id, v_year, p_group_id)
    on conflict (student_id, degree_module_id, academic_year_id) do nothing;
  else
    if exists (select 1 from public.module_enrollments
               where student_id = p_student_id and degree_module_id = p_degree_module_id and academic_year_id = v_year
                 and (theory_grade is not null or practical_result is not null)) then
      raise exception using errcode = '22023', message = 'Tiene nota en este módulo: no se puede quitar.';
    end if;
    delete from public.module_enrollments
    where student_id = p_student_id and degree_module_id = p_degree_module_id and academic_year_id = v_year and group_id = p_group_id;
  end if;
end;
$$;
revoke all on function public.teacher_set_module_enrollment(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.teacher_set_module_enrollment(uuid, uuid, uuid, boolean) to authenticated;

-- Saca a un alumno del grupo, solo si únicamente cursaba ahí mis módulos y sin notas
create or replace function public.teacher_remove_student_from_group(p_student_id uuid, p_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.teaches_group(p_group_id) then
    raise exception using errcode = '42501', message = 'No das clase en este grupo.';
  end if;
  if exists (select 1 from public.module_enrollments
             where student_id = p_student_id and group_id = p_group_id
               and (degree_module_id not in (select private.my_group_modules(p_group_id))
                    or theory_grade is not null or practical_result is not null)) then
    raise exception using errcode = '22023', message = 'Cursa otros módulos o ya tiene notas en este grupo. Para sacarlo, habla con la supervisión.';
  end if;
  delete from public.module_enrollments where student_id = p_student_id and group_id = p_group_id;
  delete from public.enrollments where student_id = p_student_id and group_id = p_group_id;
end;
$$;
revoke all on function public.teacher_remove_student_from_group(uuid, uuid) from public, anon;
grant execute on function public.teacher_remove_student_from_group(uuid, uuid) to authenticated;
