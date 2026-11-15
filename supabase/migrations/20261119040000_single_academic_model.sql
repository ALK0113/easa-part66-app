-- Un solo modelo académico.
-- Fuente única: enrollments, module_enrollments, teaching_assignments y cohorts.
-- Lo antiguo pasa a ser una copia calculada de solo lectura (se mantiene para no romper nada que lo lea):
--   · student_modules / teacher_modules: módulos del curso actual, derivados de matrículas y asignaciones.
--   · students.class_name / group_name: grupo del curso actual. students.promo: nombre de su promoción.
-- Además: un profesor «tiene un módulo» si tiene al menos una asignación de ese módulo este curso,
-- y la promoción se crea sola al matricular a un alumno en 1º.

-- 1. Permisos leídos del modelo nuevo
create or replace function private.has_teacher_module(p_module_id text)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.teaching_assignments ta
    join public.degree_modules dm on dm.id = ta.degree_module_id
    join public.class_groups g on g.id = ta.group_id
    join public.academic_years y on y.id = g.academic_year_id and y.is_current
    where ta.profile_id = (select auth.uid()) and dm.module_id = p_module_id
  );
$$;

create or replace function private.is_student_in_module(p_module_id text)
returns boolean language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.student_profiles sp
    join public.module_enrollments me on me.student_id = sp.student_id
    join public.degree_modules dm on dm.id = me.degree_module_id
    join public.academic_years y on y.id = me.academic_year_id and y.is_current
    where sp.profile_id = (select auth.uid()) and dm.module_id = p_module_id
  );
$$;

drop policy if exists practices_manage on public.practices;
create policy practices_manage on public.practices for all to authenticated
  using (private.is_global_admin() or (private.is_supervisor() and school_id = private.current_school_id()) or private.has_teacher_module(module_id))
  with check (private.is_global_admin() or (private.is_supervisor() and school_id = private.current_school_id()) or private.has_teacher_module(module_id));

-- 2. student_modules y teacher_modules: solo lectura para la app; las mantiene la base de datos
drop policy if exists student_modules_manage on public.student_modules;
drop policy if exists teacher_modules_manage on public.teacher_modules;
drop trigger if exists student_modules_sync on public.student_modules;

create or replace function private.trg_module_enrollments_sync()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare v_row public.module_enrollments := coalesce(new, old);
begin
  perform private.refresh_student_module(v_row.student_id, (select module_id from public.degree_modules where id = v_row.degree_module_id));
  return null;
end;
$$;

-- Al cambiar el curso actual, las copias se recalculan para toda la escuela
create or replace function private.refresh_school_copies(p_school_id uuid)
returns void language plpgsql security definer set search_path to ''
as $$
begin
  delete from public.student_modules sm using public.students s
  where s.id = sm.student_id and s.school_id = p_school_id
    and not exists (select 1 from public.module_enrollments me
      join public.degree_modules dm on dm.id = me.degree_module_id
      join public.academic_years y on y.id = me.academic_year_id and y.is_current
      where me.student_id = sm.student_id and dm.module_id = sm.module_id);
  insert into public.student_modules (student_id, module_id)
  select distinct me.student_id, dm.module_id from public.module_enrollments me
  join public.degree_modules dm on dm.id = me.degree_module_id
  join public.academic_years y on y.id = me.academic_year_id and y.is_current and y.school_id = p_school_id
  on conflict do nothing;

  delete from public.teacher_modules tm using public.school_profiles sp
  where sp.profile_id = tm.profile_id and sp.school_id = p_school_id
    and not exists (select 1 from public.teaching_assignments ta
      join public.degree_modules dm on dm.id = ta.degree_module_id
      join public.class_groups g on g.id = ta.group_id
      join public.academic_years y on y.id = g.academic_year_id and y.is_current
      where ta.profile_id = tm.profile_id and dm.module_id = tm.module_id);
  insert into public.teacher_modules (profile_id, module_id)
  select distinct ta.profile_id, dm.module_id from public.teaching_assignments ta
  join public.degree_modules dm on dm.id = ta.degree_module_id
  join public.class_groups g on g.id = ta.group_id
  join public.academic_years y on y.id = g.academic_year_id and y.is_current and y.school_id = p_school_id
  on conflict do nothing;

  perform private.touch_student_labels(id) from public.students where school_id = p_school_id;
