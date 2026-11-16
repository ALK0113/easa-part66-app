-- admin_update_school y admin_update_school_brand_color escriben schools.updated_at,
-- pero la columna nunca se creó: editar una escuela fallaba siempre.
alter table public.schools
  add column if not exists updated_at timestamptz not null default now();
