-- La asistencia se pasa una sola vez.
-- 1. Una clase del horario se une sola a la práctica de su módulo programada ese día (si no tenía una).
-- 2. Pasar lista en una clase con práctica deja también la asistencia de la práctica:
--    Prácticas, el detalle del módulo e Informes ven el mismo dato sin volver a apuntarlo.

-- Práctica del módulo de una asignación programada en una fecha (la primera del día)
create or replace function private.practice_for_assignment_on(p_assignment uuid, p_date date)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select p.id
  from public.teaching_assignments ta
  join public.degree_modules dm on dm.id = ta.degree_module_id
  join public.class_groups cg on cg.id = ta.group_id
  join public.academic_years y on y.id = cg.academic_year_id
  join public.practices p on p.module_id = dm.module_id and p.school_id = y.school_id and p.date = p_date
  where ta.id = p_assignment
  order by p.start_time nulls last, p.id
  limit 1;
$$;

-- 1. Unión automática clase ↔ práctica al crear o mover una clase
create or replace function private.link_session_practice()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.practice_id is null and (tg_op = 'INSERT' or new.date is distinct from old.date) then
    new.practice_id := private.practice_for_assignment_on(new.teaching_assignment_id, new.date);
  end if;
  return new;
end;
$$;

drop trigger if exists class_sessions_link_practice on public.class_sessions;
create trigger class_sessions_link_practice
  before insert or update of date on public.class_sessions
  for each row execute function private.link_session_practice();

-- Clases ya creadas sin práctica: se unen a la de ese día
update public.class_sessions cs
set practice_id = private.practice_for_assignment_on(cs.teaching_assignment_id, cs.date)
where cs.practice_id is null
  and private.practice_for_assignment_on(cs.teaching_assignment_id, cs.date) is not null;

-- 2. Lista de la clase → asistencia de la práctica unida
create or replace function private.sync_session_attendance_to_practice()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.session_attendance := coalesce(new, old);
  v_practice text;
  v_module text;
begin
  select cs.practice_id, p.module_id into v_practice, v_module
  from public.class_sessions cs join public.practices p on p.id = cs.practice_id
  where cs.id = v_row.session_id;
  if v_practice is null then return null; end if;
  -- Solo alumnos matriculados en el módulo de la práctica
  if not exists (select 1 from public.student_modules where student_id = v_row.student_id and module_id = v_module) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    update public.practice_records set attendance = null, updated_by = auth.uid(), updated_at = now()
    where student_id = v_row.student_id::text and practice_id = v_practice;
  else
    insert into public.practice_records (student_id, practice_id, attendance, updated_by, updated_at)
    values (new.student_id::text, v_practice, new.status, auth.uid(), now())
    on conflict (student_id, practice_id) do update
      set attendance = excluded.attendance, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  return null;
end;
$$;

drop trigger if exists session_attendance_to_practice on public.session_attendance;
create trigger session_attendance_to_practice
  after insert or update or delete on public.session_attendance
  for each row execute function private.sync_session_attendance_to_practice();
