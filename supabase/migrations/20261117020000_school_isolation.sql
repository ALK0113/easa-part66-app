-- Cada escuela es independiente: TLB, vídeos y aviones pasan a ser de una escuela,
-- y ningún dato de una escuela se ve ni se modifica desde otra (salvo el admin global).

-- ---------------------------------------------------------------
-- Columna school_id en TLB, vídeos y aviones
-- Lo que ya existía pasa a la escuela más antigua (la única que tenía datos);
-- un TLB va a la escuela de su práctica.
-- ---------------------------------------------------------------
alter table public.tlbs add column if not exists school_id uuid references public.schools(id) on delete cascade;
alter table public.videos add column if not exists school_id uuid references public.schools(id) on delete cascade;
alter table public.aircraft add column if not exists school_id uuid references public.schools(id) on delete cascade;

update public.tlbs t set school_id = p.school_id
from public.practices p where t.school_id is null and p.id = t.practice_id;

update public.tlbs set school_id = (select id from public.schools order by created_at limit 1) where school_id is null;
update public.videos set school_id = (select id from public.schools order by created_at limit 1) where school_id is null;
update public.aircraft set school_id = (select id from public.schools order by created_at limit 1) where school_id is null;

alter table public.tlbs alter column school_id set not null;
alter table public.videos alter column school_id set not null;
alter table public.aircraft alter column school_id set not null;

create index if not exists tlbs_school_id_idx on public.tlbs(school_id);
create index if not exists videos_school_id_idx on public.videos(school_id);
create index if not exists aircraft_school_id_idx on public.aircraft(school_id);

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------
create or replace function private.in_my_school(p_school_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_global_admin() or (p_school_id is not null and p_school_id = private.current_school_id());
$$;

create or replace function private.tlb_in_my_school(p_tlb_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tlbs t where t.id = p_tlb_id and private.in_my_school(t.school_id));
$$;

create or replace function private.defect_in_my_school(p_defect_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.defects d where d.id = p_defect_id and private.tlb_in_my_school(d.tlb_id));
$$;

grant execute on function private.in_my_school(uuid), private.tlb_in_my_school(uuid), private.defect_in_my_school(uuid) to authenticated;

-- Si no se indica, la escuela es la de quien crea (como ya pasa con alumnos y prácticas)
drop trigger if exists fill_school_id on public.tlbs;
create trigger fill_school_id before insert on public.tlbs for each row execute function private.fill_school_id();
drop trigger if exists fill_school_id on public.videos;
create trigger fill_school_id before insert on public.videos for each row execute function private.fill_school_id();
drop trigger if exists fill_school_id on public.aircraft;
create trigger fill_school_id before insert on public.aircraft for each row execute function private.fill_school_id();

-- Un TLB es siempre de la escuela de su práctica
create or replace function private.tlb_practice_school()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_school uuid;
begin
  if new.practice_id is not null then
    select school_id into v_school from public.practices where id = new.practice_id;
    if v_school is not null then
      if tg_op = 'UPDATE' and v_school <> old.school_id then
        raise exception using errcode = '42501', message = 'La práctica es de otra escuela.';
      end if;
      new.school_id := v_school;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tlbs_practice_school on public.tlbs;
create trigger tlbs_practice_school before insert or update of practice_id, school_id on public.tlbs
  for each row execute function private.tlb_practice_school();

-- Un registro de prácticas une siempre un alumno y una práctica de la misma escuela
create or replace function private.practice_record_same_school()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.practices p join public.students s on s.school_id = p.school_id
    where p.id = new.practice_id and s.id::text = new.student_id::text
  ) then
    raise exception using errcode = '42501', message = 'El alumno y la práctica son de escuelas distintas.';
  end if;
  return new;
end;
$$;
drop trigger if exists practice_records_same_school on public.practice_records;
create trigger practice_records_same_school before insert or update of student_id, practice_id on public.practice_records
  for each row execute function private.practice_record_same_school();

