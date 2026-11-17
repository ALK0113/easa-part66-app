-- Alta en dos pasos. Tras confirmar el correo, el usuario (aún «pendiente») rellena su ficha: datos personales y
-- curso + módulos (alumno) o módulo + grupo (profesor). La coordinación la revisa: corrige y aprueba, la devuelve
-- con un motivo o la rechaza. Al aprobar se crean la ficha del alumno y su matrícula, o las asignaciones del profesor.
-- Después, los datos personales solo los cambia la coordinación.
-- Datos sensibles (DNI, teléfono, dirección, contacto de emergencia) opcionales; de la fecha de nacimiento solo el año.

begin;

-- Ficha del alumno: año de nacimiento en lugar de la fecha completa (birth_date deja de usarse)
alter table public.students add column if not exists birth_year smallint check (birth_year is null or birth_year between 1900 and 2100);

create table if not exists public.signup_forms (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  role text not null check (role in ('alumno', 'profesor')),
  full_name text check (full_name is null or length(full_name) <= 150),
  dni text check (dni is null or length(dni) <= 20),
  birth_year smallint check (birth_year is null or birth_year between 1900 and 2100),
  phone text check (phone is null or length(phone) <= 30),
  address text check (address is null or length(address) <= 250),
  emergency_name text check (emergency_name is null or length(emergency_name) <= 150),
  emergency_phone text check (emergency_phone is null or length(emergency_phone) <= 30),
  level smallint not null default 1 check (level between 1 and 6),
  module_ids uuid[] not null default '{}',
  teaching jsonb not null default '[]',
  status text not null default 'borrador' check (status in ('borrador', 'enviado', 'devuelto')),
  return_reason text check (return_reason is null or length(return_reason) <= 1000),
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.signup_forms enable row level security;
create policy signup_forms_own_read on public.signup_forms for select to authenticated using (profile_id = (select auth.uid()));
grant select on public.signup_forms to authenticated;

-- Lo que necesita el formulario: cursos, módulos y grupos del curso actual de su escuela (aunque aún no esté activo)
create or replace function public.signup_options()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with me as (
    select p.id, p.role, sp.school_id from public.profiles p join public.school_profiles sp on sp.profile_id = p.id
    where p.id = (select auth.uid())
  ),
  yr as (select y.id from public.academic_years y join me on me.school_id = y.school_id where y.is_current)
  select jsonb_build_object(
    'school_name', (select s.name from public.schools s join me on me.school_id = s.id),
    'role', (select role from me),
    'modules', coalesce((select jsonb_agg(jsonb_build_object('id', dm.id, 'module_id', dm.module_id, 'name', m.name, 'kind', dm.kind, 'level', dm.level, 'degree_id', d.id, 'degree', d.code) order by dm.level, dm.module_id, dm.kind)
      from public.degree_modules dm join public.degrees d on d.id = dm.degree_id join public.modules m on m.id = dm.module_id
      where d.school_id = (select school_id from me)), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'level', g.level, 'name', g.name, 'degree_id', g.degree_id) order by g.level, g.name)
      from public.class_groups g where g.academic_year_id = (select id from yr)), '[]')
  );
$function$;

-- Valida y guarda los datos del formulario (lo usan el usuario al rellenarlo y la coordinación al corregirlo)
create or replace function private.apply_signup_data(p_profile_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_school uuid;
  v_role text;
  -- Listas vacías o ausentes (null) cuentan como vacías
  v_modules uuid[] := coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(
    case when jsonb_typeof(p_data -> 'module_ids') = 'array' then p_data -> 'module_ids' else '[]'::jsonb end)), '{}');
  v_teaching jsonb := case when jsonb_typeof(p_data -> 'teaching') = 'array' then p_data -> 'teaching' else '[]'::jsonb end;
  v_year uuid;
