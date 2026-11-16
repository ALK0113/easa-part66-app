-- Asistencia en cada sesión de las clases teóricas y prácticas.
-- 1. Una sesión pertenece a una clase teórica o a una práctica, nunca a las dos.
-- 2. La unión automática sesión ↔ práctica del día no toca las sesiones de clase teórica.
-- 3. Lista de varias sesiones a la vez (detalle de la clase: control por sesión y resumen por alumno).
-- 4. La asistencia de la práctica (informes) resume sus sesiones: falta si faltó a alguna,
--    tarde si llegó tarde a alguna, presente si estuvo en todas las pasadas.

update public.class_sessions set practice_id = null where practice_id is not null and theory_class_id is not null;

alter table public.class_sessions
  add constraint class_sessions_one_class check (practice_id is null or theory_class_id is null) not valid;
alter table public.class_sessions validate constraint class_sessions_one_class;

create or replace function private.link_session_practice()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.practice_id is null and new.theory_class_id is null and (tg_op = 'INSERT' or new.date is distinct from old.date) then
    new.practice_id := private.practice_for_assignment_on(new.teaching_assignment_id, new.date);
  end if;
  return new;
end;
$$;

create or replace function public.sessions_attendance(p_session_ids uuid[])
returns table(session_id uuid, student_id uuid, name text, status text)
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
    select s.id, st.id, st.name, sa.status
    from unnest(p_session_ids) s(id)
    cross join lateral private.session_students(s.id) r
    join public.students st on st.id = r.student_id
    left join public.session_attendance sa on sa.session_id = s.id and sa.student_id = st.id
    where private.is_assignment_teacher(private.session_assignment(s.id))
       or private.can_manage_school(private.assignment_school(private.session_assignment(s.id)))
    order by st.name;
end;
$$;

revoke all on function public.sessions_attendance(uuid[]) from public, anon;
grant execute on function public.sessions_attendance(uuid[]) to authenticated;

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
  select cs.practice_id, p.module_id into v_practice, v_module
  from public.class_sessions cs join public.practices p on p.id = cs.practice_id
  where cs.id = v_row.session_id;
  if v_practice is null then return null; end if;
  if not exists (select 1 from public.student_modules where student_id = v_row.student_id and module_id = v_module) then
    return null;
  end if;

  select case when bool_or(sa.status = 'A') then 'A' when bool_or(sa.status = 'L') then 'L' when count(*) > 0 then 'P' end
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
