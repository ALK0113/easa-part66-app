-- Fase 3: horario. 2026-11-15
-- Plantilla semanal (schedule_slots) que genera las clases concretas del curso
-- (class_sessions). Cada clase se puede cancelar o mover sin tocar la plantilla,
-- y se pueden crear clases sueltas. La asistencia se pasa por clase.

create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  teaching_assignment_id uuid not null references public.teaching_assignments(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),  -- 1 = lunes
  start_time time not null,
  end_time time not null,
  room text check (length(room) <= 40),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists schedule_slots_teaching_assignment_id_idx on public.schedule_slots (teaching_assignment_id);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  teaching_assignment_id uuid not null references public.teaching_assignments(id) on delete cascade,
  slot_id uuid references public.schedule_slots(id) on delete set null,
  date date not null,
  start_time time not null,
  end_time time not null,
  room text check (length(room) <= 40),
  status text not null default 'programada' check (status in ('programada', 'cancelada')),
  practice_id text references public.practices(id) on delete set null,
  note text check (length(note) <= 300),
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (slot_id, date)
);
create index if not exists class_sessions_teaching_assignment_id_idx on public.class_sessions (teaching_assignment_id);
create index if not exists class_sessions_date_idx on public.class_sessions (date);
create index if not exists class_sessions_practice_id_idx on public.class_sessions (practice_id);