begin
  select sp.school_id, p.role into v_school, v_role from public.profiles p join public.school_profiles sp on sp.profile_id = p.id where p.id = p_profile_id;
  if v_school is null then raise exception using errcode = '23503', message = 'La cuenta no pertenece a ninguna escuela.'; end if;
  select id into v_year from public.academic_years where school_id = v_school and is_current;

  if exists (select 1 from unnest(v_modules) mid where not exists (
      select 1 from public.degree_modules dm join public.degrees d on d.id = dm.degree_id where dm.id = mid and d.school_id = v_school)) then
    raise exception using errcode = '22023', message = 'Algún módulo no es de tu escuela.';
  end if;
  if exists (select 1 from jsonb_array_elements(v_teaching) t where not exists (
      select 1 from public.degree_modules dm join public.class_groups g on g.degree_id = dm.degree_id
      where dm.id = (t ->> 'degree_module_id')::uuid and g.id = (t ->> 'group_id')::uuid and g.academic_year_id = v_year)) then
    raise exception using errcode = '22023', message = 'Algún módulo o grupo no es de tu escuela o no se imparte este curso.';
  end if;

  insert into public.signup_forms as f (profile_id, school_id, role, full_name, dni, birth_year, phone, address, emergency_name, emergency_phone, level, module_ids, teaching, updated_at)
  values (p_profile_id, v_school, v_role,
    nullif(trim(p_data ->> 'full_name'), ''), nullif(trim(p_data ->> 'dni'), ''), nullif(p_data ->> 'birth_year', '')::smallint,
    nullif(trim(p_data ->> 'phone'), ''), nullif(trim(p_data ->> 'address'), ''), nullif(trim(p_data ->> 'emergency_name'), ''),
    nullif(trim(p_data ->> 'emergency_phone'), ''), coalesce(nullif(p_data ->> 'level', '')::smallint, 1),
    case when v_role = 'alumno' then v_modules else '{}' end,
    case when v_role = 'profesor' then v_teaching else '[]' end, now())
  on conflict (profile_id) do update set
    full_name = excluded.full_name, dni = excluded.dni, birth_year = excluded.birth_year, phone = excluded.phone,
    address = excluded.address, emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone,
    level = excluded.level, module_ids = excluded.module_ids, teaching = excluded.teaching, updated_at = now();
end;
$function$;

-- El usuario pendiente guarda su ficha (borrador) o la envía a coordinación
create or replace function public.save_signup_form(p_data jsonb, p_submit boolean default false)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  f public.signup_forms;
begin
  select status into v_status from public.profiles where id = v_uid;
  if v_status is distinct from 'pendiente' then raise exception using errcode = '42501', message = 'Tu cuenta ya no está pendiente de alta.'; end if;
  if exists (select 1 from public.signup_forms where profile_id = v_uid and status = 'enviado') then
    raise exception using errcode = '22023', message = 'Ya la has enviado: espera a que la coordinación la revise.';
  end if;
  perform private.apply_signup_data(v_uid, p_data);
  select * into f from public.signup_forms where profile_id = v_uid;
  if p_submit then
    if f.full_name is null then raise exception using errcode = '22023', message = 'Falta tu nombre completo.'; end if;
    if f.role = 'alumno' and cardinality(f.module_ids) = 0 then raise exception using errcode = '22023', message = 'Marca al menos un módulo.'; end if;
    if f.role = 'profesor' and jsonb_array_length(f.teaching) = 0 then raise exception using errcode = '22023', message = 'Marca al menos un módulo y grupo que impartes.'; end if;
    update public.signup_forms set status = 'enviado', submitted_at = now(), return_reason = null where profile_id = v_uid;
    return 'enviado';
  end if;
  return f.status;
end;
$function$;

-- Solicitudes con su ficha y las marcas (rojo = profesor, ámbar = curso distinto de 1º)
create or replace function public.list_signup_requests()
returns table (id uuid, email text, role text, created_at timestamptz, school_id uuid, school_name text, form jsonb, flag text)
language sql
stable
security definer
set search_path to ''
as $function$
  -- Coordinación y admin: todas las de su escuela. Profesorado: las de alumnos de su escuela.
  select p.id, p.email, p.role, p.created_at, s.id, s.name, to_jsonb(f.*),
    case when p.role = 'profesor' then 'profesor' when f.level is not null and f.level <> 1 then 'curso' end
  from public.profiles p
  join public.school_profiles sp on sp.profile_id = p.id
  join public.schools s on s.id = sp.school_id
  left join public.signup_forms f on f.profile_id = p.id
  where p.status = 'pendiente' and private.can_review_profile(p.id)
  order by (f.status = 'enviado') desc nulls last, f.submitted_at nulls last, p.created_at;
