-- Festivos y vacaciones del curso escolar. Un día festivo no tiene clases:
-- la plantilla semanal no genera clases esos días y, al añadir un festivo, las clases que ya
-- había se quitan (o se cancelan si tienen asistencia, práctica o nota). Al quitarlo, vuelven.

create table if not exists public.school_holidays (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  name text not null check (length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists school_holidays_year_idx on public.school_holidays (academic_year_id, starts_on);

alter table public.school_holidays enable row level security;

create policy school_holidays_read on public.school_holidays for select to authenticated
  using (private.is_school_member(private.year_school(academic_year_id)));
create policy school_holidays_insert on public.school_holidays for insert to authenticated
  with check (private.can_manage_school(private.year_school(academic_year_id)));
create policy school_holidays_update on public.school_holidays for update to authenticated
  using (private.can_manage_school(private.year_school(academic_year_id)))
  with check (private.can_manage_school(private.year_school(academic_year_id)));
create policy school_holidays_delete on public.school_holidays for delete to authenticated
  using (private.can_manage_school(private.year_school(academic_year_id)));

grant select, insert, update, delete on public.school_holidays to authenticated;

-- ¿Es festivo ese día para el curso escolar?
create or replace function private.is_holiday(p_year_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (select 1 from public.school_holidays h
                 where h.academic_year_id = p_year_id and p_date between h.starts_on and h.ends_on);
$$;

-- La plantilla semanal ya no genera clases en festivos
create or replace function private.generate_slot_sessions(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
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

  -- las clases futuras sin asistencia ni cambios se rehacen; el pasado no se toca
  delete from public.class_sessions cs
  where cs.slot_id = p_slot_id and cs.date >= current_date and cs.status = 'programada' and cs.note is null and cs.practice_id is null
    and not exists (select 1 from public.session_attendance sa where sa.session_id = cs.id);

  insert into public.class_sessions (teaching_assignment_id, slot_id, date, start_time, end_time, room)
  select s.teaching_assignment_id, s.id, d::date, s.start_time, s.end_time, s.room
  from generate_series(greatest(current_date, s.starts_on), s.ends_on, interval '1 day') d
  where extract(isodow from d) = s.weekday
    and not private.is_holiday(s.year_id, d::date)
  on conflict (slot_id, date) do nothing;
end;
$$;

-- Rehace el calendario de un curso escolar tras cambiar sus festivos
create or replace function private.apply_school_holidays(p_year_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_slot uuid;
begin
  -- 1) Cada franja semanal se regenera (quita las clases libres en festivos y repone las de días que ya no lo son)
  for v_slot in
    select sl.id from public.schedule_slots sl
    join public.teaching_assignments ta on ta.id = sl.teaching_assignment_id
    join public.class_groups g on g.id = ta.group_id
    where g.academic_year_id = p_year_id
  loop
    perform private.generate_slot_sessions(v_slot);
  end loop;

  -- 2) Las clases que quedan en festivos (con asistencia, práctica, nota o sueltas) se cancelan
  update public.class_sessions cs
  set status = 'cancelada'
  from public.teaching_assignments ta
  join public.class_groups g on g.id = ta.group_id
  where cs.teaching_assignment_id = ta.id and g.academic_year_id = p_year_id
    and cs.date >= current_date and cs.status = 'programada'
    and private.is_holiday(p_year_id, cs.date);
end;
$$;

create or replace function private.trg_school_holidays_apply()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_year uuid;
begin
  if tg_op = 'DELETE' then
    for v_year in select distinct academic_year_id from old_rows loop perform private.apply_school_holidays(v_year); end loop;
  else
    for v_year in select distinct academic_year_id from new_rows loop perform private.apply_school_holidays(v_year); end loop;
  end if;
  return null;
end;
$$;

-- Una sola vez por operación (aunque se importen muchos festivos de golpe)
create trigger school_holidays_after_insert after insert on public.school_holidays
  referencing new table as new_rows for each statement execute function private.trg_school_holidays_apply();
create trigger school_holidays_after_update after update on public.school_holidays
  referencing new table as new_rows for each statement execute function private.trg_school_holidays_apply();
create trigger school_holidays_after_delete after delete on public.school_holidays
  referencing old table as old_rows for each statement execute function private.trg_school_holidays_apply();
