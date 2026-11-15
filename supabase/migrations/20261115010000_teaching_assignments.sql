-- Fase 2: profesores por módulo y grupo. 2026-11-15
-- Un profesor imparte un módulo del grado (teoría o práctica) a un grupo concreto.
-- Solo ve y califica a los alumnos que cursan ese módulo con ese grupo.
--
-- La matrícula por módulo (`module_enrollments`) pasa a ser la fuente; `student_modules`
-- y `teacher_modules` se mantienen solos para las pantallas y funciones antiguas.

-- ---------------------------------------------------------------------------
-- 1. Asignaciones
-- ---------------------------------------------------------------------------
create table if not exists public.teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  degree_module_id uuid not null references public.degree_modules(id) on delete cascade,
  group_id uuid not null references public.class_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, degree_module_id, group_id)
);
create index if not exists teaching_assignments_degree_module_id_idx on public.teaching_assignments (degree_module_id);
create index if not exists teaching_assignments_group_id_idx on public.teaching_assignments (group_id);

create or replace function private.group_school(p_group_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select y.school_id from public.class_groups g join public.academic_years y on y.id = g.academic_year_id where g.id = p_group_id;
$$;
revoke all on function private.group_school(uuid) from public, anon;
grant execute on function private.group_school(uuid) to authenticated;

alter table public.teaching_assignments enable row level security;
create policy teaching_assignments_read on public.teaching_assignments for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_school_member(private.group_school(group_id)));
create policy teaching_assignments_insert on public.teaching_assignments for insert to authenticated
  with check (private.can_manage_school(private.group_school(group_id)));
create policy teaching_assignments_update on public.teaching_assignments for update to authenticated
  using (private.can_manage_school(private.group_school(group_id)))
  with check (private.can_manage_school(private.group_school(group_id)));
create policy teaching_assignments_delete on public.teaching_assignments for delete to authenticated
  using (private.can_manage_school(private.group_school(group_id)));
grant select, insert, update, delete on public.teaching_assignments to authenticated;
revoke all on public.teaching_assignments from anon;
alter publication supabase_realtime add table public.teaching_assignments;

