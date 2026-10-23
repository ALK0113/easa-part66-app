create or replace function public.set_attendance(
  p_student_id uuid,
  p_practice_id text,
  p_attendance text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.current_profile_role();
  v_module_id text;
begin
  if v_role is null or v_role not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para cambiar asistencia.';
  end if;
  if p_attendance is null or p_attendance not in ('P', 'L', 'A') then
    raise exception using errcode = '22023', message = 'Estado de asistencia no válido.';
  end if;

  select module_id into v_module_id
  from public.practices
  where id = p_practice_id;
  if not found then
    raise exception using errcode = '23503', message = 'Práctica no encontrada.';
  end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if v_role = 'profesor' and not private.has_teacher_module(v_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado el módulo de esta práctica.';
  end if;
  if not exists (
    select 1 from public.student_modules
    where student_id = p_student_id::text and module_id = v_module_id
  ) and not exists (
    select 1 from public.students s
    where s.id = p_student_id and v_module_id = any(coalesce(s.modules, array[]::text[]))
  ) then
    raise exception using errcode = '23503', message = 'El alumno no está matriculado en el módulo.';
  end if;

  insert into public.records (student_id, practice_id, attendance)
  values (p_student_id, p_practice_id, p_attendance)
  on conflict (student_id, practice_id)
  do update set attendance = excluded.attendance;

  insert into public.practice_records (
    student_id, practice_id, attendance, updated_by, updated_at
  ) values (
    p_student_id::text, p_practice_id, p_attendance, auth.uid(), now()
  )
  on conflict (student_id, practice_id)
  do update set attendance = excluded.attendance,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at;
end;
$$;

create or replace function public.set_evaluation(
  p_student_id uuid,
  p_practice_id text,
  p_evaluation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := private.current_profile_role();
  v_module_id text;
begin
  if v_role is null or v_role not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para cambiar evaluaciones.';
  end if;
  if p_evaluation is not null and p_evaluation not in ('Apto', 'No Apto') then
    raise exception using errcode = '22023', message = 'Evaluación no válida.';
  end if;

  select module_id into v_module_id
  from public.practices
  where id = p_practice_id;
  if not found then
    raise exception using errcode = '23503', message = 'Práctica no encontrada.';
  end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if v_role = 'profesor' and not private.has_teacher_module(v_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado el módulo de esta práctica.';
  end if;
  if not exists (
    select 1 from public.student_modules
    where student_id = p_student_id::text and module_id = v_module_id
  ) and not exists (
    select 1 from public.students s
    where s.id = p_student_id and v_module_id = any(coalesce(s.modules, array[]::text[]))
  ) then
    raise exception using errcode = '23503', message = 'El alumno no está matriculado en el módulo.';
  end if;

  insert into public.records (student_id, practice_id, evaluation)
  values (p_student_id, p_practice_id, p_evaluation)
  on conflict (student_id, practice_id)
  do update set evaluation = excluded.evaluation;

  insert into public.practice_records (
    student_id, practice_id, evaluation, updated_by, updated_at
  ) values (
    p_student_id::text, p_practice_id, p_evaluation, auth.uid(), now()
  )
  on conflict (student_id, practice_id)
  do update set evaluation = excluded.evaluation,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at;
end;
$$;

create or replace function public.set_attendance_bulk(
  p_student_ids uuid[],
  p_practice_id text,
  p_attendance text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_count integer := 0;
begin
  if p_student_ids is null or cardinality(p_student_ids) > 500 then
    raise exception using errcode = '22023', message = 'La lista debe contener como máximo 500 alumnos.';
  end if;
  foreach v_student_id in array p_student_ids loop
    perform public.set_attendance(v_student_id, p_practice_id, p_attendance);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

alter table public.records enable row level security;
revoke all on public.records from anon;
grant select on public.records to authenticated;
drop policy if exists "Allow public read access on records" on public.records;
drop policy if exists records_authenticated_read on public.records;
create policy records_authenticated_read on public.records
  for select to authenticated
  using (
    private.current_profile_role() = 'admin'
    or private.is_student_profile(student_id::text)
    or exists (
      select 1 from public.teacher_modules tm
      join public.practices p on p.module_id = tm.module_id
      where tm.profile_id = auth.uid() and p.id = records.practice_id
    )
  );

insert into public.practice_records (student_id, practice_id, attendance, evaluation, updated_at)
select r.student_id::text, r.practice_id, r.attendance, r.evaluation, r.created_at
from public.records r
on conflict (student_id, practice_id) do update
set attendance = coalesce(practice_records.attendance, excluded.attendance),
    evaluation = coalesce(practice_records.evaluation, excluded.evaluation),
    updated_at = greatest(practice_records.updated_at, excluded.updated_at);

revoke all on function public.set_attendance(uuid, text, text) from public, anon;
revoke all on function public.set_evaluation(uuid, text, text) from public, anon;
revoke all on function public.set_attendance_bulk(uuid[], text, text) from public, anon;
grant execute on function public.set_attendance(uuid, text, text) to authenticated;
grant execute on function public.set_evaluation(uuid, text, text) to authenticated;
grant execute on function public.set_attendance_bulk(uuid[], text, text) to authenticated;