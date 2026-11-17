-- Aulas de la escuela, clases movidas que no se pierden al regenerar la plantilla y detección de choques
-- (mismo profesor, misma aula o mismo grupo a la misma hora). Los choques solo avisan: no impiden guardar.

begin;

-- 1. Aulas
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create unique index if not exists rooms_school_name_key on public.rooms (school_id, lower(name));
alter table public.rooms enable row level security;
create policy rooms_read on public.rooms for select to authenticated using (private.is_school_member(school_id));
create policy rooms_write on public.rooms for all to authenticated
  using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));
grant select, insert, update, delete on public.rooms to authenticated;

alter table public.schedule_slots add column if not exists room_id uuid references public.rooms(id) on delete set null;
alter table public.class_sessions add column if not exists room_id uuid references public.rooms(id) on delete set null;
create index if not exists schedule_slots_room_idx on public.schedule_slots (room_id) where room_id is not null;
create index if not exists class_sessions_room_idx on public.class_sessions (room_id, date) where room_id is not null;

-- Aulas a partir de los textos actuales (sin regenerar las clases de la plantilla)
insert into public.rooms (school_id, name)
select distinct on (x.school_id, lower(x.name)) x.school_id, x.name
from (
  select private.assignment_school(teaching_assignment_id) as school_id, trim(room) as name from public.schedule_slots where nullif(trim(room), '') is not null
  union all
  select private.assignment_school(teaching_assignment_id), trim(room) from public.class_sessions where nullif(trim(room), '') is not null
) x
where x.school_id is not null
order by x.school_id, lower(x.name), x.name
on conflict do nothing;

alter table public.schedule_slots disable trigger schedule_slots_generate;
update public.schedule_slots sl set room_id = r.id, room = r.name
from public.rooms r
where r.school_id = private.assignment_school(sl.teaching_assignment_id) and lower(r.name) = lower(trim(sl.room));
alter table public.schedule_slots enable trigger schedule_slots_generate;

update public.class_sessions cs set room_id = r.id, room = r.name
from public.rooms r
where r.school_id = private.assignment_school(cs.teaching_assignment_id) and lower(r.name) = lower(trim(cs.room));

-- 2. El texto «room» sigue al aula elegida; si solo llega texto (importación, formularios antiguos), se enlaza o se crea el aula
create or replace function private.trg_sync_room()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_school uuid := private.assignment_school(new.teaching_assignment_id);
  v_name text;
begin
  if tg_op = 'UPDATE' and new.room_id is not distinct from old.room_id and new.room is not distinct from old.room
     and new.teaching_assignment_id is not distinct from old.teaching_assignment_id then
    return new;
  end if;
  -- Se quita el aula
  if tg_op = 'UPDATE' and old.room_id is not null and new.room_id is null and new.room is not distinct from old.room then
    new.room := null;
    return new;
  end if;
  -- Se elige un aula de la lista
  if new.room_id is not null and (tg_op = 'INSERT' or new.room_id is distinct from old.room_id) then
    select r.name into v_name from public.rooms r where r.id = new.room_id and r.school_id = v_school;
    if v_name is null then raise exception using errcode = '22023', message = 'Esa aula no es de esta escuela.'; end if;
    new.room := v_name;
    return new;
  end if;
  -- Llega texto
  v_name := nullif(trim(coalesce(new.room, '')), '');
  if v_name is null then
    new.room := null;
    new.room_id := null;
    return new;
  end if;
  new.room_id := null;
  select r.id, r.name into new.room_id, new.room from public.rooms r where r.school_id = v_school and lower(r.name) = lower(v_name);
  if new.room_id is null and v_school is not null then
    insert into public.rooms (school_id, name) values (v_school, left(v_name, 40)) returning id, name into new.room_id, new.room;
  end if;
  return new;
end;
$function$;

create trigger schedule_slots_room before insert or update on public.schedule_slots
  for each row execute function private.trg_sync_room();
create trigger class_sessions_room before insert or update on public.class_sessions
  for each row execute function private.trg_sync_room();

-- Renombrar o borrar un aula actualiza las clases que la usan
create or replace function private.trg_rooms_propagate()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    update public.schedule_slots set room = null, room_id = null where room_id = old.id;
    update public.class_sessions set room = null, room_id = null where room_id = old.id;
    return old;
  end if;
  if new.name is distinct from old.name then
    update public.schedule_slots set room = new.name where room_id = new.id;
    update public.class_sessions set room = new.name where room_id = new.id;
  end if;
  return new;
end;
$function$;

create trigger rooms_propagate_update after update of name on public.rooms
  for each row execute function private.trg_rooms_propagate();
