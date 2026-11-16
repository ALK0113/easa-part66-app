-- Matrícula «Grupo + excepciones».
-- · Estar en un grupo (enrollments) = cursar todos los módulos de su nivel con ese grupo (automático, por trigger).
-- · Excepciones en module_enrollments.status: convalidado, exento, baja (no cursa). La fila se conserva.
-- · Módulos de otro curso o grado: una fila con otro grupo. Matrícula parcial: sin grupo principal.
-- · Fechas: joined_on / left_on limitan las listas de sesión (altas tardías, bajas, cambios de grupo).
-- · Solo administración y supervisión cambian la matrícula.

-- 1. Estados y fechas
alter table public.module_enrollments drop constraint if exists module_enrollments_status_check;
alter table public.module_enrollments add constraint module_enrollments_status_check
  check (status in ('cursando', 'aprobado', 'suspendido', 'convalidado', 'exento', 'baja'));
alter table public.module_enrollments add column if not exists joined_on date;
alter table public.module_enrollments add column if not exists left_on date;
alter table public.enrollments add column if not exists left_on date;

-- ¿La fila cuenta como «cursa»?
create or replace function private.me_active(p_status text)
returns boolean language sql immutable set search_path to '' as $$
  select p_status not in ('convalidado', 'exento', 'baja');
$$;

-- 2. Listas: solo quien cursa, entre sus fechas; se conserva a quien ya tiene asistencia en la sesión
create or replace function private.session_students(p_session_id uuid)
returns table(student_id uuid)
language sql stable security definer set search_path to '' as $$
  select me.student_id
  from public.class_sessions cs
  join public.teaching_assignments ta on ta.id = cs.teaching_assignment_id
  join public.degree_modules dta on dta.id = ta.degree_module_id
  join public.class_groups g on g.id = ta.group_id
  join public.module_enrollments me on me.group_id = ta.group_id and me.academic_year_id = g.academic_year_id
  join public.degree_modules dme on dme.id = me.degree_module_id and dme.module_id = dta.module_id
  where cs.id = p_session_id and not cs.recovery
    and private.me_active(me.status)
    and (me.joined_on is null or me.joined_on <= cs.date)
    and (me.left_on is null or me.left_on >= cs.date)
  union
  select rs.student_id
  from public.class_sessions cs
  join public.session_recovery_students rs on rs.session_id = cs.id
  where cs.id = p_session_id and cs.recovery
  union
  select sa.student_id from public.session_attendance sa where sa.session_id = p_session_id;
$$;

create or replace function private.refresh_student_module(p_student_id uuid, p_module_id text)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if exists (
    select 1 from public.module_enrollments me
    join public.degree_modules dm on dm.id = me.degree_module_id
    join public.academic_years y on y.id = me.academic_year_id and y.is_current
    where me.student_id = p_student_id and dm.module_id = p_module_id and private.me_active(me.status)
  ) then
    insert into public.student_modules (student_id, module_id) values (p_student_id, p_module_id) on conflict do nothing;
  else
    delete from public.student_modules where student_id = p_student_id and module_id = p_module_id;
  end if;
end;
$$;

create or replace trigger module_enrollments_sync_status
  after update of status, degree_module_id on public.module_enrollments
  for each row execute function private.trg_module_enrollments_sync();

-- Lista de una clase (grupo + módulo) para dirección: solo quien cursa
do $$
declare def text := pg_get_functiondef('public.class_students(uuid,uuid)'::regprocedure);
begin
  if position('and private.me_active(me.status)' in def) = 0 then
    execute replace(def, 'where g.id = p_group_id', 'where g.id = p_group_id and private.me_active(me.status)');
  end if;
end $$;

