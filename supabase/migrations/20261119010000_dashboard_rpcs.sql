-- Menos esperas: las cifras del Inicio y el resumen de escuelas del admin en una sola llamada.

-- Cifras del Inicio. SECURITY INVOKER: la RLS sigue decidiendo qué filas ve cada uno.
-- p_school_id: escuela elegida por el admin (null = la vista propia de cada rol).
create or replace function public.dashboard_stats(p_school_id uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
  v_role text := private.current_profile_role();
  v_modules text[];
begin
  if p_school_id is not null then
    select coalesce(array_agg(distinct id), '{}') into v_modules from (
      select dm.module_id as id from public.degree_modules dm join public.degrees d on d.id = dm.degree_id where d.school_id = p_school_id
      union
      select m.id from public.modules m where m.school_id = p_school_id
    ) x;
    return jsonb_build_object(
      'students', (select count(*) from public.students where school_id = p_school_id),
      'practices', (select count(*) from public.practices where school_id = p_school_id),
      'tlbs', (select count(*) from public.tlbs where school_id = p_school_id),
      'videos', (select count(*) from public.videos where school_id = p_school_id),
      'modules', cardinality(v_modules));
  end if;

  if v_role in ('admin', 'supervisor') then
    return jsonb_build_object(
      'students', (select count(*) from public.students),
      'practices', (select count(*) from public.practices),
      'tlbs', (select count(*) from public.tlbs),
      'videos', (select count(*) from public.videos),
      'modules', (select count(*) from public.modules));
  end if;

  if v_role = 'profesor' then
    select coalesce(array_agg(module_id), '{}') into v_modules from public.teacher_modules where profile_id = (select auth.uid());
  elsif v_role = 'alumno' then
    select coalesce(array_agg(sm.module_id), '{}') into v_modules
    from public.student_profiles sp join public.student_modules sm on sm.student_id = sp.student_id
    where sp.profile_id = (select auth.uid());
  else
    v_modules := '{}';
  end if;

  return jsonb_build_object(
    'students', case when v_role = 'profesor'
      then (select count(distinct student_id) from public.student_modules where module_id = any(v_modules)) else 0 end,
    'practices', (select count(*) from public.practices where module_id = any(v_modules)),
    'tlbs', (select count(*) from public.tlbs where module_id = any(v_modules)),
    'videos', (select count(*) from public.videos where module_id = any(v_modules)),
    'modules', cardinality(v_modules));
end;
$$;
grant execute on function public.dashboard_stats(uuid) to authenticated;

-- Resumen por escuela para el panel del admin (antes: 3 consultas por escuela).
create or replace function public.admin_school_overview()
returns table(school_id uuid, students bigint, teachers bigint, groups bigint, pending bigint)
language sql
stable
security definer
set search_path to ''
as $$
  select s.id,
    (select count(*) from public.students st where st.school_id = s.id),
    (select count(*) from public.school_profiles sp join public.profiles p on p.id = sp.profile_id
      where sp.school_id = s.id and p.role = 'profesor' and p.status = 'activo'),
    (select count(*) from public.class_groups cg join public.academic_years y on y.id = cg.academic_year_id
      where y.school_id = s.id and y.is_current),
    (select count(*) from public.school_profiles sp join public.profiles p on p.id = sp.profile_id
      where sp.school_id = s.id and p.status = 'pendiente')
  from public.schools s
  where private.is_global_admin();
$$;
revoke all on function public.admin_school_overview() from public, anon;
grant execute on function public.admin_school_overview() to authenticated;
