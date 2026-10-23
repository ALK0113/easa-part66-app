create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role::text
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

revoke all on function private.current_profile_role() from public, anon;
grant execute on function private.current_profile_role() to authenticated;

create or replace function public.handle_new_auth_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    'alumno'
  )
  on conflict (id) do update
    set full_name = coalesce(nullif(profiles.full_name, ''), excluded.full_name),
      email = coalesce(profiles.email, excluded.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile_app on auth.users;
create trigger on_auth_user_created_profile_app
  after insert on auth.users
  for each row execute function public.handle_new_auth_profile();

create table if not exists public.student_profiles (
  student_id text primary key,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.student_modules (
  student_id text not null,
  module_id text not null,
  created_at timestamptz not null default now(),
  primary key (student_id, module_id)
);

create table if not exists public.teacher_modules (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  module_id text not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, module_id)
);

create table if not exists public.practice_records (
  student_id text not null,
  practice_id text not null,
  attendance text check (attendance in ('P', 'L', 'A')),
  evaluation text check (evaluation in ('Apto', 'No Apto')),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (student_id, practice_id)
);

create index if not exists practice_records_practice_id_idx
  on public.practice_records (practice_id);

create or replace function private.is_student_profile(p_student_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.student_profiles
    where student_id = p_student_id and profile_id = auth.uid()
  );
$$;

create or replace function private.is_student_in_module(p_module_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_modules sm
    join public.student_profiles sp on sp.student_id = sm.student_id
    where sp.profile_id = auth.uid() and sm.module_id = p_module_id
  );
$$;

create or replace function private.has_teacher_module(p_module_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.teacher_modules
    where profile_id = auth.uid() and module_id = p_module_id
  );
$$;

create or replace function private.is_teacher_for_student(p_student_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.student_modules sm
    join public.teacher_modules tm on tm.module_id = sm.module_id
    where sm.student_id = p_student_id and tm.profile_id = auth.uid()
  );
$$;

revoke all on function private.is_student_profile(text) from public, anon;
revoke all on function private.is_student_in_module(text) from public, anon;
revoke all on function private.has_teacher_module(text) from public, anon;
revoke all on function private.is_teacher_for_student(text) from public, anon;
grant execute on function private.is_student_profile(text) to authenticated;
grant execute on function private.is_student_in_module(text) to authenticated;
grant execute on function private.has_teacher_module(text) to authenticated;
grant execute on function private.is_teacher_for_student(text) to authenticated;

alter table public.student_profiles enable row level security;
alter table public.student_modules enable row level security;
alter table public.teacher_modules enable row level security;
alter table public.practice_records enable row level security;

grant select, insert, update, delete on public.student_profiles to authenticated;
grant select, insert, update, delete on public.student_modules to authenticated;
grant select, insert, update, delete on public.teacher_modules to authenticated;
grant select, insert, update, delete on public.practice_records to authenticated;

create policy student_profiles_read on public.student_profiles
  for select to authenticated
  using (
    private.current_profile_role() = 'admin'
    or profile_id = auth.uid()
    or private.is_teacher_for_student(student_id)
  );

create policy student_profiles_admin_write on public.student_profiles
  for all to authenticated
  using (private.current_profile_role() = 'admin')
  with check (private.current_profile_role() = 'admin');

create policy student_modules_read on public.student_modules
  for select to authenticated
  using (
    private.current_profile_role() = 'admin'
    or private.is_student_profile(student_id)
    or private.has_teacher_module(module_id)
  );

create policy student_modules_admin_write on public.student_modules
  for all to authenticated
  using (private.current_profile_role() = 'admin')
  with check (private.current_profile_role() = 'admin');

create policy teacher_modules_read on public.teacher_modules
  for select to authenticated
  using (
    private.current_profile_role() = 'admin'
    or profile_id = auth.uid()
  );

create policy teacher_modules_admin_write on public.teacher_modules
  for all to authenticated
  using (private.current_profile_role() = 'admin')
  with check (private.current_profile_role() = 'admin');

create policy practice_records_read on public.practice_records
  for select to authenticated
  using (
    private.current_profile_role() = 'admin'
    or private.is_student_profile(student_id)
    or exists (
      select 1
      from public.teacher_modules tm
      join public.practices p on p.module_id = tm.module_id
      where tm.profile_id = auth.uid()
        and p.id = practice_records.practice_id
    )
  );

create policy practice_records_teacher_write on public.practice_records
  for all to authenticated
  using (
    private.current_profile_role() = 'admin'
    or exists (
      select 1
      from public.teacher_modules tm
      join public.practices p on p.module_id = tm.module_id
      where tm.profile_id = auth.uid()
        and p.id = practice_records.practice_id
    )
  )
  with check (
    private.current_profile_role() = 'admin'
    or exists (
      select 1
      from public.teacher_modules tm
      join public.practices p on p.module_id = tm.module_id
      where tm.profile_id = auth.uid()
        and p.id = practice_records.practice_id
    )
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array['students', 'modules', 'practices', 'tlbs', 'defects', 'videos', 'aircraft'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = table_name || '_authenticated_read'
    ) then
      if table_name in ('modules', 'aircraft') then
        execute format(
          'create policy %I on public.%I for select to authenticated using (true)',
          table_name || '_authenticated_read', table_name
        );
      elsif table_name = 'videos' then
        execute format(
          'create policy %I on public.%I for select to authenticated using (private.current_profile_role() = ''admin'' or private.has_teacher_module(videos.module_id) or private.is_student_in_module(videos.module_id))',
          table_name || '_authenticated_read', table_name
        );
      elsif table_name = 'students' then
        execute format(
          'create policy %I on public.%I for select to authenticated using (private.current_profile_role() = ''admin'' or private.is_student_profile(students.id::text) or private.is_teacher_for_student(students.id::text))',
          table_name || '_authenticated_read', table_name
        );
      elsif table_name = 'practices' then
        execute format(
          'create policy %I on public.%I for select to authenticated using (private.current_profile_role() = ''admin'' or private.has_teacher_module(practices.module_id) or private.is_student_in_module(practices.module_id))',
          table_name || '_authenticated_read', table_name
        );
      elsif table_name = 'tlbs' then
        execute format(
          'create policy %I on public.%I for select to authenticated using (private.current_profile_role() = ''admin'' or private.has_teacher_module(tlbs.module_id) or (published = true and private.is_student_in_module(tlbs.module_id)))',
          table_name || '_authenticated_read', table_name
        );
      else
        execute format(
          'create policy %I on public.%I for select to authenticated using (private.current_profile_role() = ''admin'' or exists (select 1 from public.tlbs t where t.id = defects.tlb_id and private.has_teacher_module(t.module_id)) or exists (select 1 from public.tlbs t where t.id = defects.tlb_id and t.published = true and private.is_student_in_module(t.module_id)))',
          table_name || '_authenticated_read', table_name
        );
      end if;
    end if;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = table_name || '_staff_write'
    ) then
      if table_name in ('students', 'modules', 'aircraft') then
        execute format(
          'create policy %I on public.%I for all to authenticated using (private.current_profile_role() = ''admin'') with check (private.current_profile_role() = ''admin'')',
          table_name || '_staff_write', table_name
        );
      elsif table_name = 'practices' or table_name = 'videos' then
        execute format(
          'create policy %I on public.%I for all to authenticated using (private.current_profile_role() = ''admin'' or exists (select 1 from public.teacher_modules tm where tm.profile_id = auth.uid() and tm.module_id = %I.module_id)) with check (private.current_profile_role() = ''admin'' or exists (select 1 from public.teacher_modules tm where tm.profile_id = auth.uid() and tm.module_id = %I.module_id))',
          table_name || '_staff_write', table_name, table_name, table_name
        );
      elsif table_name = 'tlbs' then
        execute format(
          'create policy %I on public.%I for all to authenticated using (private.current_profile_role() = ''admin'' or exists (select 1 from public.teacher_modules tm where tm.profile_id = auth.uid() and tm.module_id = tlbs.module_id)) with check (private.current_profile_role() = ''admin'' or exists (select 1 from public.teacher_modules tm where tm.profile_id = auth.uid() and tm.module_id = tlbs.module_id))',
          table_name || '_staff_write', table_name
        );
      else
        execute format(
          'create policy %I on public.%I for all to authenticated using (private.current_profile_role() = ''admin'' or exists (select 1 from public.tlbs t join public.teacher_modules tm on tm.module_id = t.module_id where tm.profile_id = auth.uid() and t.id = defects.tlb_id)) with check (private.current_profile_role() = ''admin'' or exists (select 1 from public.tlbs t join public.teacher_modules tm on tm.module_id = t.module_id where tm.profile_id = auth.uid() and t.id = defects.tlb_id))',
          table_name || '_staff_write', table_name
        );
      end if;
    end if;
  end loop;
end $$;

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (private.current_profile_role() = 'admin')
  with check (private.current_profile_role() = 'admin');

create policy profiles_admin_read on public.profiles
  for select to authenticated
  using (private.current_profile_role() = 'admin');

create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

alter table public.profiles enable row level security;
grant select on public.profiles to authenticated;
grant update on public.profiles to authenticated;