end;
$$;

-- 3. Textos de compatibilidad del alumno, siempre calculados
create or replace function private.derive_student_labels()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare g record;
begin
  select cg.level, cg.name into g
  from public.enrollments en
  join public.academic_years y on y.id = en.academic_year_id and y.is_current
  join public.class_groups cg on cg.id = en.group_id
  where en.student_id = new.id
  limit 1;
  new.class_name := case when g.level is null then null else g.level || 'º' end;
  new.group_name := case when g.level is null then null else g.level || 'º' || g.name end;
  new.promo := (select name from public.cohorts where id = new.cohort_id);
  return new;
end;
$$;

drop trigger if exists students_derive_labels on public.students;
create trigger students_derive_labels
  before insert or update on public.students
  for each row execute function private.derive_student_labels();

-- Recalcula los textos de un alumno (la ficha la protege otro trigger: aquí no es un cambio del usuario)
create or replace function private.touch_student_labels(p_student_id uuid)
returns void language plpgsql security definer set search_path to ''
as $$
begin
  perform set_config('app.derived_labels', 'on', true);
  update public.students set class_name = class_name where id = p_student_id;
  perform set_config('app.derived_labels', 'off', true);
end;
$$;

create or replace function public.protect_student_sensitive_columns()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if current_setting('app.derived_labels', true) = 'on' then return new; end if;
  if auth.uid() is not null and not (private.is_global_admin() or private.is_supervisor()) then
    raise exception 'Solo un administrador puede modificar la ficha del alumno' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- El alumno ya no empuja datos hacia la matrícula: solo se conserva el cambio de escuela
drop trigger if exists students_sync_enrollment on public.students;
create or replace function private.trg_students_school_change()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  delete from public.enrollments en using public.academic_years y
  where en.student_id = new.id and y.id = en.academic_year_id and y.school_id is distinct from new.school_id and y.is_current;
  return null;
end;
$$;
drop trigger if exists students_school_change on public.students;
create trigger students_school_change
  after update of school_id on public.students
  for each row when (old.school_id is distinct from new.school_id)
  execute function private.trg_students_school_change();

-- Matrícula → textos del alumno y promoción automática en 1º
create or replace function private.trg_enrollments_after()
returns trigger language plpgsql security definer set search_path to ''
as $$
declare
  v_row public.enrollments := coalesce(new, old);
  v_cohort uuid;
  y record;
begin
  if tg_op = 'INSERT' and new.level = 1 and (select cohort_id from public.students where id = new.student_id) is null then
    select ay.school_id, ay.starts_on, cg.degree_id into y
    from public.academic_years ay join public.class_groups cg on cg.id = new.group_id
    where ay.id = new.academic_year_id;
    if y.school_id is not null then
      insert into public.cohorts (school_id, degree_id, name)
      values (y.school_id, y.degree_id, extract(year from coalesce(y.starts_on, current_date))::text)
      on conflict (school_id, name) do nothing;
      select id into v_cohort from public.cohorts
      where school_id = y.school_id and name = extract(year from coalesce(y.starts_on, current_date))::text;
      perform set_config('app.derived_labels', 'on', true);
      update public.students set cohort_id = v_cohort where id = new.student_id;
      perform set_config('app.derived_labels', 'off', true);
    end if;
  end if;
  perform private.touch_student_labels(v_row.student_id);
  return null;
end;
$$;
drop trigger if exists enrollments_after on public.enrollments;
create trigger enrollments_after
  after insert or update or delete on public.enrollments
  for each row execute function private.trg_enrollments_after();

create or replace function private.trg_academic_year_current()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  perform private.refresh_school_copies(new.school_id);
  return null;
end;
$$;
drop trigger if exists academic_years_current on public.academic_years;
create trigger academic_years_current
  after update of is_current on public.academic_years
  for each row when (old.is_current is distinct from new.is_current and new.is_current)
  execute function private.trg_academic_year_current();