-- ---------------------------------------------------------------------------
-- 2. ¿El profesor actual da clase a este alumno? (mismo módulo y mismo grupo)
-- ---------------------------------------------------------------------------
create or replace function private.is_teacher_for_student(p_student_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.teaching_assignments ta
    join public.degree_modules dta on dta.id = ta.degree_module_id
    join public.module_enrollments me on me.group_id = ta.group_id
    join public.degree_modules dme on dme.id = me.degree_module_id and dme.module_id = dta.module_id
    where ta.profile_id = (select auth.uid()) and me.student_id::text = p_student_id
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Sincronización con las tablas antiguas
-- ---------------------------------------------------------------------------
-- teaching_assignments → teacher_modules (módulos del curso actual)
create or replace function private.refresh_teacher_module(p_profile_id uuid, p_module_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.teaching_assignments ta
    join public.degree_modules dm on dm.id = ta.degree_module_id
    join public.class_groups g on g.id = ta.group_id
    join public.academic_years y on y.id = g.academic_year_id and y.is_current
    where ta.profile_id = p_profile_id and dm.module_id = p_module_id
  ) then
    insert into public.teacher_modules (profile_id, module_id) values (p_profile_id, p_module_id) on conflict do nothing;
  else
    delete from public.teacher_modules where profile_id = p_profile_id and module_id = p_module_id;
  end if;
end;
$$;

create or replace function private.trg_teaching_assignments_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.teaching_assignments;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  perform private.refresh_teacher_module(v_row.profile_id, (select module_id from public.degree_modules where id = v_row.degree_module_id));
  if tg_op = 'UPDATE' and (old.profile_id, old.degree_module_id) is distinct from (new.profile_id, new.degree_module_id) then
    perform private.refresh_teacher_module(old.profile_id, (select module_id from public.degree_modules where id = old.degree_module_id));
  end if;
  return null;
end;
$$;

drop trigger if exists teaching_assignments_sync on public.teaching_assignments;
create trigger teaching_assignments_sync after insert or update or delete on public.teaching_assignments
  for each row execute function private.trg_teaching_assignments_sync();

-- module_enrollments → student_modules (módulos del curso actual)
create or replace function private.refresh_student_module(p_student_id uuid, p_module_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.module_enrollments me
    join public.degree_modules dm on dm.id = me.degree_module_id
    join public.academic_years y on y.id = me.academic_year_id and y.is_current
    where me.student_id = p_student_id and dm.module_id = p_module_id
  ) then
    insert into public.student_modules (student_id, module_id) values (p_student_id, p_module_id) on conflict do nothing;
  else
    delete from public.student_modules where student_id = p_student_id and module_id = p_module_id;
  end if;
end;
$$;

create or replace function private.trg_module_enrollments_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row public.module_enrollments;
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- viene de student_modules: no rebotar
  v_row := case when tg_op = 'DELETE' then old else new end;
  perform private.refresh_student_module(v_row.student_id, (select module_id from public.degree_modules where id = v_row.degree_module_id));
  return null;
end;
$$;

drop trigger if exists module_enrollments_sync on public.module_enrollments;
create trigger module_enrollments_sync after insert or delete on public.module_enrollments
  for each row execute function private.trg_module_enrollments_sync();

-- student_modules → module_enrollments solo cuando lo escribe la interfaz antigua
create or replace function private.trg_student_modules_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- viene de module_enrollments: no rebotar
  if tg_op = 'INSERT' then
    perform private.sync_student_module(new.student_id::uuid, new.module_id);
  else
    delete from public.module_enrollments me
    using public.degree_modules dm, public.academic_years y
    where me.student_id = old.student_id::uuid and dm.id = me.degree_module_id and dm.module_id = old.module_id
      and y.id = me.academic_year_id and y.is_current
      and me.theory_grade is null and me.practical_result is null;
  end if;
  return null;
end;
$$;

revoke all on function private.refresh_teacher_module(uuid, text), private.refresh_student_module(uuid, text),
  private.trg_teaching_assignments_sync(), private.trg_module_enrollments_sync(), private.trg_student_modules_sync()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Matricular a todo un grupo en módulos del grado (sustituye a admin_assign_class_modules)
-- ---------------------------------------------------------------------------
create or replace function public.admin_enroll_group(p_group_id uuid, p_degree_module_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g record;
  v_added integer;
  v_students integer;
begin
  select cg.id, cg.academic_year_id, cg.degree_id, y.school_id into g
  from public.class_groups cg join public.academic_years y on y.id = cg.academic_year_id where cg.id = p_group_id;
  if g.id is null then raise exception using errcode = 'P0002', message = 'Grupo no encontrado.'; end if;
  if not private.can_manage_school(g.school_id) then
    raise exception using errcode = '42501', message = 'Solo administración puede matricular grupos.';
  end if;
  if exists (select 1 from unnest(coalesce(p_degree_module_ids, '{}')) x(id)
             where not exists (select 1 from public.degree_modules dm where dm.id = x.id and dm.degree_id = g.degree_id)) then
    raise exception using errcode = '23503', message = 'Algún módulo no pertenece al grado del grupo.';
  end if;

  select count(*) into v_students from public.enrollments where group_id = g.id;
  insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
  select e.student_id, x.id, g.academic_year_id, g.id
  from public.enrollments e cross join unnest(p_degree_module_ids) x(id)
  where e.group_id = g.id
  on conflict (student_id, degree_module_id, academic_year_id) do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('students', v_students, 'added', v_added);
end;
$$;
revoke all on function public.admin_enroll_group(uuid, uuid[]) from public, anon;
grant execute on function public.admin_enroll_group(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. El profesor solo ve y registra a sus alumnos
-- ---------------------------------------------------------------------------
alter policy student_modules_read on public.student_modules
  using (private.is_global_admin() or private.is_student_profile(student_id::text)
    or (private.has_teacher_module(module_id) and private.is_teacher_for_student(student_id::text)));

alter policy practice_records_read on public.practice_records
  using (private.is_global_admin() or private.is_student_profile(student_id)
    or (private.is_teacher_for_student(student_id) and exists (
      select 1 from public.teacher_modules tm join public.practices p on p.module_id = tm.module_id
      where tm.profile_id = (select auth.uid()) and p.id = practice_records.practice_id)));

alter policy practice_records_teacher_write on public.practice_records
  using (private.is_global_admin() or (private.is_teacher_for_student(student_id) and exists (
      select 1 from public.teacher_modules tm join public.practices p on p.module_id = tm.module_id
      where tm.profile_id = (select auth.uid()) and p.id = practice_records.practice_id)))
  with check (private.is_global_admin() or (private.is_teacher_for_student(student_id) and exists (
      select 1 from public.teacher_modules tm join public.practices p on p.module_id = tm.module_id
      where tm.profile_id = (select auth.uid()) and p.id = practice_records.practice_id)));

create or replace function public.set_attendance(p_student_id uuid, p_practice_id text, p_attendance text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text := private.current_profile_role(); v_module_id text;
begin
  if v_role is null or v_role not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para cambiar asistencia.';
  end if;
  if p_attendance is null or p_attendance not in ('P', 'L', 'A') then
    raise exception using errcode = '22023', message = 'Estado de asistencia no válido.';
  end if;
  select module_id into v_module_id from public.practices where id = p_practice_id;
  if not found then raise exception using errcode = '23503', message = 'Práctica no encontrada.'; end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if v_role = 'profesor' and not (private.has_teacher_module(v_module_id) and private.is_teacher_for_student(p_student_id::text)) then
    raise exception using errcode = '42501', message = 'Este alumno no es de tus grupos en este módulo.';
  end if;
  if not exists (select 1 from public.student_modules where student_id = p_student_id::text and module_id = v_module_id)
     and not exists (select 1 from public.students s where s.id = p_student_id and v_module_id = any(coalesce(s.modules, array[]::text[]))) then
    raise exception using errcode = '23503', message = 'El alumno no está matriculado en el módulo.';
  end if;
  insert into public.records (student_id, practice_id, attendance) values (p_student_id, p_practice_id, p_attendance)
  on conflict (student_id, practice_id) do update set attendance = excluded.attendance;
  insert into public.practice_records (student_id, practice_id, attendance, updated_by, updated_at)
  values (p_student_id::text, p_practice_id, p_attendance, auth.uid(), now())
  on conflict (student_id, practice_id) do update set attendance = excluded.attendance, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.set_evaluation(p_student_id uuid, p_practice_id text, p_evaluation text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text := private.current_profile_role(); v_module_id text;
begin
  if v_role is null or v_role not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para cambiar evaluaciones.';
  end if;
  if p_evaluation is not null and p_evaluation not in ('Apto', 'No Apto') then
    raise exception using errcode = '22023', message = 'Evaluación no válida.';
  end if;
  select module_id into v_module_id from public.practices where id = p_practice_id;
  if not found then raise exception using errcode = '23503', message = 'Práctica no encontrada.'; end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if v_role = 'profesor' and not (private.has_teacher_module(v_module_id) and private.is_teacher_for_student(p_student_id::text)) then
    raise exception using errcode = '42501', message = 'Este alumno no es de tus grupos en este módulo.';
  end if;
  if not exists (select 1 from public.student_modules where student_id = p_student_id::text and module_id = v_module_id)
     and not exists (select 1 from public.students s where s.id = p_student_id and v_module_id = any(coalesce(s.modules, array[]::text[]))) then
    raise exception using errcode = '23503', message = 'El alumno no está matriculado en el módulo.';
  end if;
  insert into public.records (student_id, practice_id, evaluation) values (p_student_id, p_practice_id, p_evaluation)
  on conflict (student_id, practice_id) do update set evaluation = excluded.evaluation;
  insert into public.practice_records (student_id, practice_id, evaluation, updated_by, updated_at)
  values (p_student_id::text, p_practice_id, p_evaluation, auth.uid(), now())
  on conflict (student_id, practice_id) do update set evaluation = excluded.evaluation, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.save_practice_records(p_records jsonb)
returns setof public.practice_records language plpgsql security definer set search_path = '' as $$
declare v_record record; v_module_id text; v_role text := private.current_profile_role();
begin
  if v_role is null or v_role not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para registrar asistencia.';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records) > 500 then
    raise exception using errcode = '22023', message = 'La lista de registros no es válida (máximo 500).';
  end if;
  for v_record in select * from jsonb_to_recordset(p_records) as item(student_id text, practice_id text, attendance text, evaluation text) loop
    select module_id into v_module_id from public.practices where id::text = v_record.practice_id;
    if not found then raise exception using errcode = '23503', message = 'Práctica no encontrada.'; end if;
    if v_role = 'profesor' and not (private.has_teacher_module(v_module_id) and private.is_teacher_for_student(v_record.student_id)) then
      raise exception using errcode = '42501', message = 'Este alumno no es de tus grupos en este módulo.';
    end if;
    if not exists (select 1 from public.student_modules where student_id = v_record.student_id and module_id = v_module_id) then
      raise exception using errcode = '23503', message = 'El alumno no está matriculado en el módulo de esta práctica.';
    end if;
    return query insert into public.practice_records (student_id, practice_id, attendance, evaluation, updated_by, updated_at)
      values (v_record.student_id, v_record.practice_id, v_record.attendance, v_record.evaluation, auth.uid(), now())
      on conflict (student_id, practice_id) do update set attendance = excluded.attendance, evaluation = excluded.evaluation,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
      returning *;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Asignaciones antiguas (teacher_modules sin grupo) → todos los grupos actuales
--    cuyos alumnos cursan ese módulo. En producción no hay ninguna a 2026-11-15.
-- ---------------------------------------------------------------------------
insert into public.teaching_assignments (profile_id, degree_module_id, group_id)
select distinct tm.profile_id, me.degree_module_id, me.group_id
from public.teacher_modules tm
join public.degree_modules dm on dm.module_id = tm.module_id
join public.module_enrollments me on me.degree_module_id = dm.id
join public.academic_years y on y.id = me.academic_year_id and y.is_current
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Al cambiar de grupo, se conserva el grado de la matrícula actual
-- ---------------------------------------------------------------------------
create or replace function private.sync_student_enrollment(p_student_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_level smallint;
  v_letter text;
  v_year uuid;
  v_degree uuid;
  v_cohort uuid;
  v_group uuid;
begin
  select id, school_id, class_name, group_name, promo into s from public.students where id = p_student_id;
  if s.id is null or s.school_id is null then return; end if;

  if nullif(trim(coalesce(s.promo, '')), '') is not null then
    insert into public.cohorts (school_id, name) values (s.school_id, trim(s.promo))
    on conflict (school_id, name) do nothing;
    select id into v_cohort from public.cohorts where school_id = s.school_id and name = trim(s.promo);
  end if;
  update public.students set cohort_id = v_cohort where id = s.id and cohort_id is distinct from v_cohort;

  v_level := coalesce(private.parse_level(s.class_name), private.parse_level(s.group_name));
  if v_level is null then return; end if;
  v_letter := coalesce(private.parse_group_letter(s.group_name), 'A');

  v_year := private.ensure_current_year(s.school_id);
  select g.degree_id into v_degree from public.enrollments e join public.class_groups g on g.id = e.group_id
  where e.student_id = s.id and e.academic_year_id = v_year;
  v_degree := coalesce(v_degree, (select degree_id from public.cohorts where id = v_cohort), private.ensure_default_degree(s.school_id));
  update public.cohorts set degree_id = v_degree where id = v_cohort and degree_id is null;

  insert into public.class_groups (academic_year_id, degree_id, level, name)
  values (v_year, v_degree, v_level, v_letter)
  on conflict (academic_year_id, degree_id, level, name) do nothing;
  select id into v_group from public.class_groups
  where academic_year_id = v_year and degree_id = v_degree and level = v_level and name = v_letter;

  insert into public.enrollments (student_id, academic_year_id, group_id, level)
  values (s.id, v_year, v_group, v_level)
  on conflict (student_id, academic_year_id) do update set group_id = excluded.group_id, level = excluded.level
  where public.enrollments.group_id is distinct from excluded.group_id or public.enrollments.level is distinct from excluded.level;

  update public.module_enrollments set group_id = v_group
  where student_id = s.id and academic_year_id = v_year and not is_carryover and group_id is distinct from v_group;
end;
$$;
