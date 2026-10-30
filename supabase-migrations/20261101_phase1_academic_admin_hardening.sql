-- Corrective hardening for projects where 20261031_phase1_academic_hub.sql
-- has already been applied. Run manually; this does not grant any user a role.
begin;

-- Only a trusted database operator/service role may provision or alter staff.
-- Keep authenticated users' own-row read so the UI can discover their role.
revoke all on table public.academic_staff from public, anon, authenticated;
grant select on table public.academic_staff to authenticated;
grant all on table public.academic_staff to service_role;

-- Preserve academic allocations when admins attempt to remove referenced
-- catalog rows. Reassignment must happen before a degree/branch/cycle is deleted.
alter table public.academic_profiles
  drop constraint if exists academic_profiles_degree_id_fkey,
  drop constraint if exists academic_profiles_academic_cycle_id_fkey,
  drop constraint if exists academic_profiles_branch_degree_fk;
alter table public.academic_profiles
  add constraint academic_profiles_degree_id_fkey
    foreign key (degree_id) references public.academic_degrees(id) on delete restrict,
  add constraint academic_profiles_academic_cycle_id_fkey
    foreign key (academic_cycle_id) references public.academic_cycles(id) on delete restrict,
  add constraint academic_profiles_branch_degree_fk
    foreign key (branch_id, degree_id) references public.academic_branches(id, degree_id) on delete restrict;

alter table public.courses
  drop constraint if exists courses_branch_id_fkey,
  drop constraint if exists courses_academic_cycle_id_fkey;
alter table public.courses
  add constraint courses_branch_id_fkey
    foreign key (branch_id) references public.academic_branches(id) on delete restrict,
  add constraint courses_academic_cycle_id_fkey
    foreign key (academic_cycle_id) references public.academic_cycles(id) on delete restrict;

-- Catalog writes are reserved for admins. Teachers do not get catalog write access.
drop policy if exists "academic degrees staff manage" on public.academic_degrees;
create policy "academic degrees staff manage" on public.academic_degrees
  for all to authenticated
  using (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ))
  with check (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ));

drop policy if exists "academic branches staff manage" on public.academic_branches;
create policy "academic branches staff manage" on public.academic_branches
  for all to authenticated
  using (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ))
  with check (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ));

drop policy if exists "academic cycles staff manage" on public.academic_cycles;
create policy "academic cycles staff manage" on public.academic_cycles
  for all to authenticated
  using (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ))
  with check (exists (
    select 1 from public.academic_staff staff
    where staff.user_id = auth.uid() and staff.role = 'admin'
  ));

notify pgrst, 'reload schema';
commit;
