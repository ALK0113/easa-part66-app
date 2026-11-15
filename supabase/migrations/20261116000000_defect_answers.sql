-- Las respuestas oficiales de los TLB pasan a una tabla propia. 2026-11-16
-- Antes, `defects.correct_action` se podía leer por la API (y llegaba por Realtime)
-- a cualquier alumno con el TLB publicado. Ahora solo la ven el admin y los
-- profesores del módulo.

-- ---------------------------------------------------------------------------
-- 1. Tabla y datos
-- ---------------------------------------------------------------------------
create table if not exists public.defect_answers (
  defect_id uuid primary key references public.defects(id) on delete cascade,
  correct_action text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.defect_answers (defect_id, correct_action)
select id, coalesce(correct_action, '') from public.defects
on conflict (defect_id) do nothing;

-- ¿El usuario actual puede ver y editar las respuestas de este defecto?
create or replace function private.can_edit_defect(p_defect_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_profile_role() = 'admin'
    or exists (
      select 1 from public.defects d
      join public.tlbs t on t.id = d.tlb_id
      where d.id = p_defect_id and private.has_teacher_module(t.module_id)
    );
$$;
revoke all on function private.can_edit_defect(uuid) from public, anon;
grant execute on function private.can_edit_defect(uuid) to authenticated;

alter table public.defect_answers enable row level security;
create policy defect_answers_read on public.defect_answers for select to authenticated
  using (private.can_edit_defect(defect_id));
create policy defect_answers_insert on public.defect_answers for insert to authenticated
  with check (private.can_edit_defect(defect_id));
create policy defect_answers_update on public.defect_answers for update to authenticated
  using (private.can_edit_defect(defect_id)) with check (private.can_edit_defect(defect_id));
create policy defect_answers_delete on public.defect_answers for delete to authenticated
  using (private.can_edit_defect(defect_id));
grant select, insert, update, delete on public.defect_answers to authenticated;
revoke all on public.defect_answers from anon;
alter publication supabase_realtime add table public.defect_answers;

-- ---------------------------------------------------------------------------
-- 2. Funciones que creaban defectos con respuesta
-- ---------------------------------------------------------------------------
create or replace function public.add_defect_to_tlb(p_tlb_id uuid, p_defect_number integer, p_ata text, p_pirep text, p_defect_description text, p_correct_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_module_id text;
  v_defect_id uuid;
  v_defect_number integer;
begin
  if private.current_profile_role() is null
    or private.current_profile_role() not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para añadir defectos.';
  end if;
  if nullif(trim(p_ata), '') is null
    or nullif(trim(p_defect_description), '') is null
    or nullif(trim(p_correct_action), '') is null then
    raise exception using errcode = '22023', message = 'ATA, defecto y acción correctiva son obligatorios.';
  end if;

  select module_id into v_module_id from public.tlbs where id = p_tlb_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'TLB no encontrado.';
  end if;
  if private.current_profile_role() = 'profesor' and not private.has_teacher_module(v_module_id) then
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
  if private.current_profile_role() is null or private.current_profile_role() not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para crear un TLB.';
  end if;
  if private.current_profile_role() = 'profesor' and not private.has_teacher_module(p_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado este módulo.';
  end if;
  select id, ata into v_practice from public.practices where id::text = p_practice_id and module_id = p_module_id;
  if not found then
    raise exception using errcode = '23503', message = 'La práctica no pertenece al módulo seleccionado.';
  end if;
  select type, registration, msn into v_aircraft from public.aircraft where id::text = p_aircraft_id;
  if not found then
    raise exception using errcode = '23503', message = 'Aeronave no encontrada.';
  end if;
  if nullif(trim(p_defect_description), '') is null or nullif(trim(p_correct_action), '') is null then
    raise exception using errcode = '22023', message = 'El defecto y la acción correctiva son obligatorios.';
  end if;

  insert into public.tlbs (module_id, practice_id, aircraft, registration, msn, date, teacher_name, published, crs)
  values (
    p_module_id, p_practice_id, v_aircraft.type, v_aircraft.registration, v_aircraft.msn,
    p_date, p_teacher_name, false,
    'CERTIFICATE OF RELEASE TO SERVICE - CERTIFIES THAT THE WORK SPECIFIED WAS CARRIED OUT IN ACCORDANCE WITH PART-145'
  ) returning * into v_tlb;

  insert into public.defects (tlb_id, defect_number, ata, pirep, defect_description)
  values (v_tlb.id, 1, v_practice.ata, 'CPT', trim(p_defect_description))
  returning * into v_defect;

  insert into public.defect_answers (defect_id, correct_action) values (v_defect.id, trim(p_correct_action));

  return jsonb_build_object('tlb', to_jsonb(v_tlb), 'defect', to_jsonb(v_defect) || jsonb_build_object('correct_action', trim(p_correct_action)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Importar copias: tabla nueva y copias antiguas con defects.correct_action
-- ---------------------------------------------------------------------------
create or replace function public.admin_import_academic_backup(p_tables jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  table_name text;
  table_rows jsonb;
  inserted_count integer;
  result jsonb := '{}'::jsonb;
  import_order text[] := array[
    'modules', 'students', 'student_profiles', 'student_modules', 'teacher_modules',
    'practices', 'aircraft', 'videos', 'tlbs', 'defects', 'defect_answers', 'practice_records'
  ];
begin
  if private.current_profile_role() is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'Solo administración puede importar copias.';
  end if;
  if jsonb_typeof(p_tables) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'El contenido del backup no es válido.';
  end if;

  foreach table_name in array import_order loop
    table_rows := p_tables -> table_name;
    if table_rows is null then
      result := result || jsonb_build_object(table_name, 0);
      continue;
    end if;
    if jsonb_typeof(table_rows) is distinct from 'array' then
      raise exception using errcode = '22023', message = format('La tabla %s debe ser una lista.', table_name);
    end if;
    execute format(
      'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1) on conflict do nothing',
      table_name, table_name
    ) using table_rows;
    get diagnostics inserted_count = row_count;
    result := result || jsonb_build_object(table_name, inserted_count);

    -- Copias anteriores a esta migración: la respuesta venía dentro de cada defecto.
    if table_name = 'defects' then
      insert into public.defect_answers (defect_id, correct_action)
      select (d ->> 'id')::uuid, d ->> 'correct_action'
      from jsonb_array_elements(table_rows) d
      where d ? 'correct_action' and d ->> 'correct_action' is not null
        and exists (select 1 from public.defects x where x.id = (d ->> 'id')::uuid)
      on conflict (defect_id) do nothing;
    end if;
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fuera la columna antigua
-- ---------------------------------------------------------------------------
alter table public.defects drop column correct_action;
