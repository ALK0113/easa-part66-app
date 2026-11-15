-- Alta por escuela y verificación. 2026-11-17
-- · Cada escuela tiene un código para que alumnos y profesores se registren en ella.
-- · Toda cuenta nueva queda «pendiente» hasta que la aprueba la escuela:
--     profesores → supervisor (o admin); alumnos → supervisor o un profesor de la escuela.
-- · Mientras está pendiente no tiene rol efectivo: no ve datos de la escuela.
-- · Las cuentas que crea administración o supervisión (funciones de servidor) nacen activas.

-- ---------------------------------------------------------------------------
-- 1. Código de escuela
-- ---------------------------------------------------------------------------
create or replace function private.new_join_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- sin 0/O ni 1/I
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.schools where join_code = code);
  end loop;
  return code;
end;
$$;
revoke all on function private.new_join_code() from public, anon;
grant execute on function private.new_join_code() to authenticated; -- lo evalúa el default de schools.join_code

alter table public.schools add column if not exists join_code text;
update public.schools set join_code = private.new_join_code() where join_code is null;
alter table public.schools
  alter column join_code set not null,
  alter column join_code set default private.new_join_code();
create unique index if not exists schools_join_code_key on public.schools (join_code);

-- Normaliza lo que escribe el usuario: «abcd-2345 » → «ABCD2345»
create or replace function private.normalize_join_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Pantalla de registro: comprueba el código y devuelve solo el nombre de la escuela
create or replace function public.check_join_code(p_code text)
returns text language sql stable security definer set search_path = '' as $$
  select name from public.schools where join_code = private.normalize_join_code(p_code);
$$;
revoke all on function public.check_join_code(text) from public;
grant execute on function public.check_join_code(text) to anon, authenticated;