-- ---------------------------------------------------------------
-- Aislamiento por escuela (políticas restrictivas: se suman a las que ya hay)
-- ---------------------------------------------------------------
drop policy if exists tlbs_school_isolation on public.tlbs;
create policy tlbs_school_isolation on public.tlbs as restrictive for all to authenticated
  using (private.in_my_school(school_id)) with check (private.in_my_school(school_id));

drop policy if exists videos_school_isolation on public.videos;
create policy videos_school_isolation on public.videos as restrictive for all to authenticated
  using (private.in_my_school(school_id)) with check (private.in_my_school(school_id));

drop policy if exists aircraft_school_isolation on public.aircraft;
create policy aircraft_school_isolation on public.aircraft as restrictive for all to authenticated
  using (private.in_my_school(school_id)) with check (private.in_my_school(school_id));

drop policy if exists defects_school_isolation on public.defects;
create policy defects_school_isolation on public.defects as restrictive for all to authenticated
  using (private.tlb_in_my_school(tlb_id)) with check (private.tlb_in_my_school(tlb_id));

drop policy if exists defect_answers_school_isolation on public.defect_answers;
create policy defect_answers_school_isolation on public.defect_answers as restrictive for all to authenticated
  using (private.defect_in_my_school(defect_id)) with check (private.defect_in_my_school(defect_id));

drop policy if exists tlb_submissions_school_isolation on public.tlb_submissions;
create policy tlb_submissions_school_isolation on public.tlb_submissions as restrictive for all to authenticated
  using (private.tlb_in_my_school(tlb_id)) with check (private.tlb_in_my_school(tlb_id));

drop policy if exists student_actions_school_isolation on public.student_actions;
create policy student_actions_school_isolation on public.student_actions as restrictive for all to authenticated
  using (private.tlb_in_my_school(tlb_id)) with check (private.tlb_in_my_school(tlb_id));

drop policy if exists records_archive_school_isolation on public.records_archive;
create policy records_archive_school_isolation on public.records_archive as restrictive for all to authenticated
  using (private.is_global_admin() or private.practice_in_my_school(practice_id))
  with check (private.is_global_admin() or private.practice_in_my_school(practice_id));

-- El supervisor gestiona los aviones de su escuela (antes solo el admin)
drop policy if exists aircraft_supervisor_write on public.aircraft;
create policy aircraft_supervisor_write on public.aircraft for all to authenticated
  using (private.is_supervisor() and school_id = private.current_school_id())
  with check (private.is_supervisor() and school_id = private.current_school_id());