-- Renombrar grupo o promoción: los textos se recalculan solos
create or replace function private.trg_structure_rename()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if tg_table_name = 'class_groups' then
    perform private.touch_student_labels(en.student_id) from public.enrollments en where en.group_id = new.id;
  elsif tg_table_name = 'cohorts' then
    perform private.touch_student_labels(id) from public.students where cohort_id = new.id;
  end if;
  return null;
end;
$$;

-- 4. Colocar a un alumno a partir de textos (importación, copias de seguridad y datos de ejemplo):
--    curso «2º», grupo «2ºA» o «A», promoción «2025» → grupo del curso actual, matrícula y promoción.
create or replace function private.place_student(p_student_id uuid, p_class text, p_group text, p_promo text)
returns void language plpgsql security definer set search_path to ''
as $$
declare
  v_school uuid;
  v_level smallint;
  v_letter text;
  v_year uuid;
  v_degree uuid;
  v_cohort uuid;
  v_group uuid;
begin
  select school_id into v_school from public.students where id = p_student_id;
  if v_school is null then return; end if;

  if nullif(trim(coalesce(p_promo, '')), '') is not null then
    insert into public.cohorts (school_id, name) values (v_school, trim(p_promo)) on conflict (school_id, name) do nothing;
    select id into v_cohort from public.cohorts where school_id = v_school and name = trim(p_promo);
    perform set_config('app.derived_labels', 'on', true);
    update public.students set cohort_id = v_cohort where id = p_student_id and cohort_id is distinct from v_cohort;
    perform set_config('app.derived_labels', 'off', true);
  end if;

  v_level := coalesce(private.parse_level(p_class), private.parse_level(p_group));
  if v_level is null then return; end if;
  v_letter := coalesce(private.parse_group_letter(p_group), 'A');

  v_year := private.ensure_current_year(v_school);
  select g.degree_id into v_degree from public.enrollments e join public.class_groups g on g.id = e.group_id
  where e.student_id = p_student_id and e.academic_year_id = v_year;
  v_degree := coalesce(v_degree, (select degree_id from public.cohorts where id = v_cohort), private.ensure_default_degree(v_school));
  update public.cohorts set degree_id = v_degree where id = v_cohort and degree_id is null;

  insert into public.class_groups (academic_year_id, degree_id, level, name)
  values (v_year, v_degree, v_level, v_letter)
  on conflict (academic_year_id, degree_id, level, name) do nothing;
  select id into v_group from public.class_groups
  where academic_year_id = v_year and degree_id = v_degree and level = v_level and name = v_letter;

  insert into public.enrollments (student_id, academic_year_id, group_id, level)
  values (p_student_id, v_year, v_group, v_level)
  on conflict (student_id, academic_year_id) do update set group_id = excluded.group_id, level = excluded.level
  where public.enrollments.group_id is distinct from excluded.group_id or public.enrollments.level is distinct from excluded.level;

  update public.module_enrollments set group_id = v_group
  where student_id = p_student_id and academic_year_id = v_year and not is_carryover and group_id is distinct from v_group;
end;
$$;
revoke all on function private.place_student(uuid, text, text, text) from public, anon, authenticated;

-- Datos de ejemplo (Configuración): colocar un alumno y matricularlo en módulos
create or replace function public.admin_place_student(p_student_id uuid, p_class text, p_group text, p_promo text, p_module_ids text[] default '{}')
returns void language plpgsql security definer set search_path to ''
as $$
declare m text;
begin
  if not private.is_global_admin() then
    raise exception using errcode = '42501', message = 'Solo administración.';
  end if;
  perform private.place_student(p_student_id, p_class, p_group, p_promo);
  foreach m in array coalesce(p_module_ids, '{}') loop
    perform private.sync_student_module(p_student_id, m);
  end loop;
end;
$$;
grant execute on function public.admin_place_student(uuid, text, text, text, text[]) to authenticated;

-- Importación de alumnos (función de servidor): ficha + grupo + promoción + módulos en el modelo nuevo
create or replace function public.admin_import_student(p_profile_id uuid, p_student jsonb, p_module_ids text[])
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  v_student_id uuid;
  v_number integer;
  v_school_id uuid;
  v_name text := nullif(trim(p_student->>'name'), '');
  m text;