create trigger rooms_propagate_delete before delete on public.rooms
  for each row execute function private.trg_rooms_propagate();

-- 3. Clases de la plantilla movidas a otro día u hora: se recuerda su origen para no recrearlas al regenerar
alter table public.class_sessions add column if not exists original_date date;
alter table public.class_sessions add column if not exists origin_slot_id uuid references public.schedule_slots(id) on delete set null;
create index if not exists class_sessions_origin_idx on public.class_sessions (origin_slot_id, original_date) where origin_slot_id is not null;

create or replace function private.trg_class_sessions_moved()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.slot_id is not null and old.original_date is null
     and (new.date is distinct from old.date or new.start_time is distinct from old.start_time
          or new.end_time is distinct from old.end_time or new.slot_id is null) then
    new.original_date := old.date;
    new.origin_slot_id := old.slot_id;
  end if;
  return new;
end;
$function$;

create trigger class_sessions_moved before update on public.class_sessions
  for each row execute function private.trg_class_sessions_moved();

create or replace function private.generate_slot_sessions(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  s record;
begin
  select sl.*, y.starts_on, y.ends_on, y.id as year_id into s
  from public.schedule_slots sl
  join public.teaching_assignments ta on ta.id = sl.teaching_assignment_id
  join public.class_groups g on g.id = ta.group_id
  join public.academic_years y on y.id = g.academic_year_id
  where sl.id = p_slot_id;
  if s.id is null then return; end if;

  -- Se rehacen solo las clases futuras sin tocar: sin asistencia, nota, práctica ni cambios de día u hora
  delete from public.class_sessions cs
  where cs.slot_id = p_slot_id and cs.date >= current_date and cs.status = 'programada' and cs.note is null and cs.practice_id is null
    and cs.original_date is null
    and not exists (select 1 from public.session_attendance sa where sa.session_id = cs.id);

  insert into public.class_sessions (teaching_assignment_id, slot_id, date, start_time, end_time, room, room_id)
  select s.teaching_assignment_id, s.id, d::date, s.start_time, s.end_time, s.room, s.room_id
  from generate_series(greatest(current_date, s.starts_on), s.ends_on, interval '1 day') d
  where extract(isodow from d) = s.weekday
    and not private.is_holiday(s.year_id, d::date)
    and not exists (select 1 from public.class_sessions x
                    where coalesce(x.origin_slot_id, x.slot_id) = s.id and coalesce(x.original_date, x.date) = d::date)
  on conflict (slot_id, date) do nothing;
end;
$function$;

-- 4. Choques
create or replace function private.class_label(p_module text, p_kind text, p_level smallint, p_group text, p_teacher text, p_start time, p_end time)
returns text
language sql
immutable
set search_path to ''
as $function$
  select concat_ws(' · ', p_module || ' ' || case p_kind when 'teoria' then 'teoría' else 'práctica' end,
    p_level || 'º' || p_group, nullif(p_teacher, ''), to_char(p_start, 'HH24:MI') || '-' || to_char(p_end, 'HH24:MI'));
$function$;

-- Choques entre clases de unas fechas (para marcar en rojo la semana)
create or replace function public.schedule_conflicts(p_school_id uuid, p_from date, p_to date)
returns table (session_id uuid, kind text, other_id uuid, other_label text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not (private.can_manage_school(p_school_id) or private.is_school_member(p_school_id)) then
    raise exception using errcode = '42501', message = 'No autorizado.';
  end if;
  return query
  with s as (
    select cs.id, cs.date, cs.start_time, cs.end_time, cs.room_id, ta.profile_id, ta.group_id,
      private.class_label(dm.module_id, dm.kind, g.level, g.name, p.full_name, cs.start_time, cs.end_time) as label
    from public.class_sessions cs
    join public.teaching_assignments ta on ta.id = cs.teaching_assignment_id
    join public.class_groups g on g.id = ta.group_id
    join public.academic_years y on y.id = g.academic_year_id and y.school_id = p_school_id
    join public.degree_modules dm on dm.id = ta.degree_module_id
    left join public.profiles p on p.id = ta.profile_id
    where cs.date between p_from and p_to and cs.status = 'programada'
  )
  select a.id, k.kind, b.id, b.label
  from s a
  join s b on a.date = b.date and a.id <> b.id and a.start_time < b.end_time and b.start_time < a.end_time
  cross join lateral (values ('profesor', a.profile_id = b.profile_id), ('aula', a.room_id = b.room_id), ('grupo', a.group_id = b.group_id)) as k(kind, hit)
  where k.hit;
end;
$function$;

-- Choques entre huecos de la plantilla semanal del curso actual
create or replace function public.template_conflicts(p_school_id uuid)
returns table (slot_id uuid, kind text, other_id uuid, other_label text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not (private.can_manage_school(p_school_id) or private.is_school_member(p_school_id)) then
    raise exception using errcode = '42501', message = 'No autorizado.';
  end if;
  return query
  with s as (
    select sl.id, sl.weekday, sl.start_time, sl.end_time, sl.room_id, ta.profile_id, ta.group_id,
      private.class_label(dm.module_id, dm.kind, g.level, g.name, p.full_name, sl.start_time, sl.end_time) as label
    from public.schedule_slots sl
    join public.teaching_assignments ta on ta.id = sl.teaching_assignment_id
    join public.class_groups g on g.id = ta.group_id
    join public.academic_years y on y.id = g.academic_year_id and y.school_id = p_school_id and y.is_current
    join public.degree_modules dm on dm.id = ta.degree_module_id
    left join public.profiles p on p.id = ta.profile_id
  )
  select a.id, k.kind, b.id, b.label
  from s a
  join s b on a.weekday = b.weekday and a.id <> b.id and a.start_time < b.end_time and b.start_time < a.end_time
  cross join lateral (values ('profesor', a.profile_id = b.profile_id), ('aula', a.room_id = b.room_id), ('grupo', a.group_id = b.group_id)) as k(kind, hit)
  where k.hit;
end;
$function$;

-- Choques que tendría una clase en una posición nueva (antes de guardar al arrastrar o en un formulario)
create or replace function public.check_schedule_conflict(p_kind text, p_id uuid, p_assignment_id uuid, p_date date, p_weekday smallint,
  p_start time, p_end time, p_room_id uuid)
returns table (kind text, other_id uuid, other_label text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_school uuid := private.assignment_school(p_assignment_id);
  v_profile uuid;
  v_group uuid;
begin
  if v_school is null or not (private.can_manage_school(v_school) or private.is_school_member(v_school)) then
    raise exception using errcode = '42501', message = 'No autorizado.';
  end if;
  select ta.profile_id, ta.group_id into v_profile, v_group from public.teaching_assignments ta where ta.id = p_assignment_id;

  if p_kind = 'session' then
    return query
    select k.kind, cs.id, private.class_label(dm.module_id, dm.kind, g.level, g.name, p.full_name, cs.start_time, cs.end_time)
    from public.class_sessions cs
    join public.teaching_assignments ta on ta.id = cs.teaching_assignment_id
    join public.class_groups g on g.id = ta.group_id
    join public.academic_years y on y.id = g.academic_year_id and y.school_id = v_school
    join public.degree_modules dm on dm.id = ta.degree_module_id
    left join public.profiles p on p.id = ta.profile_id
    cross join lateral (values ('profesor', ta.profile_id = v_profile), ('aula', cs.room_id = p_room_id), ('grupo', ta.group_id = v_group)) as k(kind, hit)
    where cs.date = p_date and cs.status = 'programada' and cs.id is distinct from p_id
      and cs.start_time < p_end and p_start < cs.end_time and k.hit;
  else
    return query
    select k.kind, sl.id, private.class_label(dm.module_id, dm.kind, g.level, g.name, p.full_name, sl.start_time, sl.end_time)
    from public.schedule_slots sl
    join public.teaching_assignments ta on ta.id = sl.teaching_assignment_id
    join public.class_groups g on g.id = ta.group_id
    join public.academic_years y on y.id = g.academic_year_id and y.school_id = v_school and y.is_current
    join public.degree_modules dm on dm.id = ta.degree_module_id
    left join public.profiles p on p.id = ta.profile_id
    cross join lateral (values ('profesor', ta.profile_id = v_profile), ('aula', sl.room_id = p_room_id), ('grupo', ta.group_id = v_group)) as k(kind, hit)
    where sl.weekday = p_weekday and sl.id is distinct from p_id
      and sl.start_time < p_end and p_start < sl.end_time and k.hit;
  end if;
end;
$function$;

revoke all on function public.schedule_conflicts(uuid, date, date) from public, anon;
revoke all on function public.template_conflicts(uuid) from public, anon;
revoke all on function public.check_schedule_conflict(text, uuid, uuid, date, smallint, time, time, uuid) from public, anon;
grant execute on function public.schedule_conflicts(uuid, date, date) to authenticated;
grant execute on function public.template_conflicts(uuid) to authenticated;
grant execute on function public.check_schedule_conflict(text, uuid, uuid, date, smallint, time, time, uuid) to authenticated;

commit;
