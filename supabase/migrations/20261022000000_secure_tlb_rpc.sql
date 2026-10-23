create or replace function public.toggle_tlb_publish(
  p_tlb_id uuid,
  p_published boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module_id text;
begin
  if private.current_profile_role() is null
    or private.current_profile_role() not in ('admin', 'profesor') then
    raise exception using errcode = '42501', message = 'No autorizado para publicar TLB.';
  end if;

  select module_id into v_module_id
  from public.tlbs
  where id = p_tlb_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'TLB no encontrado.';
  end if;
  if private.current_profile_role() = 'profesor'
    and not private.has_teacher_module(v_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado el módulo de este TLB.';
  end if;

  update public.tlbs
  set published = p_published
  where id = p_tlb_id;
end;
$$;

create or replace function public.add_defect_to_tlb(
  p_tlb_id uuid,
  p_defect_number integer,
  p_ata text,
  p_pirep text,
  p_defect_description text,
  p_correct_action text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  select module_id into v_module_id
  from public.tlbs
  where id = p_tlb_id
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'TLB no encontrado.';
  end if;
  if private.current_profile_role() = 'profesor'
    and not private.has_teacher_module(v_module_id) then
    raise exception using errcode = '42501', message = 'No tienes asignado el módulo de este TLB.';
  end if;

  select greatest(
    coalesce(p_defect_number, 1),
    coalesce(max(defect_number) + 1, 1)
  ) into v_defect_number
  from public.defects
  where tlb_id = p_tlb_id;

  insert into public.defects (
    tlb_id, defect_number, ata, pirep, defect_description, correct_action
  ) values (
    p_tlb_id, v_defect_number, trim(p_ata), nullif(trim(p_pirep), ''),
    trim(p_defect_description), trim(p_correct_action)
  ) returning id into v_defect_id;

  return v_defect_id;
end;
$$;

revoke all on function public.toggle_tlb_publish(uuid, boolean) from public, anon;
revoke all on function public.add_defect_to_tlb(uuid, integer, text, text, text, text) from public, anon;
grant execute on function public.toggle_tlb_publish(uuid, boolean) to authenticated;
grant execute on function public.add_defect_to_tlb(uuid, integer, text, text, text, text) to authenticated;