begin
  if auth.role() is distinct from 'service_role' and not private.is_global_admin() then
    raise exception using errcode = '42501', message = 'Solo administración puede importar alumnos.';
  end if;
  if v_name is null then
    raise exception using errcode = '22023', message = 'El nombre del alumno es obligatorio.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and role = 'alumno') then
    raise exception using errcode = '23503', message = 'Perfil de alumno no encontrado.';
  end if;
  select sp.school_id into v_school_id from public.school_profiles sp where sp.profile_id = p_profile_id;
  if v_school_id is null then
    raise exception using errcode = '23503', message = 'El perfil no pertenece a ninguna escuela.';
  end if;
  if exists (select 1 from unnest(coalesce(p_module_ids, array[]::text[])) r(module_id)
             where not exists (select 1 from public.modules x where x.id = r.module_id)) then
    raise exception using errcode = '23503', message = 'Uno o más módulos no existen.';
  end if;

  perform pg_advisory_xact_lock(hashtext('students.student_number'));
  v_number := coalesce(
    nullif(p_student->>'student_number', '')::integer,
    (select coalesce(max(student_number), 0) + 1 from public.students where school_id = v_school_id)
  );

  insert into public.students (student_number, name, school_id)
  values (v_number, v_name, v_school_id)
  returning id into v_student_id;
  insert into public.student_private (student_id, birth_date, identification)
  values (v_student_id, nullif(p_student->>'birth_date', '')::date, nullif(trim(p_student->>'identification'), ''));
  insert into public.student_profiles (student_id, profile_id) values (v_student_id, p_profile_id);

  perform private.place_student(v_student_id, p_student->>'class_name', p_student->>'group_name', p_student->>'promo');
  foreach m in array coalesce(p_module_ids, '{}') loop
    perform private.sync_student_module(v_student_id, m);
  end loop;

  return jsonb_build_object('student_id', v_student_id, 'student_number', v_number);
end;
$$;

-- Importación de profesores: sus módulos se convierten en asignaciones de los grupos del curso actual
-- donde se imparte ese módulo (mismo grado y curso). Sin grupos aún, no se asigna nada.
create or replace function public.service_assign_teacher_modules(p_profile_id uuid, p_module_ids text[])
returns integer language plpgsql security definer set search_path to ''
as $$
declare v_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Solo el servidor puede usar esta función.';
  end if;
  insert into public.teaching_assignments (profile_id, degree_module_id, group_id)
  select p_profile_id, dm.id, g.id
  from public.school_profiles sp
  join public.academic_years y on y.school_id = sp.school_id and y.is_current
  join public.class_groups g on g.academic_year_id = y.id
  join public.degree_modules dm on dm.degree_id = g.degree_id and dm.level = g.level
  where sp.profile_id = p_profile_id and dm.module_id = any(coalesce(p_module_ids, '{}'))
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.service_assign_teacher_modules(uuid, text[]) from public, anon, authenticated;
grant execute on function public.service_assign_teacher_modules(uuid, text[]) to service_role;

-- Cambiar a un alumno de grupo este curso (Asignaciones → Alumnos)
create or replace function public.manager_move_student(p_student_id uuid, p_group_id uuid)
returns void language plpgsql security definer set search_path to ''
as $$
declare g record;
begin
  select cg.id, cg.academic_year_id, cg.level, y.school_id into g
  from public.class_groups cg join public.academic_years y on y.id = cg.academic_year_id where cg.id = p_group_id;
  if g.id is null then raise exception using errcode = '23503', message = 'Grupo no encontrado.'; end if;
  if not private.can_manage_school(g.school_id) then
    raise exception using errcode = '42501', message = 'Solo la gestión de la escuela puede cambiar de grupo.';
  end if;
  if not exists (select 1 from public.students where id = p_student_id and school_id = g.school_id) then
    raise exception using errcode = '23503', message = 'El alumno no es de esta escuela.';
  end if;
  insert into public.enrollments (student_id, academic_year_id, group_id, level)
  values (p_student_id, g.academic_year_id, g.id, g.level)
  on conflict (student_id, academic_year_id) do update set group_id = excluded.group_id, level = excluded.level;
  update public.module_enrollments set group_id = g.id
  where student_id = p_student_id and academic_year_id = g.academic_year_id and not is_carryover and group_id is distinct from g.id;
