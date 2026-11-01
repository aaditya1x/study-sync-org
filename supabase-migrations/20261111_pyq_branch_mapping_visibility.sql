-- Restore student visibility for PYQ courses assigned through
-- course_branch_visibility while preserving publication, verification,
-- semester, academic-cycle, active-account, teacher-denial and Super Admin
-- checks. Review and apply manually; this migration changes policies only.
begin;

do $$
begin
  if to_regclass('public.previous_year_papers') is null
     or to_regclass('public.academic_profiles') is null
     or to_regclass('public.courses') is null
     or to_regclass('public.course_branch_visibility') is null
     or to_regclass('public.academic_staff') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('public.is_current_user_active()') is null
     or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'PYQ branch-visibility prerequisites are missing; no policies were changed.';
  end if;
end;
$$;

-- Direct course ownership and explicit branch mappings both represent an
-- authorized course allocation. EXISTS avoids multiplying paper rows.
drop policy if exists "published verified papers read" on public.previous_year_papers;
create policy "published verified papers read" on public.previous_year_papers
  for select to authenticated using (
    public.is_current_user_active()
    and (
      public.is_super_admin()
      or (
        is_published and verified and course_id is not null
        and not exists (
          select 1 from public.academic_staff staff where staff.user_id = auth.uid()
        )
        and exists (
          select 1
          from public.academic_profiles profile
          join public.courses course on course.id = previous_year_papers.course_id
          where profile.user_id = auth.uid()
            and profile.branch_id is not null
            and (course.branch_id = profile.branch_id or exists (
              select 1 from public.course_branch_visibility mapping
              where mapping.course_id = course.id and mapping.branch_id = profile.branch_id
            ))
            and (course.academic_cycle_id is null
              or course.academic_cycle_id = profile.academic_cycle_id)
            and profile.semester = previous_year_papers.semester
            and course.semester = previous_year_papers.semester
        )
      )
    )
  );

drop policy if exists "paper allocation read guard" on public.previous_year_papers;
create policy "paper allocation read guard" on public.previous_year_papers
  as restrictive for select to authenticated using (
    public.is_current_user_active()
    and (
      public.is_super_admin()
      or (
        is_published and verified and course_id is not null
        and not exists (
          select 1 from public.academic_staff staff where staff.user_id = auth.uid()
        )
        and exists (
          select 1
          from public.academic_profiles profile
          join public.courses course on course.id = previous_year_papers.course_id
          where profile.user_id = auth.uid()
            and profile.branch_id is not null
            and (course.branch_id = profile.branch_id or exists (
              select 1 from public.course_branch_visibility mapping
              where mapping.course_id = course.id and mapping.branch_id = profile.branch_id
            ))
            and (course.academic_cycle_id is null
              or course.academic_cycle_id = profile.academic_cycle_id)
            and profile.semester = previous_year_papers.semester
            and course.semester = previous_year_papers.semester
        )
      )
    )
  );

drop policy if exists "published pyq objects read" on storage.objects;
create policy "published pyq objects read" on storage.objects
  for select to authenticated using (
    bucket_id = 'previous-year-papers'
    and public.is_current_user_active()
    and (
      public.is_super_admin()
      or exists (
        select 1
        from public.previous_year_papers paper
        join public.academic_profiles profile on profile.user_id = auth.uid()
        join public.courses course on course.id = paper.course_id
        where paper.storage_path = storage.objects.name
          and paper.is_published and paper.verified
          and not exists (
            select 1 from public.academic_staff staff where staff.user_id = auth.uid()
          )
          and profile.branch_id is not null
          and (course.branch_id = profile.branch_id or exists (
            select 1 from public.course_branch_visibility mapping
            where mapping.course_id = course.id and mapping.branch_id = profile.branch_id
          ))
          and (course.academic_cycle_id is null
            or course.academic_cycle_id = profile.academic_cycle_id)
          and profile.semester = paper.semester
          and course.semester = paper.semester
      )
    )
  );

drop policy if exists "pyq object select access guard" on storage.objects;
create policy "pyq object select access guard" on storage.objects
  as restrictive for select to authenticated using (
    bucket_id <> 'previous-year-papers'
    or (
      public.is_current_user_active()
      and (
        public.is_super_admin()
        or exists (
          select 1
          from public.previous_year_papers paper
          join public.academic_profiles profile on profile.user_id = auth.uid()
          join public.courses course on course.id = paper.course_id
          where paper.storage_path = storage.objects.name
            and paper.is_published and paper.verified
            and not exists (
              select 1 from public.academic_staff staff where staff.user_id = auth.uid()
            )
            and profile.branch_id is not null
            and (course.branch_id = profile.branch_id or exists (
              select 1 from public.course_branch_visibility mapping
              where mapping.course_id = course.id and mapping.branch_id = profile.branch_id
            ))
            and (course.academic_cycle_id is null
              or course.academic_cycle_id = profile.academic_cycle_id)
            and profile.semester = paper.semester
            and course.semester = paper.semester
        )
      )
    )
  );

notify pgrst, 'reload schema';
commit;
