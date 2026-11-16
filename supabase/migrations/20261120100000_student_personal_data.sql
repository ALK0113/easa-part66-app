-- Datos personales de la ficha del alumno. Los ve quien ya ve al alumno (dirección y sus profesores);
-- solo administración y supervisión los cambian (trigger protect_student_sensitive_columns).
alter table public.students
  add column if not exists dni text check (char_length(dni) <= 20),
  add column if not exists birth_date date,
  add column if not exists email text check (char_length(email) <= 200),
  add column if not exists phone text check (char_length(phone) <= 40),
  add column if not exists address text check (char_length(address) <= 300),
  add column if not exists emergency_name text check (char_length(emergency_name) <= 120),
  add column if not exists emergency_phone text check (char_length(emergency_phone) <= 40),
  add column if not exists notes text check (char_length(notes) <= 4000);
