-- Estructura académica (fase 1). 2026-11-15
-- escuela → grado → módulos del grado (teoría/práctica, curso)
-- escuela → curso escolar → grupos (por grado y curso)
-- alumno → promoción; alumno → matrícula anual (grupo) → módulos que cursa (con nota)
--
-- Transición: las columnas de texto de `students` (class_name, group_name, promo)
-- y `student_modules` siguen siendo las que escribe la interfaz antigua. Unos
-- triggers las trasladan a la estructura nueva, de modo que nada se rompe.

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------
alter table public.schools
  add column if not exists grade_max numeric(6,2) not null default 100 check (grade_max > 0),
  add column if not exists pass_mark numeric(6,2) not null default 75 check (pass_mark >= 0);

create table if not exists public.degrees (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  code text not null check (length(trim(code)) between 1 and 20),
  name text,
  created_at timestamptz not null default now(),
  unique (school_id, code)
);

create table if not exists public.degree_modules (
  id uuid primary key default gen_random_uuid(),
  degree_id uuid not null references public.degrees(id) on delete cascade,
  module_id text not null references public.modules(id) on delete cascade,
  kind text not null check (kind in ('teoria', 'practica')),
  level smallint check (level between 1 and 9),
  hours integer check (hours >= 0),
  created_at timestamptz not null default now(),
  unique (degree_id, module_id, kind)
);
create index if not exists degree_modules_module_id_idx on public.degree_modules (module_id);

create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 20),
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on > starts_on),
  unique (school_id, name)
);
create unique index if not exists academic_years_one_current_idx
  on public.academic_years (school_id) where is_current;

create table if not exists public.cohorts (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  degree_id uuid references public.degrees(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 50),
  created_at timestamptz not null default now(),
  unique (school_id, name)
);
create index if not exists cohorts_degree_id_idx on public.cohorts (degree_id);

create table if not exists public.class_groups (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  degree_id uuid not null references public.degrees(id) on delete cascade,
  level smallint not null check (level between 1 and 9),
  name text not null check (length(trim(name)) between 1 and 20),
  created_at timestamptz not null default now(),
  unique (academic_year_id, degree_id, level, name)
);
create index if not exists class_groups_degree_id_idx on public.class_groups (degree_id);

alter table public.students
  add column if not exists cohort_id uuid references public.cohorts(id) on delete set null;
create index if not exists students_cohort_id_idx on public.students (cohort_id);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  group_id uuid not null references public.class_groups(id),
  level smallint not null check (level between 1 and 9),
  status text not null default 'cursando' check (status in ('cursando', 'promociona', 'finalizado', 'baja')),
  created_at timestamptz not null default now(),
  unique (student_id, academic_year_id)
);
create index if not exists enrollments_academic_year_id_idx on public.enrollments (academic_year_id);
create index if not exists enrollments_group_id_idx on public.enrollments (group_id);

create table if not exists public.module_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  degree_module_id uuid not null references public.degree_modules(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  group_id uuid not null references public.class_groups(id),
  is_carryover boolean not null default false,
  theory_grade numeric(6,2) check (theory_grade >= 0),
  practical_result text check (practical_result in ('apto', 'no_apto')),
  status text not null default 'cursando' check (status in ('cursando', 'aprobado', 'suspendido')),
  graded_by uuid references public.profiles(id) on delete set null,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (student_id, degree_module_id, academic_year_id)
);
create index if not exists module_enrollments_degree_module_id_idx on public.module_enrollments (degree_module_id);
create index if not exists module_enrollments_academic_year_id_idx on public.module_enrollments (academic_year_id);
create index if not exists module_enrollments_group_id_idx on public.module_enrollments (group_id);
create index if not exists module_enrollments_graded_by_idx on public.module_enrollments (graded_by);