$function$;

-- Revisión: approve (con correcciones; grupo opcional), return (con motivo) o reject. El profesorado revisa altas de alumnos.
create or replace function public.review_signup(p_profile_id uuid, p_action text, p_data jsonb default null,
  p_group_id uuid default null, p_reason text default null, p_extra_groups jsonb default '{}')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_school uuid;
  v_role text;
  v_status text;
  v_email text;
  v_manager boolean;
  f public.signup_forms;
  v_gid uuid;
  v_glevel smallint;
  v_gdegree uuid;
  v_gyear uuid;
  v_student uuid;
  v_dm record;
  v_group uuid;
begin
  select sp.school_id, p.role, p.status, p.email into v_school, v_role, v_status, v_email
  from public.profiles p join public.school_profiles sp on sp.profile_id = p.id where p.id = p_profile_id;
  if v_school is null then raise exception using errcode = 'P0002', message = 'Solicitud no encontrada.'; end if;
  -- Coordinación y admin revisan todo; el profesorado, las altas de alumnos de su escuela
  if not private.can_review_profile(p_profile_id) then
    raise exception using errcode = '42501', message = case when v_role = 'profesor'
      then 'Solo la coordinación puede revisar las altas de profesores.' else 'No puedes revisar esta solicitud.' end;
  end if;
  v_manager := private.can_manage_school(v_school);
  if v_status <> 'pendiente' then raise exception using errcode = '22023', message = 'Esta solicitud ya se revisó.'; end if;
  if p_action not in ('approve', 'return', 'reject') then raise exception using errcode = '22023', message = 'Acción no válida.'; end if;

  if p_action = 'reject' then
    update public.profiles set status = 'rechazado' where id = p_profile_id;
    perform private.log_admin_action('reject_signup', 'profile', p_profile_id, jsonb_build_object('reason', p_reason));
    return jsonb_build_object('status', 'rechazado');
  end if;

  if p_data is not null then perform private.apply_signup_data(p_profile_id, p_data); end if;

  if p_action = 'return' then
    if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception using errcode = '22023', message = 'Escribe el motivo para que sepa qué corregir.'; end if;
    update public.signup_forms set status = 'devuelto', return_reason = trim(p_reason) where profile_id = p_profile_id;
    perform private.log_admin_action('return_signup', 'profile', p_profile_id, jsonb_build_object('reason', p_reason));
    return jsonb_build_object('status', 'devuelto');
  end if;

  select * into f from public.signup_forms where profile_id = p_profile_id;
  if f.profile_id is null then raise exception using errcode = '22023', message = 'Esta persona aún no ha rellenado su ficha.'; end if;
  if f.full_name is null then raise exception using errcode = '22023', message = 'Falta el nombre completo.'; end if;

  -- El grupo es opcional: sin grupo, el alumno queda activo y se le asigna más tarde (Escuela → Alumnos)
  if v_role = 'alumno' and p_group_id is not null then
    select cg.id, cg.level, cg.degree_id, cg.academic_year_id into v_gid, v_glevel, v_gdegree, v_gyear
    from public.class_groups cg join public.academic_years y on y.id = cg.academic_year_id and y.is_current
    where cg.id = p_group_id and y.school_id = v_school;
    if v_gid is null then raise exception using errcode = '22023', message = 'Ese grupo no es del curso actual de la escuela.'; end if;
    if not v_manager and not private.teaches_group(v_gid) then
      raise exception using errcode = '42501', message = 'Solo puedes asignar grupos en los que das clase.';
    end if;
  end if;

  update public.profiles set full_name = f.full_name, phone = coalesce(f.phone, phone), status = 'activo' where id = p_profile_id;

  if v_role = 'alumno' then
    v_student := private.create_student_for_profile(p_profile_id);
    -- La ficha protegida solo deja escribir a gestión: el alta aprobada vuelca sus datos con el permiso interno
    perform set_config('app.derived_labels', 'on', true);
    update public.students set name = f.full_name, dni = f.dni, birth_year = f.birth_year, email = v_email, phone = f.phone,
      address = f.address, emergency_name = f.emergency_name, emergency_phone = f.emergency_phone
    where id = v_student;
    perform set_config('app.derived_labels', 'off', true);
    if v_gid is not null then
      perform private.enroll_student_in_group(v_student, v_gid);
      -- Ajuste fino de módulos: solo coordinación y admin (el profesor deja el grupo; el resto lo hace coordinación)
      if v_manager then
        for v_dm in select dm.id from public.degree_modules dm where dm.degree_id = v_gdegree and dm.level = v_glevel and not (dm.id = any (f.module_ids)) loop
          perform public.enrollment_set_module(v_student, v_dm.id, 'no_cursa');
        end loop;
        for v_dm in select dm.id, dm.level, dm.degree_id from public.degree_modules dm
          where dm.id = any (f.module_ids) and not (dm.degree_id = v_gdegree and dm.level = v_glevel) loop
          v_group := nullif(p_extra_groups ->> v_dm.id::text, '')::uuid;
          if v_group is null then
            select cg.id into v_group from public.class_groups cg
            where cg.academic_year_id = v_gyear and cg.degree_id = v_dm.degree_id and cg.level = v_dm.level order by cg.name limit 1;
          end if;
          if v_group is not null then perform public.enrollment_set_module(v_student, v_dm.id, 'cursa', v_group); end if;
        end loop;
      end if;
    end if;
  else
    insert into public.teaching_assignments (profile_id, degree_module_id, group_id)
    select p_profile_id, (t ->> 'degree_module_id')::uuid, (t ->> 'group_id')::uuid
    from jsonb_array_elements(f.teaching) t
    where not exists (select 1 from public.teaching_assignments ta
                      where ta.profile_id = p_profile_id and ta.degree_module_id = (t ->> 'degree_module_id')::uuid and ta.group_id = (t ->> 'group_id')::uuid);
  end if;

  -- La ficha se guarda si queda algo por hacer (grupo o módulos), para que coordinación la consulte
  if v_role = 'profesor' or (v_gid is not null and v_manager) then
    delete from public.signup_forms where profile_id = p_profile_id;
  end if;
  perform private.log_admin_action('approve_signup', 'profile', p_profile_id, jsonb_build_object('role', v_role, 'group_id', p_group_id));
  return jsonb_build_object('status', 'activo', 'student_id', v_student, 'group', v_gid is not null);
