-- Exámenes con hora y aviso a los alumnos. Si no se avisa, el alumno no lo ve (ni en el horario ni por la API):
-- solo el profesorado del módulo y la gestión de la escuela.
alter table public.assessments add column if not exists start_time time;
alter table public.assessments add column if not exists end_time time;
alter table public.assessments add column if not exists visible_to_students boolean not null default true;

-- Política restrictiva: se suma a assessments_read sin tocarla
create policy assessments_hidden_from_students on public.assessments as restrictive for select to authenticated
  using (visible_to_students or private.can_edit_module_content(school_id, module_id) or private.can_manage_school(school_id));
