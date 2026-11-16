-- Alumnos de una clase (grupo + módulo): se pueden añadir alumnos de cualquier curso
-- del centro, nunca de otro centro. La matrícula sigue siendo por módulo.

-- 1) Garantía en la base: la matrícula de módulo es siempre del centro del alumno
create or replace function private.trg_module_enrollments_same_school()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_student_school uuid;
  v_year_school uuid;
  v_group_year uuid;
begin
  select school_id into v_student_school from public.students where id = new.student_id;
  select school_id into v_year_school from public.academic_years where id = new.academic_year_id;
  select academic_year_id into v_group_year from public.class_groups where id = new.group_id;
  if v_student_school is distinct from v_year_school then
    raise exception using errcode = '42501', message = 'El alumno es de otro centro.';
  end if;
  if v_group_year is distinct from new.academic_year_id then
    raise exception using errcode = '22023', message = 'El grupo no es de ese curso académico.';
  end if;
  return new;
end;
$$;

drop trigger if exists module_enrollments_same_school on public.module_enrollments;
create trigger module_enrollments_same_school
  before insert or update of student_id, academic_year_id, group_id on public.module_enrollments
  for each row execute function private.trg_module_enrollments_same_school();

-- Una «clase» es un grupo + un módulo del grado (con o sin profesor asignado todavía).
-- Pueden tocar su lista la dirección del centro o el profesor que la imparte.
drop function if exists public.class_students(uuid);
drop function if exists public.class_candidates(uuid);
drop function if exists public.class_set_student(uuid, uuid, boolean);
drop function if exists private.assert_can_edit_class(uuid);

create or replace function private.assert_can_edit_class(p_group_id uuid, p_degree_module_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.class_groups g
    join public.degree_modules dm on dm.degree_id = g.degree_id
    where g.id = p_group_id and dm.id = p_degree_module_id
  ) then
    raise exception using errcode = 'P0002', message = 'Ese módulo no es del grado del grupo.';
  end if;
  if not (
    private.can_manage_school(private.group_school(p_group_id))
    or exists (select 1 from public.teaching_assignments ta
               where ta.group_id = p_group_id and ta.degree_module_id = p_degree_module_id and ta.profile_id = (select auth.uid()))
  ) then
    raise exception using errcode = '42501', message = 'Solo la dirección o el profesor de la clase pueden cambiar sus alumnos.';
  end if;
end;
$$;

-- Lista de la clase, con el curso de cada alumno (puede ser distinto al del grupo)
create or replace function public.class_students(p_group_id uuid, p_degree_module_id uuid)
returns table(student_id uuid, name text, student_number integer, home_group text, has_grade boolean)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  perform private.assert_can_edit_class(p_group_id, p_degree_module_id);
  return query
    select s.id, s.name, s.student_number,
      (select hg.level || 'º' || hg.name from public.enrollments e join public.class_groups hg on hg.id = e.group_id
        where e.student_id = s.id and e.academic_year_id = g.academic_year_id limit 1),
      (me.theory_grade is not null or me.practical_result is not null)
    from public.class_groups g
    join public.module_enrollments me on me.group_id = g.id and me.academic_year_id = g.academic_year_id and me.degree_module_id = p_degree_module_id
    join public.students s on s.id = me.student_id
    where g.id = p_group_id
    order by s.name;
end;
$$;

-- Alumnos del mismo centro que se pueden añadir (de cualquier curso)
create or replace function public.class_candidates(p_group_id uuid, p_degree_module_id uuid)
returns table(student_id uuid, name text, student_number integer, home_group text, other_class text)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  perform private.assert_can_edit_class(p_group_id, p_degree_module_id);
  return query
    with class as (
      select g.id as group_id, g.academic_year_id, y.school_id
      from public.class_groups g join public.academic_years y on y.id = g.academic_year_id
      where g.id = p_group_id
    )
    select s.id, s.name, s.student_number,
      (select hg.level || 'º' || hg.name from public.enrollments e join public.class_groups hg on hg.id = e.group_id
        where e.student_id = s.id and e.academic_year_id = c.academic_year_id limit 1),
      -- si ya cursa este módulo con otro grupo, al añadirlo se cambia a esta clase
      (select og.level || 'º' || og.name from public.module_enrollments me join public.class_groups og on og.id = me.group_id
        where me.student_id = s.id and me.degree_module_id = p_degree_module_id and me.academic_year_id = c.academic_year_id limit 1)
    from class c
    join public.students s on s.school_id = c.school_id
    where not exists (
      select 1 from public.module_enrollments me
      where me.student_id = s.id and me.degree_module_id = p_degree_module_id
        and me.academic_year_id = c.academic_year_id and me.group_id = c.group_id)
    order by s.name;
end;
$$;

-- Añadir (o cambiar a esta clase) o quitar a un alumno
create or replace function public.class_set_student(p_group_id uuid, p_degree_module_id uuid, p_student_id uuid, p_in boolean)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_year uuid;
  v_school uuid;
begin
  perform private.assert_can_edit_class(p_group_id, p_degree_module_id);
  select g.academic_year_id, y.school_id into v_year, v_school
  from public.class_groups g join public.academic_years y on y.id = g.academic_year_id
  where g.id = p_group_id;

  if not exists (select 1 from public.students where id = p_student_id and school_id = v_school) then
    raise exception using errcode = '42501', message = 'El alumno es de otro centro.';
  end if;

  if p_in then
    -- Si ya cursaba el módulo con otro grupo, pasa a esta clase (conserva sus notas)
    insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
    values (p_student_id, p_degree_module_id, v_year, p_group_id)
    on conflict (student_id, degree_module_id, academic_year_id) do update set group_id = excluded.group_id;
  else
    if exists (select 1 from public.module_enrollments
               where student_id = p_student_id and degree_module_id = p_degree_module_id
                 and academic_year_id = v_year and group_id = p_group_id
                 and (theory_grade is not null or practical_result is not null)) then
      raise exception using errcode = '22023', message = 'Tiene nota en este módulo: no se puede quitar.';
    end if;
    delete from public.module_enrollments
    where student_id = p_student_id and degree_module_id = p_degree_module_id
      and academic_year_id = v_year and group_id = p_group_id;
  end if;
end;
$$;

revoke execute on function public.class_students(uuid, uuid) from public, anon;
revoke execute on function public.class_candidates(uuid, uuid) from public, anon;
revoke execute on function public.class_set_student(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.class_students(uuid, uuid) to authenticated;
grant execute on function public.class_candidates(uuid, uuid) to authenticated;
grant execute on function public.class_set_student(uuid, uuid, uuid, boolean) to authenticated;
