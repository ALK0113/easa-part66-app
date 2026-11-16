-- TLB firmado: el alumno rellena sus respuestas, firma y la entrega queda registrada sin poder editarse.
-- Número de control único «yyyymmddhhmmss/<práctica>» y número de revisión. Para cambiar una entrega
-- firmada, el alumno solicita el cambio al profesor; si se aprueba, la versión firmada se archiva y la
-- entrega se reabre con la revisión siguiente (mismo número de control).

alter table public.tlb_submissions
  add column if not exists control_number text,
  add column if not exists revision integer not null default 0,
  add column if not exists signed_at timestamptz,
  add column if not exists signed_name text;
create unique index if not exists tlb_submissions_control_number_key on public.tlb_submissions (control_number) where control_number is not null;

-- Versiones firmadas anteriores (se guardan al aprobar un cambio)
create table if not exists public.tlb_submission_revisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.tlb_submissions(id) on delete cascade,
  revision integer not null,
  control_number text,
  defect_responses jsonb not null,
  signed_at timestamptz,
  signed_name text,
  archived_at timestamptz not null default now(),
  unique (submission_id, revision)
);

-- Solicitudes de cambio del alumno al profesor
create table if not exists public.tlb_change_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.tlb_submissions(id) on delete cascade,
  revision integer not null,
  reason text not null check (length(trim(reason)) between 1 and 500),
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobada', 'rechazada')),
  response text check (length(response) <= 500),
  requested_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz
);
create unique index if not exists tlb_change_requests_one_pending on public.tlb_change_requests (submission_id) where status = 'pendiente';

-- Quién revisa una entrega: el profesor del módulo de ese alumno, la dirección del centro o el admin
create or replace function private.can_review_tlb_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.tlb_submissions s join public.tlbs t on t.id = s.tlb_id
    where s.id = p_submission_id
      and (private.is_global_admin()
        or private.can_manage_school(t.school_id)
        or (private.has_teacher_module(t.module_id) and private.is_teacher_for_profile(s.student_id)))
  );
$$;

alter table public.tlb_submission_revisions enable row level security;
alter table public.tlb_change_requests enable row level security;
create policy tlb_submission_revisions_read on public.tlb_submission_revisions for select to authenticated
  using (exists (select 1 from public.tlb_submissions s where s.id = submission_id and s.student_id = (select auth.uid()))
    or private.can_review_tlb_submission(submission_id));
create policy tlb_change_requests_read on public.tlb_change_requests for select to authenticated
  using (exists (select 1 from public.tlb_submissions s where s.id = submission_id and s.student_id = (select auth.uid()))
    or private.can_review_tlb_submission(submission_id));
grant select on public.tlb_submission_revisions, public.tlb_change_requests to authenticated;