-- El cálculo automático del estado por nota no pisa convalidado / exento / baja mientras no haya nota
do $$
declare def text := pg_get_functiondef('private.trg_module_enrollments_grade()'::regprocedure);
begin
  if position('''convalidado'', ''exento'', ''baja'') then new.status' in def) = 0 then
    execute replace(def, E'new.status := case\n', E'new.status := case\n    when new.theory_grade is null and new.practical_result is null and new.status in (''convalidado'', ''exento'', ''baja'') then new.status\n');
  end if;
end $$;

-- 3. Solo dirección cambia la matrícula de una clase
create or replace function private.assert_can_edit_class(p_group_id uuid, p_degree_module_id uuid)
returns void language plpgsql stable security definer set search_path to '' as $$
begin
  if not exists (
    select 1 from public.class_groups g
    join public.degree_modules dm on dm.degree_id = g.degree_id
    where g.id = p_group_id and dm.id = p_degree_module_id
  ) then
    raise exception using errcode = 'P0002', message = 'Ese módulo no es del grado del grupo.';
  end if;
  if not private.can_manage_school(private.group_school(p_group_id)) then
    raise exception using errcode = '42501', message = 'Solo administración y supervisión cambian la matrícula.';
  end if;
end;
$$;

-- 4. Regla: grupo principal → módulos de su nivel (sin los ya aprobados o convalidados en otros cursos)
create or replace function private.trg_enrollments_auto_modules()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_group record;
  v_date date := nullif(current_setting('app.enroll_date', true), '')::date;
begin
  if new.status is distinct from 'cursando' then return null; end if;
  select g.id, g.level, g.degree_id into v_group from public.class_groups g where g.id = new.group_id;

  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    -- Los módulos del nivel que cursaba con el grupo anterior pasan al grupo nuevo
    update public.module_enrollments me
    set group_id = new.group_id,
        joined_on = case when v_date is null then me.joined_on else greatest(coalesce(me.joined_on, v_date), v_date) end
    from public.degree_modules dm
    where dm.id = me.degree_module_id and dm.level = v_group.level and dm.degree_id = v_group.degree_id
      and me.student_id = new.student_id and me.academic_year_id = new.academic_year_id
      and me.group_id = old.group_id and not me.is_carryover;
    -- Si cambia de nivel, los del nivel anterior sin nota se quitan
    delete from public.module_enrollments me
    using public.degree_modules dm
    where dm.id = me.degree_module_id and dm.level is distinct from v_group.level
      and me.student_id = new.student_id and me.academic_year_id = new.academic_year_id
      and me.group_id = old.group_id and not me.is_carryover
      and me.theory_grade is null and me.practical_result is null;
  end if;

  insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id, joined_on)
  select new.student_id, dm.id, new.academic_year_id, new.group_id, v_date
  from public.degree_modules dm
  where dm.degree_id = v_group.degree_id and dm.level = v_group.level
    and not exists (select 1 from public.module_enrollments p
                    where p.student_id = new.student_id and p.degree_module_id = dm.id
                      and p.academic_year_id <> new.academic_year_id and p.status in ('aprobado', 'convalidado', 'exento'))
  on conflict (student_id, degree_module_id, academic_year_id) do nothing;
  return null;
end;
$$;

create or replace trigger enrollments_auto_modules
  after insert or update of group_id, status on public.enrollments
  for each row execute function private.trg_enrollments_auto_modules();

-- Un módulo nuevo en un nivel: lo cursan los alumnos de los grupos de ese nivel del curso actual
create or replace function private.trg_degree_modules_auto_enroll()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
  select e.student_id, new.id, e.academic_year_id, e.group_id
  from public.enrollments e
  join public.class_groups g on g.id = e.group_id
  join public.academic_years y on y.id = e.academic_year_id and y.is_current
  where g.degree_id = new.degree_id and g.level = new.level and e.status = 'cursando'
  on conflict (student_id, degree_module_id, academic_year_id) do nothing;
  return null;
end;
$$;

create or replace trigger degree_modules_auto_enroll
  after insert on public.degree_modules
  for each row execute function private.trg_degree_modules_auto_enroll();

-- 5. RPC de matrícula (solo dirección)
create or replace function private.assert_manage_student(p_student_id uuid)
returns uuid language plpgsql stable security definer set search_path to '' as $$
declare v_school uuid;
begin
  select school_id into v_school from public.students where id = p_student_id;
  if v_school is null then raise exception using errcode = 'P0002', message = 'Alumno no encontrado.'; end if;
  if not private.can_manage_school(v_school) then
    raise exception using errcode = '42501', message = 'Solo administración y supervisión cambian la matrícula.';
  end if;
  return v_school;
end;
$$;

-- Alta en un grupo o cambio de grupo (con fecha para altas tardías y cambios a mitad de curso)
create or replace function public.enroll_student(p_student_id uuid, p_group_id uuid, p_joined_on date default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_school uuid := private.assert_manage_student(p_student_id);
  v_group record;
begin
  select g.id, g.level, g.academic_year_id, y.school_id into v_group
  from public.class_groups g join public.academic_years y on y.id = g.academic_year_id where g.id = p_group_id;
  if v_group.id is null then raise exception using errcode = 'P0002', message = 'Grupo no encontrado.'; end if;
  if v_group.school_id is distinct from v_school then
    raise exception using errcode = '42501', message = 'El grupo es de otro centro.';
  end if;
  perform set_config('app.enroll_date', coalesce(p_joined_on::text, ''), true);
  insert into public.enrollments (student_id, academic_year_id, group_id, level)
  values (p_student_id, v_group.academic_year_id, v_group.id, v_group.level)
  on conflict (student_id, academic_year_id) do update
    set group_id = excluded.group_id, level = excluded.level, status = 'cursando', left_on = null;
  -- Si volvía de una baja, sus módulos vuelven a contar
  update public.module_enrollments set left_on = null
  where student_id = p_student_id and academic_year_id = v_group.academic_year_id and left_on is not null;
  perform set_config('app.enroll_date', '', true);
end;
$$;

-- Un módulo concreto: cursa (con un grupo), convalidado, exento o no cursa
create or replace function public.enrollment_set_module(p_student_id uuid, p_degree_module_id uuid, p_mode text, p_group_id uuid default null)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_school uuid := private.assert_manage_student(p_student_id);
  v_year uuid;
  v_dm record;
  v_home record;
  v_row record;
  v_group uuid;
begin
  if p_mode not in ('cursa', 'convalidado', 'exento', 'no_cursa') then
    raise exception using errcode = '22023', message = 'Opción no válida.';
  end if;
  select id into v_year from public.academic_years where school_id = v_school and is_current;
  if v_year is null then raise exception using errcode = 'P0002', message = 'No hay curso escolar actual.'; end if;
  select dm.id, dm.level, dm.degree_id into v_dm
  from public.degree_modules dm join public.degrees d on d.id = dm.degree_id
  where dm.id = p_degree_module_id and d.school_id = v_school;
  if v_dm.id is null then raise exception using errcode = 'P0002', message = 'Módulo no encontrado en esta escuela.'; end if;
  select e.group_id, g.level, g.degree_id into v_home
  from public.enrollments e join public.class_groups g on g.id = e.group_id
  where e.student_id = p_student_id and e.academic_year_id = v_year;
  select * into v_row from public.module_enrollments
  where student_id = p_student_id and degree_module_id = p_degree_module_id and academic_year_id = v_year;

  -- Grupo con el que cursa: el indicado, el que ya tenía o su grupo si el módulo es de su curso
  v_group := coalesce(p_group_id, v_row.group_id,
    case when v_home.group_id is not null and v_home.level = v_dm.level and v_home.degree_id = v_dm.degree_id then v_home.group_id end);
  if p_mode <> 'no_cursa' then
    if v_group is null then raise exception using errcode = '22023', message = 'Elige el grupo con el que cursa el módulo.'; end if;
    if not exists (select 1 from public.class_groups g where g.id = v_group and g.academic_year_id = v_year and g.degree_id = v_dm.degree_id) then
      raise exception using errcode = '22023', message = 'Ese grupo no imparte el módulo este curso.';
    end if;
  end if;

  if p_mode = 'no_cursa' then
    if v_row.id is null then return; end if;
    if v_row.theory_grade is not null or v_row.practical_result is not null then
      raise exception using errcode = '22023', message = 'Tiene nota en este módulo: no se puede quitar.';
    end if;
    -- Los de su curso se marcan «baja» (para que la regla no los vuelva a poner); los demás se quitan
    if v_home.group_id is not null and v_home.level = v_dm.level and v_home.degree_id = v_dm.degree_id then
      update public.module_enrollments set status = 'baja' where id = v_row.id;
    else
      delete from public.module_enrollments where id = v_row.id;
    end if;
    return;
  end if;

  insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id, status)
  values (p_student_id, p_degree_module_id, v_year, v_group,
          case p_mode when 'cursa' then 'cursando' else p_mode end)
  on conflict (student_id, degree_module_id, academic_year_id) do update
    set group_id = excluded.group_id,
        status = case when p_mode = 'cursa' and public.module_enrollments.status in ('aprobado', 'suspendido') then public.module_enrollments.status else excluded.status end,
        left_on = null;
end;
$$;

-- Baja del centro este curso (se conserva todo; deja de salir en las listas desde esa fecha)
create or replace function public.enrollment_drop(p_student_id uuid, p_left_on date default current_date)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_school uuid := private.assert_manage_student(p_student_id);
  v_year uuid;
begin
  select id into v_year from public.academic_years where school_id = v_school and is_current;
  update public.enrollments set status = 'baja', left_on = p_left_on where student_id = p_student_id and academic_year_id = v_year;
  update public.module_enrollments set left_on = p_left_on
  where student_id = p_student_id and academic_year_id = v_year and left_on is null;
end;
$$;

revoke all on function public.enroll_student(uuid, uuid, date) from public, anon;
revoke all on function public.enrollment_set_module(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.enrollment_drop(uuid, date) from public, anon;
grant execute on function public.enroll_student(uuid, uuid, date) to authenticated;
grant execute on function public.enrollment_set_module(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.enrollment_drop(uuid, date) to authenticated;

-- 6. Una sola vez: completar los módulos del nivel a quien ya está en un grupo del curso actual
insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
select e.student_id, dm.id, e.academic_year_id, e.group_id
from public.enrollments e
join public.academic_years y on y.id = e.academic_year_id and y.is_current
join public.class_groups g on g.id = e.group_id
join public.degree_modules dm on dm.degree_id = g.degree_id and dm.level = g.level
where e.status = 'cursando'
  and not exists (select 1 from public.module_enrollments p
                  where p.student_id = e.student_id and p.degree_module_id = dm.id
                    and p.academic_year_id <> e.academic_year_id and p.status in ('aprobado', 'convalidado', 'exento'))
on conflict (student_id, degree_module_id, academic_year_id) do nothing;