-- ---------------------------------------------------------------------------
-- 2. Funciones auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.is_school_member(p_school_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_global_admin() or exists (
    select 1 from public.school_profiles sp
    where sp.school_id = p_school_id and sp.profile_id = (select auth.uid()));
$$;

create or replace function private.can_manage_school(p_school_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_global_admin() or (private.is_supervisor() and exists (
    select 1 from public.school_profiles sp
    where sp.school_id = p_school_id and sp.profile_id = (select auth.uid())));
$$;

create or replace function private.degree_school(p_degree_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select school_id from public.degrees where id = p_degree_id;
$$;

create or replace function private.year_school(p_year_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select school_id from public.academic_years where id = p_year_id;
$$;

-- Curso escolar que contiene una fecha (sep–jul): 2026-11-14 → 2026-27
create or replace function private.school_year_name(p_date date)
returns text language sql immutable set search_path = '' as $$
  select case when extract(month from p_date) >= 9
    then extract(year from p_date)::int || '-' || lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0')
    else (extract(year from p_date)::int - 1) || '-' || lpad((extract(year from p_date)::int % 100)::text, 2, '0') end;
$$;

-- Curso escolar actual de la escuela (lo crea si no existe)
create or replace function private.ensure_current_year(p_school_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_start int := case when extract(month from current_date) >= 9
    then extract(year from current_date)::int else extract(year from current_date)::int - 1 end;
begin
  select id into v_id from public.academic_years where school_id = p_school_id and is_current;
  if v_id is not null then return v_id; end if;
  insert into public.academic_years (school_id, name, starts_on, ends_on, is_current)
  values (p_school_id, private.school_year_name(current_date), make_date(v_start, 9, 1), make_date(v_start + 1, 7, 31), true)
  on conflict (school_id, name) do update set is_current = true
  returning id into v_id;
  return v_id;
end;
$$;

-- Grado por defecto de la escuela (el más antiguo; crea «B1.1» si no hay)
create or replace function private.ensure_default_degree(p_school_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.degrees where school_id = p_school_id order by created_at, code limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.degrees (school_id, code, name) values (p_school_id, 'B1.1', 'Técnico de mantenimiento B1.1')
  on conflict (school_id, code) do nothing returning id into v_id;
  if v_id is null then select id into v_id from public.degrees where school_id = p_school_id and code = 'B1.1'; end if;
  return v_id;
end;
$$;

-- «2º» → 2 ; «2º2ºA» → 2 ; «1» → 1
create or replace function private.parse_level(p_value text)
returns smallint language sql immutable set search_path = '' as $$
  select nullif(substring(coalesce(p_value, '') from '^\s*([1-9])'), '')::smallint;
$$;

-- «2º2ºA» → «A» ; «1ºB» → «B» ; «b» → «B»
create or replace function private.parse_group_letter(p_value text)
returns text language sql immutable set search_path = '' as $$
  select nullif(upper(trim(regexp_replace(coalesce(p_value, ''), '^(\s*[0-9]+\s*[ºo°ª]?\s*)+', ''))), '');
$$;

-- Traslada class_name/group_name/promo de un alumno a promoción y matrícula del curso actual
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
  if v_level is null then return; end if;  -- sin curso no hay matrícula que crear
  v_letter := coalesce(private.parse_group_letter(s.group_name), 'A');

  v_year := private.ensure_current_year(s.school_id);
  v_degree := private.ensure_default_degree(s.school_id);
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

-- Traslada un módulo de student_modules a module_enrollments del curso actual
create or replace function private.sync_student_module(p_student_id uuid, p_module_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  select en.academic_year_id, en.group_id, en.level, g.degree_id into e
  from public.enrollments en
  join public.academic_years y on y.id = en.academic_year_id and y.is_current
  join public.class_groups g on g.id = en.group_id
  where en.student_id = p_student_id;
  if e.group_id is null then return; end if;

  if not exists (select 1 from public.degree_modules where degree_id = e.degree_id and module_id = p_module_id) then
    insert into public.degree_modules (degree_id, module_id, kind, level)
    values (e.degree_id, p_module_id, 'teoria', e.level) on conflict do nothing;
  end if;

  insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
  select p_student_id, dm.id, e.academic_year_id, e.group_id
  from public.degree_modules dm where dm.degree_id = e.degree_id and dm.module_id = p_module_id
  on conflict (student_id, degree_module_id, academic_year_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Triggers de transición
-- ---------------------------------------------------------------------------
create or replace function private.trg_students_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_student_enrollment(new.id);
  if tg_op = 'UPDATE' and new.school_id is distinct from old.school_id then
    -- cambio de escuela: la matrícula antigua deja de valer
    delete from public.enrollments en using public.academic_years y
    where en.student_id = new.id and y.id = en.academic_year_id and y.school_id is distinct from new.school_id and y.is_current;
  end if;
  return null;
end;
$$;

drop trigger if exists students_sync_enrollment on public.students;
create trigger students_sync_enrollment
  after insert or update of class_name, group_name, promo, school_id on public.students
  for each row execute function private.trg_students_sync();

create or replace function private.trg_student_modules_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.sync_student_module(new.student_id::uuid, new.module_id);
  else
    -- solo se borra si aún no tiene nota
    delete from public.module_enrollments me
    using public.degree_modules dm, public.academic_years y
    where me.student_id = old.student_id::uuid and dm.id = me.degree_module_id and dm.module_id = old.module_id
      and y.id = me.academic_year_id and y.is_current
      and me.theory_grade is null and me.practical_result is null;
  end if;
  return null;
end;
$$;

drop trigger if exists student_modules_sync on public.student_modules;
create trigger student_modules_sync
  after insert or delete on public.student_modules
  for each row execute function private.trg_student_modules_sync();

-- Al renombrar un grupo o promoción, el texto antiguo de los alumnos se actualiza
create or replace function private.trg_structure_rename()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'class_groups' then
    update public.students st set
      class_name = new.level || 'º',
      group_name = new.level || 'º' || new.name
    from public.enrollments en
    where en.group_id = new.id and en.student_id = st.id
      and exists (select 1 from public.academic_years y where y.id = new.academic_year_id and y.is_current);
  elsif tg_table_name = 'cohorts' then
    update public.students set promo = new.name where cohort_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists class_groups_rename on public.class_groups;
create trigger class_groups_rename after update of name, level on public.class_groups
  for each row when (old.name is distinct from new.name or old.level is distinct from new.level)
  execute function private.trg_structure_rename();

drop trigger if exists cohorts_rename on public.cohorts;
create trigger cohorts_rename after update of name on public.cohorts
  for each row when (old.name is distinct from new.name)
  execute function private.trg_structure_rename();

-- Funciones internas: fuera de la API pública
revoke all on function private.is_school_member(uuid), private.can_manage_school(uuid),
  private.degree_school(uuid), private.year_school(uuid) from public, anon;
grant execute on function private.is_school_member(uuid), private.can_manage_school(uuid),
  private.degree_school(uuid), private.year_school(uuid) to authenticated;
revoke all on function private.ensure_current_year(uuid), private.ensure_default_degree(uuid),
  private.sync_student_enrollment(uuid), private.sync_student_module(uuid, text),
  private.trg_students_sync(), private.trg_student_modules_sync(), private.trg_structure_rename()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.degrees enable row level security;
alter table public.degree_modules enable row level security;
alter table public.academic_years enable row level security;
alter table public.cohorts enable row level security;
alter table public.class_groups enable row level security;
alter table public.enrollments enable row level security;
alter table public.module_enrollments enable row level security;

-- Estructura: la lee cualquiera de la escuela; la gestiona admin o supervisor de la escuela
create policy degrees_read on public.degrees for select to authenticated
  using (private.is_school_member(school_id));
create policy degrees_write on public.degrees for all to authenticated
  using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));

create policy degree_modules_read on public.degree_modules for select to authenticated
  using (private.is_school_member(private.degree_school(degree_id)));
create policy degree_modules_write on public.degree_modules for all to authenticated
  using (private.can_manage_school(private.degree_school(degree_id)))
  with check (private.can_manage_school(private.degree_school(degree_id)));

create policy academic_years_read on public.academic_years for select to authenticated
  using (private.is_school_member(school_id));
create policy academic_years_write on public.academic_years for all to authenticated
  using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));

create policy cohorts_read on public.cohorts for select to authenticated
  using (private.is_school_member(school_id));
create policy cohorts_write on public.cohorts for all to authenticated
  using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));

create policy class_groups_read on public.class_groups for select to authenticated
  using (private.is_school_member(private.year_school(academic_year_id)));
create policy class_groups_write on public.class_groups for all to authenticated
  using (private.can_manage_school(private.year_school(academic_year_id)))
  with check (private.can_manage_school(private.year_school(academic_year_id)));

-- Matrículas: admin/supervisor de la escuela, el propio alumno y sus profesores
create policy enrollments_read on public.enrollments for select to authenticated
  using (private.can_manage_school(private.year_school(academic_year_id))
    or private.is_student_profile(student_id::text)
    or private.is_teacher_for_student(student_id::text));
create policy enrollments_write on public.enrollments for all to authenticated
  using (private.can_manage_school(private.year_school(academic_year_id)))
  with check (private.can_manage_school(private.year_school(academic_year_id)));

create policy module_enrollments_read on public.module_enrollments for select to authenticated
  using (private.can_manage_school(private.year_school(academic_year_id))
    or private.is_student_profile(student_id::text)
    or private.is_teacher_for_student(student_id::text));
create policy module_enrollments_write on public.module_enrollments for all to authenticated
  using (private.can_manage_school(private.year_school(academic_year_id)))
  with check (private.can_manage_school(private.year_school(academic_year_id)));

grant select, insert, update, delete on public.degrees, public.degree_modules, public.academic_years,
  public.cohorts, public.class_groups, public.enrollments, public.module_enrollments to authenticated;
revoke all on public.degrees, public.degree_modules, public.academic_years,
  public.cohorts, public.class_groups, public.enrollments, public.module_enrollments from anon;

-- Tiempo real (la interfaz se refresca sola como en el resto de tablas)
alter publication supabase_realtime add table public.degrees, public.degree_modules, public.academic_years,
  public.cohorts, public.class_groups, public.enrollments, public.module_enrollments;

-- ---------------------------------------------------------------------------
-- 5. Migración de los datos actuales
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  -- grado y curso escolar para cada escuela
  for r in select id from public.schools loop
    perform private.ensure_default_degree(r.id);
    perform private.ensure_current_year(r.id);
  end loop;

  -- módulos del grado: los que ya se usan en la escuela (teoría), más práctica si hay prácticas o TLB.
  -- El curso se deduce del curso más frecuente de los alumnos que lo cursan.
  insert into public.degree_modules (degree_id, module_id, kind, level)
  select private.ensure_default_degree(u.school_id), u.module_id, 'teoria',
    (select mode() within group (order by private.parse_level(st.class_name))
       from public.student_modules sm join public.students st on st.id = sm.student_id
       where sm.module_id = u.module_id and st.school_id = u.school_id)
  from (
    select distinct st.school_id, sm.module_id from public.student_modules sm join public.students st on st.id = sm.student_id
    union select distinct sp.school_id, tm.module_id from public.teacher_modules tm join public.school_profiles sp on sp.profile_id = tm.profile_id
    union select distinct school_id, module_id from public.practices where school_id is not null
  ) u where u.school_id is not null
  on conflict do nothing;

  insert into public.degree_modules (degree_id, module_id, kind, level)
  select dm.degree_id, dm.module_id, 'practica', dm.level
  from public.degree_modules dm join public.degrees d on d.id = dm.degree_id
  where dm.kind = 'teoria' and (
    exists (select 1 from public.practices p where p.module_id = dm.module_id and p.school_id = d.school_id)
    or exists (select 1 from public.tlbs t join public.practices p on p.id = t.practice_id
               where t.module_id = dm.module_id and p.school_id = d.school_id))
  on conflict do nothing;

  -- promociones, grupos y matrículas a partir del texto de cada alumno
  for r in select id from public.students loop
    perform private.sync_student_enrollment(r.id);
  end loop;

  -- módulos que cursa cada alumno
  for r in select student_id, module_id from public.student_modules loop
    perform private.sync_student_module(r.student_id::uuid, r.module_id);
  end loop;
end $$;