-- Bloqueo: firma, número de control y revisión solo los ponen las funciones; una entrega firmada no se edita
create or replace function private.trg_tlb_submissions_lock()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if coalesce(current_setting('app.tlb_rpc', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.signed_at := null; new.signed_name := null; new.control_number := null; new.revision := 0; new.completed_at := null;
    return new;
  end if;
  if old.signed_at is not null then
    raise exception using errcode = '42501', message = 'TLB firmado: no se puede editar. Solicita un cambio al profesor.';
  end if;
  new.signed_at := old.signed_at; new.signed_name := old.signed_name; new.control_number := old.control_number;
  new.revision := old.revision; new.completed_at := old.completed_at;
  return new;
end;
$$;

drop trigger if exists tlb_submissions_lock on public.tlb_submissions;
create trigger tlb_submissions_lock before insert or update on public.tlb_submissions
  for each row execute function private.trg_tlb_submissions_lock();

-- Firmar y entregar (alumno)
create or replace function public.tlb_sign(p_tlb_id uuid, p_signed_name text)
returns table(control_number text, revision integer, signed_at timestamptz)
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.tlb_submissions;
  v_practice text;
  v_ts timestamp;
  v_number text;
begin
  select * into s from public.tlb_submissions where tlb_id = p_tlb_id and student_id = (select auth.uid());
  if s.id is null then raise exception using errcode = 'P0002', message = 'Aún no has respondido este TLB.'; end if;
  if s.signed_at is not null then raise exception using errcode = '22023', message = 'Este TLB ya está firmado.'; end if;
  if length(trim(coalesce(p_signed_name, ''))) < 3 then raise exception using errcode = '22023', message = 'Escribe tu nombre completo para firmar.'; end if;
  if exists (select 1 from public.defects d where d.tlb_id = p_tlb_id
             and length(trim(coalesce(s.defect_responses ->> d.id::text, ''))) = 0) then
    raise exception using errcode = '22023', message = 'Responde todas las acciones antes de firmar.';
  end if;

  v_number := s.control_number;
  if v_number is null then
    select t.practice_id into v_practice from public.tlbs t where t.id = p_tlb_id;
    v_ts := date_trunc('second', now() at time zone 'Europe/Madrid');
    loop
      v_number := to_char(v_ts, 'YYYYMMDDHH24MISS') || '/' || coalesce(v_practice, 'SIN-PRACTICA');
      exit when not exists (select 1 from public.tlb_submissions x where x.control_number = v_number);
      v_ts := v_ts + interval '1 second';
    end loop;
  end if;

  perform set_config('app.tlb_rpc', 'on', true);
  update public.tlb_submissions x
  set signed_at = now(), signed_name = trim(p_signed_name), completed_at = now()::timestamp, control_number = v_number
  where x.id = s.id;
  perform set_config('app.tlb_rpc', '', true);

  return query select x.control_number, x.revision, x.signed_at from public.tlb_submissions x where x.id = s.id;
end;
$$;

-- Solicitar un cambio de una entrega firmada (alumno)
create or replace function public.tlb_request_change(p_tlb_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  s public.tlb_submissions;
begin
  select * into s from public.tlb_submissions where tlb_id = p_tlb_id and student_id = (select auth.uid());
  if s.id is null or s.signed_at is null then raise exception using errcode = '22023', message = 'Solo se pueden pedir cambios de un TLB firmado.'; end if;
  if exists (select 1 from public.tlb_change_requests where submission_id = s.id and status = 'pendiente') then
    raise exception using errcode = '22023', message = 'Ya tienes una solicitud de cambio pendiente.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception using errcode = '22023', message = 'Explica qué quieres cambiar.'; end if;
  insert into public.tlb_change_requests (submission_id, revision, reason) values (s.id, s.revision, trim(p_reason));
end;
$$;

-- Aprobar o rechazar una solicitud (profesor del módulo o dirección)
create or replace function public.tlb_resolve_change(p_request_id uuid, p_approve boolean, p_response text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  r public.tlb_change_requests;
  s public.tlb_submissions;
begin
  select * into r from public.tlb_change_requests where id = p_request_id;
  if r.id is null then raise exception using errcode = 'P0002', message = 'Solicitud no encontrada.'; end if;
  if not private.can_review_tlb_submission(r.submission_id) then
    raise exception using errcode = '42501', message = 'Solo el profesor del módulo o la dirección pueden resolverla.';
  end if;
  if r.status <> 'pendiente' then raise exception using errcode = '22023', message = 'Esta solicitud ya está resuelta.'; end if;

  if p_approve then
    select * into s from public.tlb_submissions where id = r.submission_id;
    insert into public.tlb_submission_revisions (submission_id, revision, control_number, defect_responses, signed_at, signed_name)
    values (s.id, s.revision, s.control_number, s.defect_responses, s.signed_at, s.signed_name)
    on conflict (submission_id, revision) do nothing;
    perform set_config('app.tlb_rpc', 'on', true);
    update public.tlb_submissions
    set signed_at = null, signed_name = null, completed_at = null, revision = s.revision + 1
    where id = s.id;
    perform set_config('app.tlb_rpc', '', true);
  end if;

  update public.tlb_change_requests
  set status = case when p_approve then 'aprobada' else 'rechazada' end,
      response = nullif(trim(coalesce(p_response, '')), ''),
      resolved_by = (select auth.uid()), resolved_at = now()
  where id = r.id;
end;
$$;

revoke execute on function public.tlb_sign(uuid, text) from public, anon;
revoke execute on function public.tlb_request_change(uuid, text) from public, anon;
revoke execute on function public.tlb_resolve_change(uuid, boolean, text) from public, anon;
grant execute on function public.tlb_sign(uuid, text) to authenticated;
grant execute on function public.tlb_request_change(uuid, text) to authenticated;
grant execute on function public.tlb_resolve_change(uuid, boolean, text) to authenticated;
