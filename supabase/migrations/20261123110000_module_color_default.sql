-- Cada módulo recibe un color al azar de la paleta (1-18) al crearse, también al importarlo.
-- El color es del módulo (no del curso), así que se mantiene de un curso a otro.
alter table public.modules alter column color set default (1 + floor(random() * 18))::int;
update public.modules set color = (1 + floor(random() * 18))::int where color is null;
