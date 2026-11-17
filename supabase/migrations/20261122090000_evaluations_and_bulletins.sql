-- Evaluaciones (1ª, 2ª, 3ª…) con nota por módulo, comentarios por asignatura y logo de la escuela para los boletines.
-- La «Final» no es una fila: es el curso entero y usa la nota final de module_enrollments.

begin;

-- 1. Evaluaciones de cada curso escolar
create table if not exists public.evaluation_periods (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  position smallint not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  unique (academic_year_id, position),
  check (starts_on <= ends_on)
);
create index if not exists evaluation_periods_year_idx on public.evaluation_periods (academic_year_id);
alter table public.evaluation_periods enable row level security;
create policy evaluation_periods_read on public.evaluation_periods for select to authenticated
  using (private.is_school_member(private.year_school(academic_year_id)));
create policy evaluation_periods_write on public.evaluation_periods for all to authenticated
  using (private.can_manage_school(private.year_school(academic_year_id)))
  with check (private.can_manage_school(private.year_school(academic_year_id)));
grant select, insert, update, delete on public.evaluation_periods to authenticated;

-- 2. Nota de cada módulo en cada evaluación
create table if not exists public.period_grades (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.evaluation_periods(id) on delete cascade,
  module_enrollment_id uuid not null references public.module_enrollments(id) on delete cascade,
  theory_grade numeric check (theory_grade is null or theory_grade >= 0),
  practical_result text check (practical_result is null or practical_result in ('apto', 'no_apto')),
  comment text check (comment is null or length(comment) <= 2000),
  graded_by uuid references public.profiles(id) on delete set null,
  graded_at timestamptz not null default now(),
  unique (period_id, module_enrollment_id)
);
create index if not exists period_grades_enrollment_idx on public.period_grades (module_enrollment_id);
alter table public.period_grades enable row level security;
-- Quien ve la matrícula ve su nota (alumno: la suya; profesor: sus módulos y grupos; gestión: su escuela)
create policy period_grades_read on public.period_grades for select to authenticated
  using (exists (select 1 from public.module_enrollments me where me.id = module_enrollment_id));
grant select on public.period_grades to authenticated;

-- 3. Comentario de la nota final
alter table public.module_enrollments add column if not exists grade_comment text
  check (grade_comment is null or length(grade_comment) <= 2000);

-- Permiso para calificar una matrícula: gestión de la escuela, o su profesor con el curso abierto
create or replace function private.assert_can_grade(p_module_enrollment_id uuid,
  out enrollment_id uuid, out academic_year_id uuid, out kind text, out grade_max numeric)
language plpgsql
security definer
set search_path to ''
as $function$
declare v_group uuid; v_module uuid; v_current boolean; v_school uuid;
begin
  select m.id, m.academic_year_id, dm.kind, sc.grade_max, m.group_id, m.degree_module_id, y.is_current, y.school_id
    into enrollment_id, academic_year_id, kind, grade_max, v_group, v_module, v_current, v_school
  from public.module_enrollments m
  join public.degree_modules dm on dm.id = m.degree_module_id
  join public.academic_years y on y.id = m.academic_year_id
  join public.schools sc on sc.id = y.school_id
  where m.id = p_module_enrollment_id;
  if enrollment_id is null then raise exception using errcode = 'P0002', message = 'Matrícula no encontrada.'; end if;
  if not private.can_manage_school(v_school) then
    if not exists (select 1 from public.teaching_assignments ta
                   where ta.profile_id = (select auth.uid()) and ta.group_id = v_group and ta.degree_module_id = v_module) then
      raise exception using errcode = '42501', message = 'Solo el profesor de este módulo y grupo puede calificar.';
    end if;
    if not v_current then
      raise exception using errcode = '42501', message = 'Ese curso escolar está cerrado.';
    end if;
  end if;
end;
$function$;

-- 4. Nota de una evaluación (vacía = se borra)
create or replace function public.set_period_grade(p_period_id uuid, p_module_enrollment_id uuid, p_theory_grade numeric, p_practical_result text, p_comment text)
returns public.period_grades
language plpgsql
security definer
set search_path to ''
as $function$
declare
  me record;
  v_year uuid;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_row public.period_grades;
begin
  select * into me from private.assert_can_grade(p_module_enrollment_id);
  select ep.academic_year_id into v_year from public.evaluation_periods ep where ep.id = p_period_id;
  if v_year is null then raise exception using errcode = 'P0002', message = 'Evaluación no encontrada.'; end if;
  if v_year <> me.academic_year_id then
    raise exception using errcode = '22023', message = 'La evaluación no es del mismo curso que la matrícula.';
  end if;
  if p_practical_result is not null and p_practical_result not in ('apto', 'no_apto') then
    raise exception using errcode = '22023', message = 'Resultado práctico no válido.';
  end if;
  if me.kind = 'teoria' and p_practical_result is not null then
    raise exception using errcode = '22023', message = 'Los módulos de teoría se califican con nota.';
  end if;
  if me.kind = 'practica' and p_theory_grade is not null then
    raise exception using errcode = '22023', message = 'Los módulos de práctica se califican como Apto o No apto.';
  end if;
  if p_theory_grade is not null and (p_theory_grade < 0 or p_theory_grade > me.grade_max) then
    raise exception using errcode = '22023', message = format('La nota tiene que estar entre 0 y %s.', me.grade_max);
  end if;

  if p_theory_grade is null and p_practical_result is null and v_comment is null then
    delete from public.period_grades where period_id = p_period_id and module_enrollment_id = p_module_enrollment_id;
    return null;
  end if;

  insert into public.period_grades (period_id, module_enrollment_id, theory_grade, practical_result, comment, graded_by, graded_at)
  values (p_period_id, p_module_enrollment_id, p_theory_grade, p_practical_result, v_comment, (select auth.uid()), now())
  on conflict (period_id, module_enrollment_id) do update
    set theory_grade = excluded.theory_grade, practical_result = excluded.practical_result, comment = excluded.comment,
        graded_by = excluded.graded_by, graded_at = excluded.graded_at
  returning * into v_row;
  return v_row;
end;
$function$;

-- 5. Comentario de la nota final
create or replace function public.set_module_grade_comment(p_module_enrollment_id uuid, p_comment text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare me record;
begin
  select * into me from private.assert_can_grade(p_module_enrollment_id);
  update public.module_enrollments set grade_comment = nullif(trim(coalesce(p_comment, '')), '') where id = me.enrollment_id;
end;
$function$;

revoke all on function private.assert_can_grade(uuid) from public, anon;
revoke all on function public.set_period_grade(uuid, uuid, numeric, text, text) from public, anon;
revoke all on function public.set_module_grade_comment(uuid, text) from public, anon;
grant execute on function private.assert_can_grade(uuid) to authenticated;
grant execute on function public.set_period_grade(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.set_module_grade_comment(uuid, text) to authenticated;

-- 6. Logo de la escuela (imagen pequeña en Storage, ruta <school_id>/logo.<ext>)
alter table public.schools add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('school-logos', 'school-logos', true, 204800, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 204800, allowed_mime_types = array['image/png', 'image/jpeg'];

create policy school_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'school-logos' and private.can_manage_school(((storage.foldername(name))[1])::uuid));
create policy school_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'school-logos' and private.can_manage_school(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'school-logos' and private.can_manage_school(((storage.foldername(name))[1])::uuid));
create policy school_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'school-logos' and private.can_manage_school(((storage.foldername(name))[1])::uuid));

commit;
