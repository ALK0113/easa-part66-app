-- Cada sesión es una página: asistencia, Apto/No apto de la sesión (en prácticas) y comentario por alumno.
-- La nota general de la práctica (Apto/No apto + comentario general) solo se pone
-- cuando el alumno tiene evaluadas todas las sesiones de la práctica.

alter table public.session_attendance alter column status drop not null;
alter table public.session_attendance add column if not exists evaluation text check (evaluation in ('Apto', 'No Apto'));
alter table public.session_attendance add column if not exists comment text check (char_length(comment) <= 1000);
alter table public.practice_records add column if not exists comment text check (char_length(comment) <= 2000);

-- Sustituye a sessions_attendance (añade evaluación y comentario)
drop function if exists public.sessions_attendance(uuid[]);

create or replace function public.sessions_sheet(p_session_ids uuid[])
returns table(session_id uuid, student_id uuid, name text, status text, evaluation text, comment text)
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if coalesce(cardinality(p_session_ids), 0) > 500 then
    raise exception using errcode = '22023', message = 'Máximo 500 sesiones.';
  end if;
  return query
    select s.id, st.id, st.name, sa.status, sa.evaluation, sa.comment
    from unnest(p_session_ids) s(id)
    cross join lateral private.session_students(s.id) r
    join public.students st on st.id = r.student_id
    left join public.session_attendance sa on sa.session_id = s.id and sa.student_id = st.id
    where private.is_assignment_teacher(private.session_assignment(s.id))
       or private.can_manage_school(private.assignment_school(private.session_assignment(s.id)))
    order by st.name;
end;
$$;
revoke all on function public.sessions_sheet(uuid[]) from public, anon;
grant execute on function public.sessions_sheet(uuid[]) to authenticated;

-- Quitar la asistencia ya no borra la evaluación ni el comentario de la sesión
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
  if exists (select 1 from unnest(p_student_ids) x(id) where x.id not in (select student_id from private.session_students(p_session_id))) then
    raise exception using errcode = '23503', message = 'Algún alumno no pertenece a esta clase.';
  end if;

  insert into public.session_attendance (session_id, student_id, status, updated_by, updated_at)
  select p_session_id, x.id, p_status, auth.uid(), now() from unnest(p_student_ids) x(id)
  on conflict (session_id, student_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  get diagnostics v_count = row_count;
  delete from public.session_attendance
  where session_id = p_session_id and student_id = any(p_student_ids) and status is null and evaluation is null and comment is null;
  return v_count;
end;
$$;

-- Apto/No apto (solo sesiones de práctica) y comentario de un alumno en una sesión
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

  insert into public.session_attendance (session_id, student_id, status, evaluation, comment, updated_by, updated_at)
  values (p_session_id, p_student_id, null, p_evaluation, v_comment, auth.uid(), now())
  on conflict (session_id, student_id) do update
    set evaluation = excluded.evaluation, comment = excluded.comment, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  delete from public.session_attendance
  where session_id = p_session_id and student_id = p_student_id and status is null and evaluation is null and comment is null;
end;
$$;
revoke all on function public.set_session_record(uuid, uuid, text, text) from public, anon;
grant execute on function public.set_session_record(uuid, uuid, text, text) to authenticated;

-- Nota general de la práctica: cuando todas las sesiones del alumno están evaluadas
create or replace function public.set_practice_result(p_student_id uuid, p_practice_id text, p_evaluation text, p_comment text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_evaluation is not null and exists (
    select 1 from public.class_sessions cs
    where cs.practice_id = p_practice_id and cs.status = 'programada'
      and p_student_id in (select student_id from private.session_students(cs.id))
      and not exists (select 1 from public.session_attendance sa where sa.session_id = cs.id and sa.student_id = p_student_id and sa.evaluation is not null)
  ) then
    raise exception using errcode = '22023', message = 'Faltan sesiones por evaluar: la nota general se pone al completar todas las sesiones.';
  end if;
  -- Mismos permisos que la evaluación de siempre
  perform public.set_evaluation(p_student_id, p_practice_id, p_evaluation);
  update public.practice_records set comment = nullif(btrim(coalesce(p_comment, '')), ''), updated_by = auth.uid(), updated_at = now()
  where student_id = p_student_id::text and practice_id = p_practice_id;
end;
$$;
revoke all on function public.set_practice_result(uuid, text, text, text) from public, anon;
grant execute on function public.set_practice_result(uuid, text, text, text) to authenticated;

-- Resumen de asistencia de la práctica: solo cuentan las sesiones con asistencia marcada
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
  select case when bool_or(sa.status = 'A') then 'A' when bool_or(sa.status = 'L') then 'L' when count(sa.status) > 0 then 'P' end
  into v_status
  from public.session_attendance sa
  join public.class_sessions cs on cs.id = sa.session_id
  where cs.practice_id = v_practice and cs.status = 'programada' and sa.student_id = v_row.student_id;
  insert into public.practice_records (student_id, practice_id, attendance, updated_by, updated_at)
  values (v_row.student_id::text, v_practice, v_status, auth.uid(), now())
  on conflict (student_id, practice_id) do update
    set attendance = excluded.attendance, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return null;
end;
$$;

-- Arreglo: student_modules.student_id es uuid desde el modelo único; set_attendance y set_evaluation
-- seguían comparándolo con texto y fallaban («operator does not exist: uuid = text»).
do $$
declare f text; def text;
begin
  foreach f in array array['public.set_attendance(uuid,text,text)', 'public.set_evaluation(uuid,text,text)'] loop
    def := pg_get_functiondef(f::regprocedure);
    if position('student_modules where student_id = p_student_id::text' in def) > 0 then
      execute replace(def, 'student_modules where student_id = p_student_id::text', 'student_modules where student_id = p_student_id');
    end if;
  end loop;
end $$;
