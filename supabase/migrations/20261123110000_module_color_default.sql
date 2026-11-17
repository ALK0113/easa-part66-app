-- Color de cada módulo (1-24 de la paleta de la app). Es del módulo, no del curso: se mantiene de un curso a otro.
-- Al crear un módulo sin color (formulario o importación) se le da uno que no use ningún otro módulo del catálogo
-- ni de su escuela; si ya están todos usados, el menos usado.
alter table public.modules alter column color set default null;

create or replace function private.trg_module_color()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.color is null or new.color < 1 or new.color > 24 then
    select c.n into new.color
    from generate_series(1, 24) as c(n)
    left join public.modules m on m.color = c.n and m.id <> new.id and (m.school_id is null or m.school_id is not distinct from new.school_id)
    group by c.n
    order by count(m.id), random()
    limit 1;
  end if;
  return new;
end;
$function$;

create trigger modules_color before insert or update of color on public.modules
  for each row execute function private.trg_module_color();