create table if not exists public.session_attendance (
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null check (status in ('P', 'L', 'A')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (session_id, student_id)
);
create index if not exists session_attendance_student_id_idx on public.session_attendance (student_id);
create index if not exists session_attendance_updated_by_idx on public.session_attendance (updated_by);

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------
create or replace function private.assignment_school(p_assignment_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select private.group_school(group_id) from public.teaching_assignments where id = p_assignment_id;
$$;

create or replace function private.is_assignment_teacher(p_assignment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.teaching_assignments where id = p_assignment_id and profile_id = (select auth.uid()));
$$;

create or replace function private.session_assignment(p_session_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select teaching_assignment_id from public.class_sessions where id = p_session_id;
$$;

-- Alumnos de una clase: cursan ese módulo con ese grupo en ese curso escolar
create or replace function private.session_students(p_session_id uuid)
returns table (student_id uuid) language sql stable security definer set search_path = '' as $$
  select distinct me.student_id
  from public.class_sessions cs
  join public.teaching_assignments ta on ta.id = cs.teaching_assignment_id
  join public.degree_modules dta on dta.id = ta.degree_module_id
  join public.class_groups g on g.id = ta.group_id
  join public.module_enrollments me on me.group_id = ta.group_id and me.academic_year_id = g.academic_year_id
  join public.degree_modules dme on dme.id = me.degree_module_id and dme.module_id = dta.module_id
  where cs.id = p_session_id;
$$;

revoke all on function private.assignment_school(uuid), private.is_assignment_teacher(uuid),
  private.session_assignment(uuid), private.session_students(uuid) from public, anon;
grant execute on function private.assignment_school(uuid), private.is_assignment_teacher(uuid),
  private.session_assignment(uuid), private.session_students(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Generación de clases a partir de la plantilla (desde hoy hasta fin de curso)
-- ---------------------------------------------------------------------------
create or replace function private.generate_slot_sessions(p_slot_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s record;
begin
  select sl.*, y.starts_on, y.ends_on into s
  from public.schedule_slots sl
  join public.teaching_assignments ta on ta.id = sl.teaching_assignment_id
  join public.class_groups g on g.id = ta.group_id
  join public.academic_years y on y.id = g.academic_year_id
  where sl.id = p_slot_id;
  if s.id is null then return; end if;

  -- las clases futuras sin asistencia ni cambios se rehacen; el pasado no se toca
  delete from public.class_sessions cs
  where cs.slot_id = p_slot_id and cs.date >= current_date and cs.status = 'programada' and cs.note is null and cs.practice_id is null
    and not exists (select 1 from public.session_attendance sa where sa.session_id = cs.id);

  insert into public.class_sessions (teaching_assignment_id, slot_id, date, start_time, end_time, room)
  select s.teaching_assignment_id, s.id, d::date, s.start_time, s.end_time, s.room
  from generate_series(greatest(current_date, s.starts_on), s.ends_on, interval '1 day') d
  where extract(isodow from d) = s.weekday
  on conflict (slot_id, date) do nothing;
end;
$$;

create or replace function private.trg_schedule_slots_sessions()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.class_sessions cs
    where cs.slot_id = old.id and cs.date >= current_date
      and not exists (select 1 from public.session_attendance sa where sa.session_id = cs.id);
    return old;
  end if;
  perform private.generate_slot_sessions(new.id);
  return null;
end;
$$;

drop trigger if exists schedule_slots_generate on public.schedule_slots;
create trigger schedule_slots_generate after insert or update on public.schedule_slots
  for each row execute function private.trg_schedule_slots_sessions();
drop trigger if exists schedule_slots_cleanup on public.schedule_slots;
create trigger schedule_slots_cleanup before delete on public.schedule_slots
  for each row execute function private.trg_schedule_slots_sessions();

revoke all on function private.generate_slot_sessions(uuid), private.trg_schedule_slots_sessions() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.schedule_slots enable row level security;
alter table public.class_sessions enable row level security;
alter table public.session_attendance enable row level security;

-- Plantilla: la ve la escuela; la gestiona administración
create policy schedule_slots_read on public.schedule_slots for select to authenticated
  using (private.is_school_member(private.assignment_school(teaching_assignment_id)));
create policy schedule_slots_insert on public.schedule_slots for insert to authenticated
  with check (private.can_manage_school(private.assignment_school(teaching_assignment_id)));
create policy schedule_slots_update on public.schedule_slots for update to authenticated
  using (private.can_manage_school(private.assignment_school(teaching_assignment_id)))
  with check (private.can_manage_school(private.assignment_school(teaching_assignment_id)));
create policy schedule_slots_delete on public.schedule_slots for delete to authenticated
  using (private.can_manage_school(private.assignment_school(teaching_assignment_id)));

-- Clases: las ve la escuela; administración y el profesor de la clase pueden cambiarlas
create policy class_sessions_read on public.class_sessions for select to authenticated
  using (private.is_school_member(private.assignment_school(teaching_assignment_id)));
create policy class_sessions_insert on public.class_sessions for insert to authenticated
  with check (slot_id is null and (private.can_manage_school(private.assignment_school(teaching_assignment_id))
    or private.is_assignment_teacher(teaching_assignment_id)));
create policy class_sessions_update on public.class_sessions for update to authenticated
  using (private.can_manage_school(private.assignment_school(teaching_assignment_id)) or private.is_assignment_teacher(teaching_assignment_id))
  with check (private.can_manage_school(private.assignment_school(teaching_assignment_id)) or private.is_assignment_teacher(teaching_assignment_id));
create policy class_sessions_delete on public.class_sessions for delete to authenticated
  using (slot_id is null and (private.can_manage_school(private.assignment_school(teaching_assignment_id))
    or private.is_assignment_teacher(teaching_assignment_id)));

-- Asistencia: la ven administración, el profesor de la clase y el propio alumno.
-- Se escribe con set_session_attendance().
create policy session_attendance_read on public.session_attendance for select to authenticated
  using (private.is_student_profile(student_id::text)
    or private.is_assignment_teacher(private.session_assignment(session_id))
    or private.can_manage_school(private.assignment_school(private.session_assignment(session_id))));

grant select, insert, update, delete on public.schedule_slots, public.class_sessions to authenticated;
grant select on public.session_attendance to authenticated;
revoke all on public.schedule_slots, public.class_sessions, public.session_attendance from anon;
alter publication supabase_realtime add table public.schedule_slots, public.class_sessions, public.session_attendance;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------
-- Lista de la clase con su asistencia (para pasar lista)
create or replace function public.session_roster(p_session_id uuid)
returns table (student_id uuid, name text, student_number integer, status text)
language plpgsql stable security definer set search_path = '' as $$
declare v_assignment uuid := private.session_assignment(p_session_id);
begin
  if v_assignment is null then raise exception using errcode = 'P0002', message = 'Clase no encontrada.'; end if;
  if not (private.is_assignment_teacher(v_assignment) or private.can_manage_school(private.assignment_school(v_assignment))) then
    raise exception using errcode = '42501', message = 'Solo el profesor de la clase puede ver la lista.';
  end if;
  return query
    select st.id, st.name, st.student_number, sa.status
    from private.session_students(p_session_id) r
    join public.students st on st.id = r.student_id
    left join public.session_attendance sa on sa.session_id = p_session_id and sa.student_id = st.id
    order by st.name;
end;
$$;

-- Marca la asistencia de uno o varios alumnos (null borra la marca)
create or replace function public.set_session_attendance(p_session_id uuid, p_student_ids uuid[], p_status text)
returns integer language plpgsql security definer set search_path = '' as $$
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

  if p_status is null then
    delete from public.session_attendance where session_id = p_session_id and student_id = any(p_student_ids);
  else
    insert into public.session_attendance (session_id, student_id, status, updated_by, updated_at)
    select p_session_id, x.id, p_status, auth.uid(), now() from unnest(p_student_ids) x(id)
    on conflict (session_id, student_id) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.session_roster(uuid), public.set_session_attendance(uuid, uuid[], text) from public, anon;
grant execute on function public.session_roster(uuid), public.set_session_attendance(uuid, uuid[], text) to authenticated;
