-- Eliminar tablas de backup sin uso (RLS sin políticas, sin dependencias).
-- Copia de los datos guardada fuera del repo antes de borrar (2026-11-14).
drop table if exists private.students_groups_backup;
drop table if exists public.student_modules_backup;
drop table if exists public.student_profiles_backup;
