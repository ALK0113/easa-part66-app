-- Sesiones de recuperación de prácticas.
-- · Un alumno que falta a una sesión no puede tener Apto/No apto en ella: la recupera en una sesión extra.
-- · La sesión de recuperación solo lleva en la lista a los alumnos elegidos y no suma horas a la práctica.
-- · La nota general se habilita cuando todas las sesiones están evaluadas y cada falta está recuperada
--   (una sesión de recuperación evaluada por cada falta).

alter table public.class_sessions add column if not exists recovery boolean not null default false;

create table if not exists public.session_recovery_students (
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  primary key (session_id, student_id)
);
create index if not exists session_recovery_students_student_idx on public.session_recovery_students (student_id);
alter table public.session_recovery_students enable row level security;
grant select on public.session_recovery_students to authenticated;
create policy session_recovery_students_read on public.session_recovery_students for select to authenticated
  using (private.is_student_profile(student_id::text)
    or private.is_assignment_teacher(private.session_assignment(session_id))
    or private.can_manage_school(private.assignment_school(private.session_assignment(session_id))));

-- Lista de una sesión: el grupo del módulo; en una recuperación, solo los alumnos elegidos
create or replace function private.session_students(p_session_id uuid)
returns table(student_id uuid)
language sql
stable
security definer
set search_path to ''
as $$
  select me.student_id
  from public.class_sessions cs
  join public.teaching_assignments ta on ta.id = cs.teaching_assignment_id
  join public.degree_modules dta on dta.id = ta.degree_module_id
  join public.class_groups g on g.id = ta.group_id
  join public.module_enrollments me on me.group_id = ta.group_id and me.academic_year_id = g.academic_year_id
  join public.degree_modules dme on dme.id = me.degree_module_id and dme.module_id = dta.module_id
  where cs.id = p_session_id and not cs.recovery
  union
  select rs.student_id
  from public.class_sessions cs
  join public.session_recovery_students rs on rs.session_id = cs.id
  where cs.id = p_session_id and cs.recovery;
$$;

