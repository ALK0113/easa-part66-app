-- Estructura Módulo EASA → Submódulo EASA → Clases teóricas / prácticas.
-- RA oficiales (Departament d'Educació) por módulo profesional (MP); un módulo EASA usa RA de uno o varios MP.
-- Clases teóricas con RA, comentarios, presentaciones (solo enlace) y sesiones en el calendario.
-- Exámenes (parcial / RA entera) y evaluaciones con nota por alumno, en clases teóricas y prácticas.

-- Puede editar el contenido de un módulo en su escuela: la dirección o un profesor del módulo
create or replace function private.can_edit_module_content(p_school_id uuid, p_module_id text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.can_manage_school(p_school_id)
      or (private.is_school_member(p_school_id) and private.has_teacher_module(p_module_id));
$$;

-- Submódulos EASA (11.1, 11.2…)
create table if not exists public.submodules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  module_id text not null references public.modules(id) on delete cascade,
  code text not null check (length(trim(code)) between 1 and 20),
  name text not null check (length(trim(name)) between 1 and 200),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (school_id, module_id, code)
);

-- Módulos profesionales (MP) de FP y sus RA oficiales
create table if not exists public.professional_modules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  code text not null check (length(trim(code)) between 1 and 20),
  name text not null check (length(trim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (school_id, code)
);
create table if not exists public.learning_outcomes (
  id uuid primary key default gen_random_uuid(),
  professional_module_id uuid not null references public.professional_modules(id) on delete cascade,
  number integer not null check (number between 1 and 50),
  description text not null check (length(trim(description)) between 1 and 1000),
  unique (professional_module_id, number)
);
create table if not exists public.module_professional_modules (
  school_id uuid not null references public.schools(id) on delete cascade,
  module_id text not null references public.modules(id) on delete cascade,
  professional_module_id uuid not null references public.professional_modules(id) on delete cascade,
  primary key (school_id, module_id, professional_module_id)
);

-- Clases teóricas y sus presentaciones (enlaces)
create table if not exists public.theory_classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  module_id text not null references public.modules(id) on delete cascade,
  submodule_id uuid references public.submodules(id) on delete set null,
  learning_outcome_id uuid references public.learning_outcomes(id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 200),
  comments text check (length(comments) <= 4000),
  hours integer check (hours >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.theory_class_links (
  id uuid primary key default gen_random_uuid(),
  theory_class_id uuid not null references public.theory_classes(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  url text not null check (url ~* '^https?://' and length(url) <= 2000),
  created_at timestamptz not null default now()
);

-- Clases prácticas (las prácticas existentes) con submódulo y RA; sesiones de clase teórica en el calendario
alter table public.practices
  add column if not exists submodule_id uuid references public.submodules(id) on delete set null,
  add column if not exists learning_outcome_id uuid references public.learning_outcomes(id) on delete set null;
alter table public.class_sessions
  add column if not exists theory_class_id uuid references public.theory_classes(id) on delete set null;

-- Exámenes y evaluaciones (de una clase teórica o práctica) y sus notas por alumno
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  module_id text not null references public.modules(id) on delete cascade,
  kind text not null check (kind in ('examen', 'evaluacion')),
  scope text check (scope in ('parcial', 'ra')),
  learning_outcome_id uuid references public.learning_outcomes(id) on delete set null,
  theory_class_id uuid references public.theory_classes(id) on delete cascade,
  practice_id text references public.practices(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  date date,
  max_grade numeric not null default 10 check (max_grade > 0),
  created_at timestamptz not null default now(),
  check ((theory_class_id is null) <> (practice_id is null)),
  check (kind = 'evaluacion' or scope is not null),
  check (scope is distinct from 'ra' or learning_outcome_id is not null)
);
create table if not exists public.assessment_grades (
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  grade numeric check (grade >= 0),
  comment text check (length(comment) <= 500),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (assessment_id, student_id)
);

create index if not exists submodules_module_idx on public.submodules (school_id, module_id, position);
create index if not exists theory_classes_module_idx on public.theory_classes (school_id, module_id);
create index if not exists assessments_class_idx on public.assessments (theory_class_id, practice_id);
create index if not exists class_sessions_theory_idx on public.class_sessions (theory_class_id) where theory_class_id is not null;

-- Seguridad: leer = miembros de la escuela; escribir = dirección o profesor del módulo
alter table public.submodules enable row level security;
alter table public.professional_modules enable row level security;
alter table public.learning_outcomes enable row level security;
alter table public.module_professional_modules enable row level security;
alter table public.theory_classes enable row level security;
alter table public.theory_class_links enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_grades enable row level security;

create policy submodules_read on public.submodules for select to authenticated using (private.is_school_member(school_id));
create policy submodules_write on public.submodules for all to authenticated
  using (private.can_edit_module_content(school_id, module_id)) with check (private.can_edit_module_content(school_id, module_id));

create policy professional_modules_read on public.professional_modules for select to authenticated using (private.is_school_member(school_id));
create policy professional_modules_write on public.professional_modules for all to authenticated
  using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));

create policy learning_outcomes_read on public.learning_outcomes for select to authenticated
  using (exists (select 1 from public.professional_modules mp where mp.id = professional_module_id and private.is_school_member(mp.school_id)));
create policy learning_outcomes_write on public.learning_outcomes for all to authenticated
  using (exists (select 1 from public.professional_modules mp where mp.id = professional_module_id and private.can_manage_school(mp.school_id)))
  with check (exists (select 1 from public.professional_modules mp where mp.id = professional_module_id and private.can_manage_school(mp.school_id)));

create policy module_professional_modules_read on public.module_professional_modules for select to authenticated using (private.is_school_member(school_id));
create policy module_professional_modules_write on public.module_professional_modules for all to authenticated
  using (private.can_manage_school(school_id)) with check (private.can_manage_school(school_id));

create policy theory_classes_read on public.theory_classes for select to authenticated using (private.is_school_member(school_id));
create policy theory_classes_write on public.theory_classes for all to authenticated
  using (private.can_edit_module_content(school_id, module_id)) with check (private.can_edit_module_content(school_id, module_id));

create policy theory_class_links_read on public.theory_class_links for select to authenticated
  using (exists (select 1 from public.theory_classes c where c.id = theory_class_id and private.is_school_member(c.school_id)));
create policy theory_class_links_write on public.theory_class_links for all to authenticated
  using (exists (select 1 from public.theory_classes c where c.id = theory_class_id and private.can_edit_module_content(c.school_id, c.module_id)))
  with check (exists (select 1 from public.theory_classes c where c.id = theory_class_id and private.can_edit_module_content(c.school_id, c.module_id)));

create policy assessments_read on public.assessments for select to authenticated using (private.is_school_member(school_id));
create policy assessments_write on public.assessments for all to authenticated
  using (private.can_edit_module_content(school_id, module_id)) with check (private.can_edit_module_content(school_id, module_id));

-- Notas: el profesorado del módulo las ve y las pone; el alumno ve solo las suyas
create policy assessment_grades_read on public.assessment_grades for select to authenticated
  using (private.is_student_profile(student_id::text)
    or exists (select 1 from public.assessments a where a.id = assessment_id and private.can_edit_module_content(a.school_id, a.module_id)));
-- Comprobación de la nota sin depender de qué alumnos ve el profesor (RLS de students)
create or replace function private.assessment_grade_allowed(p_assessment_id uuid, p_student_id uuid, p_grade numeric)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.assessments a join public.students s on s.id = p_student_id
    where a.id = p_assessment_id
      and s.school_id = a.school_id
      and private.can_edit_module_content(a.school_id, a.module_id)
      and coalesce(p_grade, 0) <= a.max_grade
  );
$$;
create policy assessment_grades_write on public.assessment_grades for all to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id and private.can_edit_module_content(a.school_id, a.module_id)))
  with check (private.assessment_grade_allowed(assessment_id, student_id, grade));

grant select, insert, update, delete on public.submodules, public.professional_modules, public.learning_outcomes,
  public.module_professional_modules, public.theory_classes, public.theory_class_links,
  public.assessments, public.assessment_grades to authenticated;