end;
$function$;

-- Los datos personales (nombre y teléfono) solo los cambia la coordinación o administración
create or replace function private.trg_protect_profile_data()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or private.is_global_admin() then return new; end if;
  if private.is_supervisor() and old.id <> (select auth.uid()) and private.profile_in_my_school(old.id) then return new; end if;
  -- Al aprobar un alta pendiente, quien la revisa (coordinación o profesor) guarda el nombre y el teléfono de la ficha
  if old.status = 'pendiente' and old.id <> (select auth.uid()) and private.can_review_profile(old.id) then return new; end if;
  if new.full_name is distinct from old.full_name or new.phone is distinct from old.phone then
    raise exception using errcode = '42501', message = 'Tus datos solo los puede cambiar la coordinación de tu escuela.';
  end if;
  return new;
end;
$function$;

create trigger profiles_protect_data before update on public.profiles
  for each row execute function private.trg_protect_profile_data();

revoke all on function public.signup_options() from public, anon;
revoke all on function public.save_signup_form(jsonb, boolean) from public, anon;
revoke all on function public.list_signup_requests() from public, anon;
revoke all on function public.review_signup(uuid, text, jsonb, uuid, text, jsonb) from public, anon;
revoke all on function private.apply_signup_data(uuid, jsonb) from public, anon;
grant execute on function public.signup_options() to authenticated;
grant execute on function public.save_signup_form(jsonb, boolean) to authenticated;
grant execute on function public.list_signup_requests() to authenticated;
grant execute on function public.review_signup(uuid, text, jsonb, uuid, text, jsonb) to authenticated;

commit;
