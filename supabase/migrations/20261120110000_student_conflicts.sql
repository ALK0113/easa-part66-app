-- Solapes de horario de los alumnos: dos clases a la misma hora el mismo día.
-- Se permiten, pero se avisan (en rojo) hasta que se reubique al alumno o se ajusten las clases.
-- Una fila por alumno y pareja de clases (grupo + módulo), con cuántas sesiones chocan desde hoy.
create or replace function public.student_conflicts(p_school_id uuid, p_student_id uuid default null)
returns table(
  student_id uuid, student_name text,
  assignment_a uuid, module_a text, group_a text,
  assignment_b uuid, module_b text, group_b text,
  sessions integer, first_date date, first_start time, first_end time, weekdays integer[]
)
language plpgsql stable security definer set search_path to '' as $$
begin
  if not (private.can_manage_school(p_school_id) or private.is_school_member(p_school_id)) then
    raise exception using errcode = '42501', message = 'No autorizado.';
  end if;
  return query
  with stud_ta as (
    select distinct me.student_id, ta.id as ta_id, me.joined_on, me.left_on
    from public.module_enrollments me
    join public.academic_years y on y.id = me.academic_year_id and y.is_current and y.school_id = p_school_id
    join public.degree_modules dme on dme.id = me.degree_module_id
    join public.teaching_assignments ta on ta.group_id = me.group_id
    join public.degree_modules dta on dta.id = ta.degree_module_id and dta.module_id = dme.module_id
    where private.me_active(me.status) and (p_student_id is null or me.student_id = p_student_id)
  ),
  ses as (
    select distinct st.student_id, cs.id, cs.teaching_assignment_id as ta_id, cs.date, cs.start_time, cs.end_time
    from stud_ta st
    join public.class_sessions cs on cs.teaching_assignment_id = st.ta_id
    where cs.status = 'programada' and not cs.recovery and cs.date >= current_date
      and (st.joined_on is null or st.joined_on <= cs.date) and (st.left_on is null or st.left_on >= cs.date)
    union
    select rs.student_id, cs.id, cs.teaching_assignment_id, cs.date, cs.start_time, cs.end_time
    from public.session_recovery_students rs
    join public.class_sessions cs on cs.id = rs.session_id
    where cs.status = 'programada' and cs.date >= current_date and private.assignment_school(cs.teaching_assignment_id) = p_school_id
      and (p_student_id is null or rs.student_id = p_student_id)
  ),
  pairs as (
    select a.student_id, least(a.ta_id, b.ta_id) as ta1, greatest(a.ta_id, b.ta_id) as ta2, a.date, greatest(a.start_time, b.start_time) as s, least(a.end_time, b.end_time) as e
    from ses a join ses b
      on a.student_id = b.student_id and a.date = b.date and a.id < b.id
     and a.start_time < b.end_time and b.start_time < a.end_time
     and a.ta_id <> b.ta_id
  ),
  grouped as (
    select p.student_id, p.ta1, p.ta2, count(*)::integer as n,
      (array_agg(p.date order by p.date, p.s))[1] as d,
      (array_agg(p.s order by p.date, p.s))[1] as s,
      (array_agg(p.e order by p.date, p.s))[1] as e,
      array_agg(distinct extract(isodow from p.date)::integer) as wd
    from pairs p group by p.student_id, p.ta1, p.ta2
  )
  select g.student_id, st.name,
    g.ta1, dma.module_id, ga.level || 'º' || ga.name,
    g.ta2, dmb.module_id, gb.level || 'º' || gb.name,
    g.n, g.d, g.s, g.e, g.wd
  from grouped g
  join public.students st on st.id = g.student_id
  join public.teaching_assignments ta on ta.id = g.ta1
  join public.degree_modules dma on dma.id = ta.degree_module_id
  join public.class_groups ga on ga.id = ta.group_id
  join public.teaching_assignments tb on tb.id = g.ta2
  join public.degree_modules dmb on dmb.id = tb.degree_module_id
  join public.class_groups gb on gb.id = tb.group_id
  -- Dirección ve todos; un profesor, los que afectan a sus clases
  where private.can_manage_school(p_school_id) or private.is_assignment_teacher(g.ta1) or private.is_assignment_teacher(g.ta2)
  order by st.name, g.d;
end;
$$;

revoke all on function public.student_conflicts(uuid, uuid) from public, anon;
grant execute on function public.student_conflicts(uuid, uuid) to authenticated;