create or replace function public.regenerate_join_code(p_school_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_code text := private.new_join_code();
begin
  if not private.can_manage_school(p_school_id) then
    raise exception using errcode = '42501', message = 'No puedes cambiar el código de esta escuela.';
  end if;
  update public.schools set join_code = v_code where id = p_school_id;
  perform private.log_admin_action('regenerate_join_code', 'school', p_school_id, null);
  return v_code;
end;
$$;
revoke all on function public.regenerate_join_code(uuid) from public, anon;
grant execute on function public.regenerate_join_code(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Estado del perfil
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists status text;
update public.profiles set status = 'activo' where status is null;
alter table public.profiles
  alter column status set default 'pendiente',
  alter column status set not null;
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pendiente', 'activo', 'rechazado'));
-- `authenticated` solo tiene UPDATE por columnas (bio, full_name, phone, role):
-- el estado solo lo cambian las funciones de abajo y el servidor.

-- ---------------------------------------------------------------------------
-- 3. Sin rol efectivo hasta estar activo
-- ---------------------------------------------------------------------------
create or replace function private.is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and status = 'activo');
$$;
revoke all on function private.is_active() from public, anon;
grant execute on function private.is_active() to authenticated;

create or replace function private.current_profile_role()
returns text language sql stable security definer set search_path = '' as $$
  select role::text from public.profiles where id = auth.uid() and status = 'activo' limit 1;
$$;

create or replace function private.current_school_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select sp.school_id
  from public.school_profiles sp
  join public.profiles p on p.id = sp.profile_id and p.status = 'activo'
  where sp.profile_id = (select auth.uid())
  order by sp.created_at desc
  limit 1;
$$;

create or replace function private.is_school_member(p_school_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_global_admin() or (private.is_active() and exists (
    select 1 from public.school_profiles sp
    where sp.school_id = p_school_id and sp.profile_id = (select auth.uid())));
$$;

create or replace function private.can_view_profile(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_target = (select auth.uid())
    or private.is_global_admin()
    or (private.is_active() and exists (
      select 1
      from public.profiles t
      join public.school_profiles st on st.profile_id = t.id
      join public.school_profiles su on su.school_id = st.school_id
                                    and su.profile_id = (select auth.uid())
      where t.id = p_target
        and (t.role <> 'alumno'
             or private.is_supervisor()
             or private.is_teacher_for_profile(t.id))
    ));
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'activo');
$$;

create or replace function public.check_is_admin()
returns boolean language sql security definer set search_path = 'public' as $$
  select role = 'admin' and status = 'activo' from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 4. Alta: un único trigger que lee el código de escuela
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop trigger if exists assign_default_school on public.profiles;
drop function if exists private.assign_default_school();

create or replace function public.handle_new_auth_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_code text := nullif(private.normalize_join_code(new.raw_user_meta_data ->> 'join_code'), '');
  v_school uuid;
  -- Desde el registro solo se puede pedir alumno o profesor
  v_role text := case when new.raw_user_meta_data ->> 'requested_role' = 'profesor' then 'profesor' else 'alumno' end;
begin
  if v_code is not null then
    select id into v_school from public.schools where join_code = v_code;
    if v_school is null then
      raise exception using errcode = '22023', message = 'Código de escuela no válido.';
    end if;
  end if;

  insert into public.profiles (id, full_name, email, role, status)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email, v_role, 'pendiente')
  on conflict (id) do update
    set full_name = coalesce(nullif(profiles.full_name, ''), excluded.full_name),
        email = coalesce(profiles.email, excluded.email);

  if v_school is not null then
    insert into public.school_profiles (profile_id, school_id) values (new.id, v_school)
    on conflict (profile_id) do nothing;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Verificación
-- ---------------------------------------------------------------------------
-- ¿El usuario actual imparte algún módulo en este grupo?
create or replace function private.teaches_group(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active() and exists (
    select 1 from public.teaching_assignments
    where group_id = p_group_id and profile_id = (select auth.uid()));
$$;
revoke all on function private.teaches_group(uuid) from public, anon;
grant execute on function private.teaches_group(uuid) to authenticated;

-- ¿Puede el usuario actual aprobar o rechazar este perfil?
create or replace function private.can_review_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles t
    join public.school_profiles sp on sp.profile_id = t.id
    where t.id = p_profile_id
      and t.id <> (select auth.uid())
      and (private.can_manage_school(sp.school_id)
           or (t.role = 'alumno' and private.is_teaching_role() and sp.school_id = private.current_school_id()))
  );
$$;
revoke all on function private.can_review_profile(uuid) from public, anon;

-- Crea la ficha de alumno de un perfil (número siguiente libre en su escuela)
create or replace function private.create_student_for_profile(p_profile_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_student_id uuid;
  v_school_id uuid;
  v_name text;
  v_number integer;
begin
  select student_id into v_student_id from public.student_profiles where profile_id = p_profile_id;
  if v_student_id is not null then
    return v_student_id;
  end if;

  select sp.school_id, coalesce(nullif(trim(p.full_name), ''), p.email)
  into v_school_id, v_name
  from public.profiles p join public.school_profiles sp on sp.profile_id = p.id
  where p.id = p_profile_id;
  if v_school_id is null then
    raise exception using errcode = '23503', message = 'El perfil no pertenece a ninguna escuela.';
  end if;

  perform pg_advisory_xact_lock(hashtext('students.student_number'));
  select coalesce(max(student_number), 0) + 1 into v_number from public.students where school_id = v_school_id;

  insert into public.students (student_number, name, school_id)
  values (v_number, v_name, v_school_id)
  returning id into v_student_id;
  insert into public.student_private (student_id) values (v_student_id);
  insert into public.student_profiles (student_id, profile_id) values (v_student_id, p_profile_id);
  return v_student_id;
end;
$$;
revoke all on function private.create_student_for_profile(uuid) from public, anon, authenticated;

-- Solicitudes que puede revisar el usuario actual
create or replace function public.list_pending_profiles()
returns table (id uuid, full_name text, email text, role text, created_at timestamptz, school_id uuid, school_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.email, p.role, p.created_at, s.id, s.name
  from public.profiles p
  join public.school_profiles sp on sp.profile_id = p.id
  join public.schools s on s.id = sp.school_id
  where p.status = 'pendiente' and private.can_review_profile(p.id)
  order by p.created_at;
$$;
revoke all on function public.list_pending_profiles() from public, anon;
grant execute on function public.list_pending_profiles() to authenticated;

-- Aprueba una solicitud. A un alumno se le crea su ficha y, si se indica,
-- se le matricula en un grupo del curso con los módulos que ya cursa ese grupo.
create or replace function public.approve_profile(p_profile_id uuid, p_group_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile record;
  v_school uuid;
  v_student uuid;
  g record;
begin
  select p.id, p.role, p.status, sp.school_id into v_profile
  from public.profiles p left join public.school_profiles sp on sp.profile_id = p.id
  where p.id = p_profile_id;
  if v_profile.id is null then
    raise exception using errcode = 'P0002', message = 'Solicitud no encontrada.';
  end if;
  if v_profile.status <> 'pendiente' then
    raise exception using errcode = '22023', message = 'Esta solicitud ya se revisó.';
  end if;
  if not private.can_review_profile(p_profile_id) then
    raise exception using errcode = '42501', message = case when v_profile.role = 'profesor'
      then 'Solo la supervisión de la escuela puede aprobar profesores.'
      else 'No puedes aprobar esta solicitud.' end;
  end if;
  v_school := v_profile.school_id;

  if p_group_id is not null then
    if v_profile.role <> 'alumno' then
      raise exception using errcode = '22023', message = 'Solo se matricula en un grupo a los alumnos.';
    end if;
    select cg.id, cg.academic_year_id, cg.degree_id, cg.level, y.school_id into g
    from public.class_groups cg join public.academic_years y on y.id = cg.academic_year_id
    where cg.id = p_group_id;
    if g.id is null or g.school_id <> v_school then
      raise exception using errcode = '23503', message = 'El grupo no es de la escuela del alumno.';
    end if;
    if not private.can_manage_school(v_school) and not private.teaches_group(p_group_id) then
      raise exception using errcode = '42501', message = 'Solo puedes matricular en grupos donde das clase.';
    end if;
  end if;

  update public.profiles set status = 'activo' where id = p_profile_id;

  if v_profile.role = 'alumno' then
    v_student := private.create_student_for_profile(p_profile_id);
    if p_group_id is not null then
      insert into public.enrollments (student_id, academic_year_id, group_id, level)
      values (v_student, g.academic_year_id, g.id, g.level)
      on conflict (student_id, academic_year_id) do nothing;

      insert into public.module_enrollments (student_id, degree_module_id, academic_year_id, group_id)
      select v_student, x.degree_module_id, g.academic_year_id, g.id
      from (
        select distinct degree_module_id from public.module_enrollments where group_id = g.id
        union
        -- Grupo aún vacío: los módulos de su grado y curso
        select dm.id from public.degree_modules dm
        where dm.degree_id = g.degree_id and dm.level = g.level
          and not exists (select 1 from public.module_enrollments where group_id = g.id)
      ) x
      on conflict (student_id, degree_module_id, academic_year_id) do nothing;
    end if;
  end if;

  perform private.log_admin_action('approve_profile', 'profile', p_profile_id,
    jsonb_build_object('role', v_profile.role, 'group_id', p_group_id));
  return jsonb_build_object('profile_id', p_profile_id, 'student_id', v_student);
end;
$$;
revoke all on function public.approve_profile(uuid, uuid) from public, anon;
grant execute on function public.approve_profile(uuid, uuid) to authenticated;

create or replace function public.reject_profile(p_profile_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_review_profile(p_profile_id) then
    raise exception using errcode = '42501', message = 'No puedes rechazar esta solicitud.';
  end if;
  update public.profiles set status = 'rechazado' where id = p_profile_id and status = 'pendiente';
  if not found then
    raise exception using errcode = '22023', message = 'Esta solicitud ya se revisó.';
  end if;
  perform private.log_admin_action('reject_profile', 'profile', p_profile_id, null);
end;
$$;
revoke all on function public.reject_profile(uuid) from public, anon;
grant execute on function public.reject_profile(uuid) to authenticated;