-- Crear una sesión de recuperación de una práctica para unos alumnos del grupo
create or replace function public.add_recovery_session(
  p_practice_id text, p_assignment_id uuid, p_date date, p_start time, p_end time, p_student_ids uuid[], p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_session uuid;
  v_module text;
  v_school uuid;
begin
  if not (private.is_assignment_teacher(p_assignment_id) or private.can_manage_school(private.assignment_school(p_assignment_id))) then
    raise exception using errcode = '42501', message = 'Solo el profesor de la clase puede programar recuperaciones.';
  end if;
  select module_id, school_id into v_module, v_school from public.practices where id = p_practice_id;
  if v_module is null then raise exception using errcode = 'P0002', message = 'Práctica no encontrada.'; end if;
  if not exists (
    select 1 from public.teaching_assignments ta join public.degree_modules dm on dm.id = ta.degree_module_id
    where ta.id = p_assignment_id and dm.module_id = v_module and private.assignment_school(ta.id) = v_school
  ) then
    raise exception using errcode = '22023', message = 'La clase no corresponde al módulo de la práctica.';
  end if;
  if p_date is null or p_start is null or p_end is null or p_end <= p_start then
    raise exception using errcode = '22023', message = 'Indica día y una hora de final posterior a la de inicio.';
  end if;
  if coalesce(cardinality(p_student_ids), 0) = 0 or cardinality(p_student_ids) > 200 then
    raise exception using errcode = '22023', message = 'Elige al menos un alumno para la recuperación.';
  end if;
  if exists (
    select 1 from unnest(p_student_ids) x(id)
    where not exists (
      select 1 from public.teaching_assignments ta
      join public.degree_modules dta on dta.id = ta.degree_module_id
      join public.class_groups g on g.id = ta.group_id
      join public.module_enrollments me on me.group_id = ta.group_id and me.academic_year_id = g.academic_year_id
      join public.degree_modules dme on dme.id = me.degree_module_id and dme.module_id = dta.module_id
      where ta.id = p_assignment_id and me.student_id = x.id)
  ) then
    raise exception using errcode = '23503', message = 'Algún alumno no pertenece a esta clase.';
  end if;

  insert into public.class_sessions (teaching_assignment_id, date, start_time, end_time, practice_id, recovery, note)
  values (p_assignment_id, p_date, p_start, p_end, p_practice_id, true, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_session;
  insert into public.session_recovery_students (session_id, student_id)
  select v_session, x.id from unnest(p_student_ids) x(id) on conflict do nothing;
  return v_session;
end;
$$;
revoke all on function public.add_recovery_session(text, uuid, date, time, time, uuid[], text) from public, anon;
grant execute on function public.add_recovery_session(text, uuid, date, time, time, uuid[], text) to authenticated;

-- Marcar falta quita el Apto/No apto de esa sesión
create or replace function public.set_session_attendance(p_session_id uuid, p_student_ids uuid[], p_status text)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_assignment uuid := private.session_assignment(p_session_id);
  v_count integer;
begin
  if v_assignment is null then raise exception using errcode = 'P0002', message = 'Clase no encontrada.'; end if;
  if not (private.is_assignment_teacher(v_assignment) or private.can_manage_school(private.assignment_school(v_assignment))) then
    raise exception using errcode = '42501', message = 'Solo el profesor de la clase puede pasar lista.';
  end if;
  if p_status is not null and p_status not in ('P', 'L', 'A') then
    raise exception using errcode = '22023', message = 'Estado de asistencia no válido.';
  end if;
  if coalesce(cardinality(p_student_ids), 0) > 500 then
    raise exception using errcode = '22023', message = 'Máximo 500 alumnos.';
  end if;
  if exists (select 1 from unnest(p_student_ids) x(id) where not exists (select 1 from private.session_students(p_session_id) r where r.student_id = x.id)) then
    raise exception using errcode = '23503', message = 'Algún alumno no pertenece a esta clase.';
  end if;

  insert into public.session_attendance (session_id, student_id, status, updated_by, updated_at)
  select p_session_id, x.id, p_status, auth.uid(), now() from unnest(p_student_ids) x(id)
  on conflict (session_id, student_id) do update
    set status = excluded.status,
        evaluation = case when excluded.status = 'A' then null else public.session_attendance.evaluation end,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  get diagnostics v_count = row_count;
  delete from public.session_attendance
  where session_id = p_session_id and student_id = any(p_student_ids) and status is null and evaluation is null and comment is null;
  return v_count;
end;
$$;

-- No se evalúa a quien faltó
create or replace function public.set_session_record(p_session_id uuid, p_student_id uuid, p_evaluation text, p_comment text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_assignment uuid := private.session_assignment(p_session_id);
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_assignment is null then raise exception using errcode = 'P0002', message = 'Clase no encontrada.'; end if;
  if not (private.is_assignment_teacher(v_assignment) or private.can_manage_school(private.assignment_school(v_assignment))) then
    raise exception using errcode = '42501', message = 'Solo el profesor de la clase puede evaluar la sesión.';
  end if;
  if p_evaluation is not null and p_evaluation not in ('Apto', 'No Apto') then
    raise exception using errcode = '22023', message = 'Evaluación no válida.';
  end if;
  if p_evaluation is not null and not exists (select 1 from public.class_sessions where id = p_session_id and practice_id is not null) then
    raise exception using errcode = '22023', message = 'Solo las sesiones de práctica llevan Apto / No apto.';
  end if;
  if p_student_id is null or not exists (select 1 from private.session_students(p_session_id) r where r.student_id = p_student_id) then
    raise exception using errcode = '23503', message = 'El alumno no pertenece a esta clase.';
  end if;
  if p_evaluation is not null and exists (select 1 from public.session_attendance where session_id = p_session_id and student_id = p_student_id and status = 'A') then
    raise exception using errcode = '22023', message = 'El alumno faltó a esta sesión: no se puede evaluar. Se recupera en una sesión extra.';
  end if;
  insert into public.session_attendance (session_id, student_id, status, evaluation, comment, updated_by, updated_at)
  values (p_session_id, p_student_id, null, p_evaluation, v_comment, auth.uid(), now())
  on conflict (session_id, student_id) do update
    set evaluation = excluded.evaluation, comment = excluded.comment, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  delete from public.session_attendance
  where session_id = p_session_id and student_id = p_student_id and status is null and evaluation is null and comment is null;
end;
$$;

-- Sesiones que le faltan a un alumno para cerrar la práctica:
-- sesiones normales sin evaluar (sin contar faltas) + faltas aún no recuperadas
create or replace function private.practice_missing_sessions(p_student_id uuid, p_practice_id text)
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  with own as (
    select cs.recovery, sa.status, sa.evaluation
    from public.class_sessions cs
    left join public.session_attendance sa on sa.session_id = cs.id and sa.student_id = p_student_id
    where cs.practice_id = p_practice_id and cs.status = 'programada'
      and exists (select 1 from private.session_students(cs.id) r where r.student_id = p_student_id)
  )
  select (count(*) filter (where not recovery and evaluation is null and status is distinct from 'A'))::integer
       + greatest(0, count(*) filter (where not recovery and status = 'A') - count(*) filter (where recovery and evaluation is not null))::integer
  from own;
$$;

create or replace function public.set_practice_result(p_student_id uuid, p_practice_id text, p_evaluation text, p_comment text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_evaluation is not null and private.practice_missing_sessions(p_student_id, p_practice_id) > 0 then
    raise exception using errcode = '22023', message = 'Faltan sesiones por evaluar o recuperar: la nota general se pone al completarlas.';
  end if;
  perform public.set_evaluation(p_student_id, p_practice_id, p_evaluation);
  update public.practice_records set comment = nullif(btrim(coalesce(p_comment, '')), ''), updated_by = auth.uid(), updated_at = now()
  where student_id = p_student_id::text and practice_id = p_practice_id;
end;
$$;

-- Asistencia resumida de la práctica: una falta recuperada (asistió a una recuperación) ya no cuenta como falta
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
  v_absent integer;
  v_recovered integer;
  v_late boolean;
  v_marked integer;
  v_status text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  select cs.practice_id, p.module_id into v_practice, v_module
  from public.class_sessions cs join public.practices p on p.id = cs.practice_id
  where cs.id = v_row.session_id;
  if v_practice is null then return null; end if;
  if not exists (select 1 from public.student_modules where student_id = v_row.student_id and module_id = v_module) then
    return null;
  end if;
  select count(*) filter (where not cs.recovery and sa.status = 'A'),
         count(*) filter (where cs.recovery and sa.status in ('P', 'L')),
         coalesce(bool_or(sa.status = 'L'), false),
         count(sa.status)
  into v_absent, v_recovered, v_late, v_marked
  from public.session_attendance sa
  join public.class_sessions cs on cs.id = sa.session_id
  where cs.practice_id = v_practice and cs.status = 'programada' and sa.student_id = v_row.student_id;
  v_status := case when v_absent > v_recovered then 'A' when v_late then 'L' when v_marked > 0 then 'P' end;
  insert into public.practice_records (student_id, practice_id, attendance, updated_by, updated_at)
  values (v_row.student_id::text, v_practice, v_status, auth.uid(), now())
  on conflict (student_id, practice_id) do update
    set attendance = excluded.attendance, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return null;
end;
$$;