end;
$$;
grant execute on function public.manager_move_student(uuid, uuid) to authenticated;

-- Copias de seguridad: lo antiguo se traduce al modelo nuevo al importar
create or replace function public.admin_import_academic_backup(p_tables jsonb)
returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  table_name text;
  table_rows jsonb;
  inserted_count integer;
  result jsonb := '{}'::jsonb;
  r jsonb;
  import_order text[] := array[
    'modules', 'students', 'student_profiles', 'student_modules', 'teacher_modules',
    'practices', 'aircraft', 'videos', 'tlbs', 'defects', 'defect_answers', 'practice_records'
  ];
begin
  if not private.is_global_admin() then
    raise exception using errcode = '42501', message = 'Solo administración puede importar copias.';
  end if;
  if jsonb_typeof(p_tables) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'El contenido del backup no es válido.';
  end if;

  foreach table_name in array import_order loop
    table_rows := p_tables -> table_name;
    if table_rows is null then
      result := result || jsonb_build_object(table_name, 0);
      continue;
    end if;
    if jsonb_typeof(table_rows) is distinct from 'array' then
      raise exception using errcode = '22023', message = format('La tabla %s debe ser una lista.', table_name);
    end if;

    if table_name = 'student_modules' then
      -- Matrícula en el módulo dentro del grupo del alumno (modelo nuevo)
      inserted_count := 0;
      for r in select * from jsonb_array_elements(table_rows) loop
        if exists (select 1 from public.students where id = (r->>'student_id')::uuid) then
          perform private.sync_student_module((r->>'student_id')::uuid, r->>'module_id');
          inserted_count := inserted_count + 1;
        end if;
      end loop;
    elsif table_name = 'teacher_modules' then
      -- Sin grupo no hay asignación: los profesores se asignan en Asignaciones
      inserted_count := 0;
    else
      execute format(
        'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
        table_name, table_name
      ) using table_rows;
      get diagnostics inserted_count = row_count;
    end if;
    result := result || jsonb_build_object(table_name, inserted_count);

    if table_name = 'students' then
      for r in select * from jsonb_array_elements(table_rows) loop
        if exists (select 1 from public.students where id = (r->>'id')::uuid) then
          perform private.place_student((r->>'id')::uuid, r->>'class_name', r->>'group_name', r->>'promo');
        end if;
      end loop;
    elsif table_name = 'defects' then
      insert into public.defect_answers (defect_id, correct_action)
      select (d ->> 'id')::uuid, d ->> 'correct_action'
      from jsonb_array_elements(table_rows) d
      where d ? 'correct_action' and d ->> 'correct_action' is not null
        and exists (select 1 from public.defects x where x.id = (d ->> 'id')::uuid)
      on conflict (defect_id) do nothing;
    end if;
  end loop;
  return result;
end;
$$;

-- RPC antiguas sin uso que escribían solo en las tablas antiguas (dejarían datos incoherentes)
drop function if exists public.admin_assign_class_modules cascade;
drop function if exists public.admin_create_student_with_profile cascade;
drop function if exists public.admin_replace_student_modules cascade;
drop function if exists public.admin_replace_teacher_modules cascade;
drop function if exists public.admin_update_student_with_modules cascade;

-- 5. Recalcular las copias con los datos actuales
select private.refresh_school_copies(id) from public.schools;

-- Sin acceso anónimo a las RPC nuevas (aplicado aparte como revoke_anon_new_rpcs)
revoke execute on function public.admin_place_student(uuid, text, text, text, text[]) from public, anon;
revoke execute on function public.manager_move_student(uuid, uuid) from public, anon;
grant execute on function public.admin_place_student(uuid, text, text, text, text[]) to authenticated;
grant execute on function public.manager_move_student(uuid, uuid) to authenticated;
