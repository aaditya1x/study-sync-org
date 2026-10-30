-- Scope academic course reads to the signed-in student's profile branch and
-- each teacher's assigned branches. Super Admins retain full catalog access.
-- Apply after 20261102_super_admin_rbac.sql. This is deliberately unapplied.
begin;

alter table public.courses enable row level security;

drop policy if exists "academic profile branch course read scope" on public.courses;
create policy "academic profile branch course read scope" on public.courses
  as restrictive for select to authenticated
  using (
    public.is_super_admin()
    or (
      exists (
        select 1 from public.academic_staff staff
        where staff.user_id = auth.uid() and staff.role = 'teacher'
      )
      and public.is_assigned_teacher(branch_id)
    )
    or (
      not exists (
        select 1 from public.academic_staff staff
        where staff.user_id = auth.uid() and staff.role = 'teacher'
      )
      and (
        owner_id = auth.uid()
        or branch_id = (
          select profile.branch_id from public.academic_profiles profile
          where profile.user_id = auth.uid()
        )
      )
    )
  );

notify pgrst, 'reload schema';
commit;