-- ---------------------------------------------------------------
-- Funciones que saltan la RLS: ahora comprueban también la escuela
-- ---------------------------------------------------------------
create or replace function private.can_edit_defect(p_defect_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_profile_role() = 'admin'
    or exists (
      select 1 from public.defects d
      join public.tlbs t on t.id = d.tlb_id
      where d.id = p_defect_id and private.has_teacher_module(t.module_id) and private.in_my_school(t.school_id)
    );
$$;

create or replace function public.toggle_tlb_publish(p_tlb_id uuid, p_published boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_module_id text; v_school uuid;
begin
  if not (private.is_global_admin() or private.is_teaching_role()) then
    raise exception using errcode = '42501', message = 'No autorizado para publicar TLB.';
  end if;
  select module_id, school_id into v_module_id, v_school from public.tlbs where id = p_tlb_id for update;
  if not found or not private.in_my_school(v_school) then
    raise exception using errcode = '23503', message = 'TLB no encontrado.';
  end if;
  if not private.is_global_admin() and not private.has_teacher_module(v_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado el módulo de este TLB.';
  end if;
  update public.tlbs set published = p_published where id = p_tlb_id;
end;
$$;

create or replace function public.add_defect_to_tlb(p_tlb_id uuid, p_defect_number integer, p_ata text, p_pirep text, p_defect_description text, p_correct_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_module_id text;
  v_school uuid;
  v_defect_id uuid;
  v_defect_number integer;
begin
  if not (private.is_global_admin() or private.is_teaching_role()) then
    raise exception using errcode = '42501', message = 'No autorizado para añadir defectos.';
  end if;
  if nullif(trim(p_ata), '') is null
    or nullif(trim(p_defect_description), '') is null
    or nullif(trim(p_correct_action), '') is null then
    raise exception using errcode = '22023', message = 'ATA, defecto y acción correctiva son obligatorios.';
  end if;

  select module_id, school_id into v_module_id, v_school from public.tlbs where id = p_tlb_id for update;
  if not found or not private.in_my_school(v_school) then
    raise exception using errcode = '23503', message = 'TLB no encontrado.';
  end if;
  if not private.is_global_admin() and not private.has_teacher_module(v_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado el módulo de este TLB.';
  end if;

  select greatest(coalesce(p_defect_number, 1), coalesce(max(defect_number) + 1, 1))
  into v_defect_number from public.defects where tlb_id = p_tlb_id;

  insert into public.defects (tlb_id, defect_number, ata, pirep, defect_description)
  values (p_tlb_id, v_defect_number, trim(p_ata), nullif(trim(p_pirep), ''), trim(p_defect_description))
  returning id into v_defect_id;

  insert into public.defect_answers (defect_id, correct_action) values (v_defect_id, trim(p_correct_action));

  return v_defect_id;
end;
$$;

create or replace function public.admin_create_tlb_with_defect(p_module_id text, p_practice_id text, p_aircraft_id text, p_date date, p_teacher_name text, p_defect_description text, p_correct_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_practice record;
  v_aircraft record;
  v_tlb public.tlbs%rowtype;
  v_defect public.defects%rowtype;
begin
  if not (private.is_global_admin() or private.is_teaching_role()) then
    raise exception using errcode = '42501', message = 'No autorizado para crear un TLB.';
  end if;
  if not private.is_global_admin() and not private.has_teacher_module(p_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado este módulo.';
  end if;
  select id, ata, school_id into v_practice from public.practices where id::text = p_practice_id and module_id = p_module_id;
  if not found or not private.in_my_school(v_practice.school_id) then
    raise exception using errcode = '23503', message = 'La práctica no pertenece al módulo seleccionado.';
  end if;
  select type, registration, msn into v_aircraft from public.aircraft
  where id::text = p_aircraft_id and school_id = v_practice.school_id;
  if not found then
    raise exception using errcode = '23503', message = 'Aeronave no encontrada en esta escuela.';
  end if;
  if nullif(trim(p_defect_description), '') is null or nullif(trim(p_correct_action), '') is null then
    raise exception using errcode = '22023', message = 'El defecto y la acción correctiva son obligatorios.';
  end if;

  insert into public.tlbs (module_id, practice_id, aircraft, registration, msn, date, teacher_name, published, crs, school_id)
  values (
    p_module_id, p_practice_id, v_aircraft.type, v_aircraft.registration, v_aircraft.msn,
    p_date, p_teacher_name, false,
    'CERTIFICATE OF RELEASE TO SERVICE - CERTIFIES THAT THE WORK SPECIFIED WAS CARRIED OUT IN ACCORDANCE WITH PART-145',
    v_practice.school_id
  ) returning * into v_tlb;

  insert into public.defects (tlb_id, defect_number, ata, pirep, defect_description)
  values (v_tlb.id, 1, v_practice.ata, 'CPT', trim(p_defect_description))
  returning * into v_defect;

  insert into public.defect_answers (defect_id, correct_action) values (v_defect.id, trim(p_correct_action));

  return jsonb_build_object('tlb', to_jsonb(v_tlb), 'defect', to_jsonb(v_defect) || jsonb_build_object('correct_action', trim(p_correct_action)));
end;
$$;

-- Los vídeos nuevos reciben un id automático (la app no lo envía)
alter table public.videos alter column id set default gen_random_uuid()::text;
