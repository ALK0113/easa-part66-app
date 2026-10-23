create index if not exists student_modules_module_student_idx
  on public.student_modules (module_id, student_id);
create index if not exists teacher_modules_module_profile_idx
  on public.teacher_modules (module_id, profile_id);
create index if not exists student_profiles_profile_student_idx
  on public.student_profiles (profile_id, student_id);
create index if not exists practices_module_date_idx
  on public.practices (module_id, date);
create index if not exists tlbs_module_date_idx
  on public.tlbs (module_id, date desc);
create index if not exists tlbs_practice_id_idx
  on public.tlbs (practice_id);
create index if not exists defects_tlb_number_idx
  on public.defects (tlb_id, defect_number);
create index if not exists videos_module_ata_idx
  on public.videos (module_id, ata);
create index if not exists practice_records_student_idx
  on public.practice_records (student_id, practice_id);

do $$
declare
  relation record;
  source_type oid;
  target_type oid;
  has_orphans boolean;
  constraint_exists boolean;
begin
  for relation in
    select * from (values
      ('student_profiles', 'student_id', 'students', 'id', 'student_profiles_student_fk'),
      ('student_modules', 'student_id', 'students', 'id', 'student_modules_student_fk'),
      ('student_modules', 'module_id', 'modules', 'id', 'student_modules_module_fk'),
      ('teacher_modules', 'module_id', 'modules', 'id', 'teacher_modules_module_fk'),
      ('practice_records', 'practice_id', 'practices', 'id', 'practice_records_practice_fk'),
      ('practices', 'module_id', 'modules', 'id', 'practices_module_fk'),
      ('tlbs', 'module_id', 'modules', 'id', 'tlbs_module_fk'),
      ('tlbs', 'practice_id', 'practices', 'id', 'tlbs_practice_fk'),
      ('videos', 'module_id', 'modules', 'id', 'videos_module_fk'),
      ('defects', 'tlb_id', 'tlbs', 'id', 'defects_tlb_fk')
    ) as refs(child_table, child_column, parent_table, parent_column, constraint_name)
  loop
    select child_attr.atttypid, parent_attr.atttypid
      into source_type, target_type
    from pg_attribute child_attr
    join pg_class child_class on child_class.oid = child_attr.attrelid
    join pg_namespace child_schema on child_schema.oid = child_class.relnamespace
    cross join pg_attribute parent_attr
    join pg_class parent_class on parent_class.oid = parent_attr.attrelid
    join pg_namespace parent_schema on parent_schema.oid = parent_class.relnamespace
    where child_schema.nspname = 'public'
      and child_class.relname = relation.child_table
      and child_attr.attname = relation.child_column
      and parent_schema.nspname = 'public'
      and parent_class.relname = relation.parent_table
      and parent_attr.attname = relation.parent_column
      and not child_attr.attisdropped
      and not parent_attr.attisdropped;

    if source_type is distinct from target_type then
      continue;
    end if;

    select exists (
      select 1 from pg_constraint c
      where c.conrelid = format('public.%I', relation.child_table)::regclass
        and c.conname = relation.constraint_name
    ) into constraint_exists;
    if constraint_exists then
      continue;
    end if;

    execute format(
      'select exists (select 1 from public.%I child where not exists (select 1 from public.%I parent where parent.%I = child.%I))',
      relation.child_table, relation.parent_table, relation.parent_column, relation.child_column
    ) into has_orphans;
    if has_orphans then
      raise notice 'Skipping foreign key % because existing rows are orphaned.', relation.constraint_name;
      continue;
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.%I (%I)',
      relation.child_table, relation.constraint_name, relation.child_column,
      relation.parent_table, relation.parent_column
    );
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from public.students
    group by student_number having count(*) > 1
  ) then
    create unique index if not exists students_student_number_unique_idx
      on public.students (student_number);
  else
    raise notice 'Skipping unique student number index because duplicates already exist.';
  end if;

  if not exists (
    select 1 from public.aircraft
    group by registration having count(*) > 1
  ) then
    create unique index if not exists aircraft_registration_unique_idx
      on public.aircraft (registration);
  else
    raise notice 'Skipping unique aircraft registration index because duplicates already exist.';
  end if;
end $$;

