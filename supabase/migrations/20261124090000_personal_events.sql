-- Eventos personales en el calendario: privados por defecto y, si se quiere, compartidos con compañeros concretos.
-- Alumno: comparte con los alumnos de su grupo. Profesor o coordinador: con los alumnos de los grupos donde da clase
-- y con el profesorado de su escuela. Quien recibe un evento lo ve, no lo edita, y puede quitárselo.

begin;

create table if not exists public.personal_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  note text check (note is null or length(note) <= 1000),
  date date not null,
  all_day boolean not null default false,
  start_time time,
  end_time time,
  repeat_weekly boolean not null default false,
  repeat_until date,
  created_at timestamptz not null default now(),
  check (all_day or (start_time is not null and end_time is not null and end_time > start_time)),
  check (not repeat_weekly or (repeat_until is not null and repeat_until >= date and repeat_until <= date + 366))
);
create index if not exists personal_events_owner_idx on public.personal_events (owner_id, date);

create table if not exists public.personal_event_shares (
  event_id uuid not null references public.personal_events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (event_id, profile_id)
);
create index if not exists personal_event_shares_profile_idx on public.personal_event_shares (profile_id);

-- Con quién puede compartir un usuario
create or replace function private.share_candidates(p_user uuid)
returns table (profile_id uuid, full_name text, detail text)
language sql
stable
security definer
set search_path to ''
as $function$
  with my_role as (select role from public.profiles where id = p_user),
  my_school as (select school_id from public.school_profiles where profile_id = p_user),
  my_groups as (
    select e.group_id
    from public.student_profiles sp
    join public.enrollments e on e.student_id = sp.student_id
    join public.academic_years y on y.id = e.academic_year_id and y.is_current
    where sp.profile_id = p_user and e.group_id is not null and e.status is distinct from 'baja'
    union
    select ta.group_id
    from public.teaching_assignments ta
    join public.class_groups g on g.id = ta.group_id
    join public.academic_years y on y.id = g.academic_year_id and y.is_current
    where ta.profile_id = p_user
  ),
  targets as (
    select sp.profile_id, g.level || 'º' || g.name as detail
    from public.enrollments e
    join public.student_profiles sp on sp.student_id = e.student_id
    join public.class_groups g on g.id = e.group_id
    join public.academic_years y on y.id = e.academic_year_id and y.is_current
    where e.group_id in (select group_id from my_groups) and e.status is distinct from 'baja'
    union all
    select p.id, case p.role when 'supervisor' then 'Coordinación' else 'Profesor' end
    from public.profiles p
    join public.school_profiles s on s.profile_id = p.id
    where p.role in ('profesor', 'supervisor')
      and (select role from my_role) in ('profesor', 'supervisor')
      and s.school_id = (select school_id from my_school)
  )
  select distinct on (t.profile_id) t.profile_id, pr.full_name, t.detail
  from targets t
  join public.profiles pr on pr.id = t.profile_id
  where t.profile_id <> p_user
  order by t.profile_id, t.detail;
$function$;

create or replace function public.event_share_candidates()
returns table (profile_id uuid, full_name text, detail text)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.profile_id, c.full_name, c.detail from private.share_candidates((select auth.uid())) c order by c.full_name;
$function$;

create or replace function private.is_event_owner(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (select 1 from public.personal_events where id = p_event_id and owner_id = (select auth.uid()));
$function$;

create or replace function private.is_event_shared_with_me(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (select 1 from public.personal_event_shares where event_id = p_event_id and profile_id = (select auth.uid()));
$function$;

alter table public.personal_events enable row level security;
alter table public.personal_event_shares enable row level security;

create policy personal_events_read on public.personal_events for select to authenticated
  using (owner_id = (select auth.uid()) or private.is_event_shared_with_me(id));
create policy personal_events_insert on public.personal_events for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy personal_events_update on public.personal_events for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy personal_events_delete on public.personal_events for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy personal_event_shares_read on public.personal_event_shares for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_event_owner(event_id));
create policy personal_event_shares_insert on public.personal_event_shares for insert to authenticated
  with check (private.is_event_owner(event_id)
    and exists (select 1 from private.share_candidates((select auth.uid())) c where c.profile_id = personal_event_shares.profile_id));
create policy personal_event_shares_delete on public.personal_event_shares for delete to authenticated
  using (profile_id = (select auth.uid()) or private.is_event_owner(event_id));

grant select, insert, update, delete on public.personal_events to authenticated;
grant select, insert, delete on public.personal_event_shares to authenticated;

-- Eventos propios y compartidos conmigo que caen en unas fechas (con el nombre de quien lo comparte)
create or replace function public.my_personal_events(p_from date, p_to date)
returns table (id uuid, owner_id uuid, owner_name text, is_owner boolean, title text, note text, date date, all_day boolean,
  start_time time, end_time time, repeat_weekly boolean, repeat_until date, shared_with uuid[])
language sql
stable
security definer
set search_path to ''
as $function$
  select e.id, e.owner_id, p.full_name, e.owner_id = (select auth.uid()), e.title, e.note, e.date, e.all_day,
    e.start_time, e.end_time, e.repeat_weekly, e.repeat_until,
    case when e.owner_id = (select auth.uid())
      then coalesce((select array_agg(s.profile_id) from public.personal_event_shares s where s.event_id = e.id), '{}') end
  from public.personal_events e
  join public.profiles p on p.id = e.owner_id
  where (e.owner_id = (select auth.uid()) or exists (select 1 from public.personal_event_shares s where s.event_id = e.id and s.profile_id = (select auth.uid())))
    and e.date <= p_to
    and (e.date >= p_from or (e.repeat_weekly and e.repeat_until >= p_from));
$function$;

revoke all on function public.event_share_candidates() from public, anon;
revoke all on function public.my_personal_events(date, date) from public, anon;
grant execute on function public.event_share_candidates() to authenticated;
grant execute on function public.my_personal_events(date, date) to authenticated;
grant execute on function private.share_candidates(uuid) to authenticated;
grant execute on function private.is_event_owner(uuid) to authenticated;
grant execute on function private.is_event_shared_with_me(uuid) to authenticated;

commit;
