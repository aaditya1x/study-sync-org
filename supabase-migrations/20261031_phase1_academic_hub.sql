-- Phase 1: normalized academic allocation catalogs and subject categorization.
-- Review and run manually after the existing Study Sync migrations. This is
-- additive: it preserves courses, chapter/topic progress, materials, and tasks.
begin;

create table if not exists public.academic_degrees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.academic_branches (
  id uuid primary key default gen_random_uuid(),
  degree_id uuid not null references public.academic_degrees(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (degree_id, name),
  unique (id, degree_id)
);

create table if not exists public.academic_cycles (
  id uuid primary key default gen_random_uuid(),
  label text not null unique check (char_length(btrim(label)) between 1 and 80),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

-- Staff assignments are provisioned by a trusted administrator/service role.
-- No frontend client can promote itself or grant catalog-management access.
create table if not exists public.academic_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'teacher')),
  created_at timestamptz not null default now()
);

create table if not exists public.academic_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  degree_id uuid references public.academic_degrees(id) on delete restrict,
  branch_id uuid,
  academic_cycle_id uuid references public.academic_cycles(id) on delete restrict,
  year_level smallint check (year_level between 1 and 12),
  semester smallint check (semester between 1 and 24),
  updated_at timestamptz not null default now(),
  constraint academic_profiles_branch_degree_fk
    foreign key (branch_id, degree_id)
    references public.academic_branches(id, degree_id) on delete restrict
);

alter table public.courses
  add column if not exists branch_id uuid references public.academic_branches(id) on delete restrict,
  add column if not exists academic_cycle_id uuid references public.academic_cycles(id) on delete restrict,
  add column if not exists year_level smallint;

alter table public.courses
  drop constraint if exists courses_year_level_check;
alter table public.courses
  add constraint courses_year_level_check
  check (year_level is null or year_level between 1 and 12);

create index if not exists academic_branches_degree_name_idx
  on public.academic_branches (degree_id, name);
create index if not exists courses_academic_allocation_idx
  on public.courses (branch_id, academic_cycle_id, year_level, semester);

alter table public.academic_degrees enable row level security;
alter table public.academic_branches enable row level security;
alter table public.academic_cycles enable row level security;
alter table public.academic_staff enable row level security;
alter table public.academic_profiles enable row level security;

drop policy if exists "academic catalog authenticated read" on public.academic_degrees;
create policy "academic catalog authenticated read" on public.academic_degrees
  for select to authenticated using (auth.uid() is not null);
drop policy if exists "academic branches authenticated read" on public.academic_branches;
create policy "academic branches authenticated read" on public.academic_branches
  for select to authenticated using (auth.uid() is not null);
drop policy if exists "academic cycles authenticated read" on public.academic_cycles;
create policy "academic cycles authenticated read" on public.academic_cycles
  for select to authenticated using (auth.uid() is not null);

drop policy if exists "academic staff own role read" on public.academic_staff;
create policy "academic staff own role read" on public.academic_staff
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "academic degrees staff manage" on public.academic_degrees;
create policy "academic degrees staff manage" on public.academic_degrees
  for all to authenticated using (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  )) with check (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ));
drop policy if exists "academic branches staff manage" on public.academic_branches;
create policy "academic branches staff manage" on public.academic_branches
  for all to authenticated using (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  )) with check (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ));
drop policy if exists "academic cycles staff manage" on public.academic_cycles;
create policy "academic cycles staff manage" on public.academic_cycles
  for all to authenticated using (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  )) with check (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ));

drop policy if exists "academic profiles own row" on public.academic_profiles;
create policy "academic profiles own row" on public.academic_profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.academic_degrees, public.academic_branches, public.academic_cycles to authenticated;
grant insert, update, delete on public.academic_degrees, public.academic_branches, public.academic_cycles to authenticated;
revoke all on public.academic_staff from public, anon, authenticated;
grant select on public.academic_staff to authenticated;
grant all on public.academic_staff to service_role;
grant select, insert, update, delete on public.academic_profiles to authenticated;
grant select (branch_id, academic_cycle_id, year_level)
  on public.courses to authenticated;

notify pgrst, 'reload schema';
commit;