create or replace function public.admin_replace_student_modules(
  p_student_id text,
  p_module_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede cambiar matrículas.';
  end if;
  if not exists (select 1 from public.students where id::text = p_student_id) then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_module_ids, array[]::text[])) requested(module_id)
    where not exists (select 1 from public.modules m where m.id = requested.module_id)
  ) then
    raise exception using errcode = '23503', message = 'Uno o más módulos no existen.';
  end if;

  delete from public.student_modules where student_id = p_student_id;
  insert into public.student_modules (student_id, module_id)
  select p_student_id, requested.module_id
  from unnest(coalesce(p_module_ids, array[]::text[])) requested(module_id)
  on conflict (student_id, module_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_replace_teacher_modules(
  p_profile_id uuid,
  p_module_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede cambiar asignaciones docentes.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and role::text = 'profesor') then
    raise exception using errcode = '23503', message = 'Profesor no encontrado.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_module_ids, array[]::text[])) requested(module_id)
    where not exists (select 1 from public.modules m where m.id = requested.module_id)
  ) then
    raise exception using errcode = '23503', message = 'Uno o más módulos no existen.';
  end if;

  delete from public.teacher_modules where profile_id = p_profile_id;
  insert into public.teacher_modules (profile_id, module_id)
  select p_profile_id, requested.module_id
  from unnest(coalesce(p_module_ids, array[]::text[])) requested(module_id)
  on conflict (profile_id, module_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_link_student_profile(
  p_student_id text,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede vincular cuentas.';
  end if;
  if not exists (select 1 from public.students where id::text = p_student_id) then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  if p_profile_id is not null and not exists (
    select 1 from public.profiles where id = p_profile_id and role::text = 'alumno'
  ) then
    raise exception using errcode = '23503', message = 'La cuenta seleccionada no es un alumno válido.';
  end if;

  delete from public.student_profiles where student_id = p_student_id;
  if p_profile_id is not null then
    insert into public.student_profiles (student_id, profile_id)
    values (p_student_id, p_profile_id);
  end if;
end;
$$;

create or replace function public.admin_create_tlb_with_defect(
  p_module_id text,
  p_practice_id text,
  p_aircraft_id text,
  p_date date,
  p_teacher_name text,
  p_defect_description text,
  p_correct_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_practice record;
  v_aircraft record;
  v_tlb public.tlbs%rowtype;
  v_defect public.defects%rowtype;
begin
  if private.current_profile_role() is null or private.current_profile_role() not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para crear un TLB.';
  end if;
  if private.current_profile_role() = 'profesor' and not private.has_teacher_module(p_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado este módulo.';
  end if;
  select id, ata into v_practice
  from public.practices
  where id::text = p_practice_id and module_id = p_module_id;
  if not found then
    raise exception using errcode = '23503', message = 'La práctica no pertenece al módulo seleccionado.';
  end if;
  select type, registration, msn into v_aircraft
  from public.aircraft
  where id::text = p_aircraft_id;
  if not found then
    raise exception using errcode = '23503', message = 'Aeronave no encontrada.';
  end if;
  if nullif(trim(p_defect_description), '') is null or nullif(trim(p_correct_action), '') is null then
    raise exception using errcode = '22023', message = 'El defecto y la acción correctiva son obligatorios.';
  end if;

  insert into public.tlbs (
    module_id, practice_id, aircraft, registration, msn, date, teacher_name, published, crs
  ) values (
    p_module_id, p_practice_id, v_aircraft.type, v_aircraft.registration, v_aircraft.msn,
    p_date, p_teacher_name, false,
    'CERTIFICATE OF RELEASE TO SERVICE - CERTIFIES THAT THE WORK SPECIFIED WAS CARRIED OUT IN ACCORDANCE WITH PART-145'
  ) returning * into v_tlb;

  insert into public.defects (
    tlb_id, defect_number, ata, pirep, defect_description, correct_action
  ) values (
    v_tlb.id, 1, v_practice.ata, 'CPT', trim(p_defect_description), trim(p_correct_action)
  ) returning * into v_defect;

  return jsonb_build_object('tlb', to_jsonb(v_tlb), 'defect', to_jsonb(v_defect));
end;
$$;

create or replace function public.admin_delete_practice(p_practice_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede eliminar prácticas.';
  end if;
  if exists (select 1 from public.tlbs where practice_id::text = p_practice_id) then
    raise exception using errcode = '23503', message = 'No se puede eliminar una práctica con TLB asociados.';
  end if;
  delete from public.practice_records where practice_id = p_practice_id;
  delete from public.practices where id::text = p_practice_id;
end;
$$;

create or replace function public.admin_set_profile_role(
  p_profile_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede cambiar roles.';
  end if;
  if p_role not in ('alumno', 'profesor') then
    raise exception using errcode = '22023', message = 'Rol no válido.';
  end if;
  update public.profiles set role = p_role where id = p_profile_id;
  if not found then
    raise exception using errcode = '23503', message = 'Perfil no encontrado.';
  end if;
  if p_role <> 'profesor' then
    delete from public.teacher_modules where profile_id = p_profile_id;
  end if;
  if p_role <> 'alumno' then
    delete from public.student_profiles where profile_id = p_profile_id;
  end if;
end;
$$;

create or replace function public.admin_create_student_with_profile(
  p_student jsonb,
  p_profile_id uuid,
  p_module_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
  v_student_id text;
begin
  if auth.role() is distinct from 'service_role'
    and private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede crear alumnos.';
  end if;
  select * into v_student
  from jsonb_populate_record(null::public.students, p_student);
  if v_student.student_number is null or nullif(trim(v_student.name), '') is null then
    raise exception using errcode = '22023', message = 'Número y nombre del alumno son obligatorios.';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and role::text = 'alumno') then
    raise exception using errcode = '23503', message = 'Perfil de alumno no encontrado.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_module_ids, array[]::text[])) requested(module_id)
    where not exists (select 1 from public.modules m where m.id = requested.module_id)
  ) then
    raise exception using errcode = '23503', message = 'Uno o más módulos no existen.';
  end if;

  insert into public.students (student_number, name, group_name, promo)
  values (v_student.student_number, trim(v_student.name), v_student.group_name, v_student.promo)
  returning id::text into v_student_id;
  insert into public.student_profiles (student_id, profile_id)
  values (v_student_id, p_profile_id);
  insert into public.student_modules (student_id, module_id)
  select v_student_id, requested.module_id
  from unnest(coalesce(p_module_ids, array[]::text[])) requested(module_id)
  on conflict (student_id, module_id) do nothing;
  return jsonb_build_object('student_id', v_student_id, 'profile_id', p_profile_id);
end;
$$;

create or replace function public.admin_update_student_with_modules(
  p_student_id text,
  p_student jsonb,
  p_module_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student public.students%rowtype;
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede editar alumnos.';
  end if;
  select * into v_student
  from jsonb_populate_record(null::public.students, p_student);
  if nullif(trim(v_student.name), '') is null then
    raise exception using errcode = '22023', message = 'El nombre del alumno es obligatorio.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_module_ids, array[]::text[])) requested(module_id)
    where not exists (select 1 from public.modules m where m.id = requested.module_id)
  ) then
    raise exception using errcode = '23503', message = 'Uno o más módulos no existen.';
  end if;
  update public.students
  set student_number = v_student.student_number,
      name = trim(v_student.name),
      group_name = v_student.group_name,
      promo = v_student.promo
  where id::text = p_student_id;
  if not found then
    raise exception using errcode = '23503', message = 'Alumno no encontrado.';
  end if;
  delete from public.student_modules where student_id = p_student_id;
  insert into public.student_modules (student_id, module_id)
  select p_student_id, requested.module_id
  from unnest(coalesce(p_module_ids, array[]::text[])) requested(module_id)
  on conflict (student_id, module_id) do nothing;
end;
$$;

create or replace function public.admin_delete_student(p_student_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede eliminar alumnos.';
  end if;
  delete from public.practice_records where student_id = p_student_id;
  delete from public.student_modules where student_id = p_student_id;
  delete from public.student_profiles where student_id = p_student_id;
  delete from public.students where id::text = p_student_id;
end;
$$;

create or replace function public.admin_import_academic_backup(p_tables jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  table_name text;
  table_rows jsonb;
  inserted_count integer;
  result jsonb := '{}'::jsonb;
  import_order text[] := array[
    'modules', 'students', 'student_profiles', 'student_modules', 'teacher_modules',
    'practices', 'aircraft', 'videos', 'tlbs', 'defects', 'practice_records'
  ];
begin
  if private.current_profile_role() is distinct from 'admin' then
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
    execute format(
      'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
      table_name, table_name
    ) using table_rows;
    get diagnostics inserted_count = row_count;
    result := result || jsonb_build_object(table_name, inserted_count);
  end loop;
  return result;
end;
$$;

create or replace function public.save_practice_records(p_records jsonb)
returns setof public.practice_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record record;
  v_module_id text;
  v_role text := private.current_profile_role();
begin
  if v_role is null or v_role not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para registrar asistencia.';
  end if;
  if jsonb_typeof(p_records) is distinct from 'array'
    or jsonb_array_length(p_records) > 500 then
    raise exception using errcode = '22023', message = 'La lista de registros no es válida (máximo 500).';
  end if;

  for v_record in
    select * from jsonb_to_recordset(p_records) as item(
      student_id text,
      practice_id text,
      attendance text,
      evaluation text
    )
  loop
    select module_id into v_module_id
    from public.practices
    where id::text = v_record.practice_id;
    if not found then
      raise exception using errcode = '23503', message = 'Práctica no encontrada.';
    end if;
    if v_role = 'profesor' and not private.has_teacher_module(v_module_id) then
      raise exception using errcode = '42501', message = 'No tienes asignado el módulo de esta práctica.';
    end if;
    if not exists (
      select 1 from public.student_modules
      where student_id = v_record.student_id and module_id = v_module_id
    ) then
      raise exception using errcode = '23503', message = 'El alumno no está matriculado en el módulo de esta práctica.';
    end if;

    return query
      insert into public.practice_records (
        student_id, practice_id, attendance, evaluation, updated_by, updated_at
      ) values (
        v_record.student_id, v_record.practice_id, v_record.attendance,
        v_record.evaluation, auth.uid(), now()
      )
      on conflict (student_id, practice_id) do update
      set attendance = excluded.attendance,
          evaluation = excluded.evaluation,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      returning *;
  end loop;
end;
$$;

revoke all on function public.admin_replace_student_modules(text, text[]) from public, anon;
revoke all on function public.admin_replace_teacher_modules(uuid, text[]) from public, anon;
revoke all on function public.admin_link_student_profile(text, uuid) from public, anon;
revoke all on function public.admin_create_tlb_with_defect(text, text, text, date, text, text, text) from public, anon;
revoke all on function public.admin_delete_practice(text) from public, anon;
revoke all on function public.admin_set_profile_role(uuid, text) from public, anon;
revoke all on function public.admin_create_student_with_profile(jsonb, uuid, text[]) from public, anon;
revoke all on function public.admin_update_student_with_modules(text, jsonb, text[]) from public, anon;
revoke all on function public.admin_delete_student(text) from public, anon;
revoke all on function public.admin_import_academic_backup(jsonb) from public, anon;
revoke all on function public.save_practice_records(jsonb) from public, anon;
grant execute on function public.admin_replace_student_modules(text, text[]) to authenticated;
grant execute on function public.admin_replace_teacher_modules(uuid, text[]) to authenticated;
grant execute on function public.admin_link_student_profile(text, uuid) to authenticated;
grant execute on function public.admin_create_tlb_with_defect(text, text, text, date, text, text, text) to authenticated;
grant execute on function public.admin_delete_practice(text) to authenticated;
grant execute on function public.admin_set_profile_role(uuid, text) to authenticated;
grant execute on function public.admin_create_student_with_profile(jsonb, uuid, text[]) to authenticated, service_role;
grant execute on function public.admin_update_student_with_modules(text, jsonb, text[]) to authenticated;
grant execute on function public.admin_delete_student(text) to authenticated;
grant execute on function public.admin_import_academic_backup(jsonb) to authenticated;
grant execute on function public.save_practice_records(jsonb) to authenticated;

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['profiles', 'students', 'modules', 'practices', 'student_modules', 'teacher_modules', 'student_profiles', 'practice_records', 'tlbs', 'defects', 'aircraft', 'videos'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;