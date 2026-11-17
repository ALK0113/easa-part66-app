-- Clases conjuntas: el mismo profesor da el mismo módulo a dos grupos a la vez en la misma aula (o sin aula).
-- No es un choque: no se marca ni se avisa.

create or replace function private.is_joint_class(p_profile_a uuid, p_profile_b uuid, p_module_a text, p_module_b text, p_room_a uuid, p_room_b uuid)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_profile_a = p_profile_b and p_module_a = p_module_b
    and (p_room_a is null or p_room_b is null or p_room_a = p_room_b);
$function$;

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
    select cs.id, cs.date, cs.start_time, cs.end_time, cs.room_id, ta.profile_id, ta.group_id, dm.module_id,
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
    and not private.is_joint_class(a.profile_id, b.profile_id, a.module_id, b.module_id, a.room_id, b.room_id)
  cross join lateral (values ('profesor', a.profile_id = b.profile_id), ('aula', a.room_id = b.room_id), ('grupo', a.group_id = b.group_id)) as k(kind, hit)
  where k.hit;
end;
$function$;

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
    select sl.id, sl.weekday, sl.start_time, sl.end_time, sl.room_id, ta.profile_id, ta.group_id, dm.module_id,
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
    and not private.is_joint_class(a.profile_id, b.profile_id, a.module_id, b.module_id, a.room_id, b.room_id)
  cross join lateral (values ('profesor', a.profile_id = b.profile_id), ('aula', a.room_id = b.room_id), ('grupo', a.group_id = b.group_id)) as k(kind, hit)
  where k.hit;
end;
$function$;

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
  v_module text;
begin
  if v_school is null or not (private.can_manage_school(v_school) or private.is_school_member(v_school)) then
    raise exception using errcode = '42501', message = 'No autorizado.';
  end if;
  select ta.profile_id, ta.group_id, dm.module_id into v_profile, v_group, v_module
  from public.teaching_assignments ta join public.degree_modules dm on dm.id = ta.degree_module_id where ta.id = p_assignment_id;

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
      and cs.start_time < p_end and p_start < cs.end_time and k.hit
      and not private.is_joint_class(ta.profile_id, v_profile, dm.module_id, v_module, cs.room_id, p_room_id);
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
      and sl.start_time < p_end and p_start < sl.end_time and k.hit
      and not private.is_joint_class(ta.profile_id, v_profile, dm.module_id, v_module, sl.room_id, p_room_id);
  end if;
end;
$function$;
