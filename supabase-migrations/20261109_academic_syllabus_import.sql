-- Private source PDFs and reviewed syllabus outlines. Apply manually only after
-- confirming the 20261102 academic catalog/RBAC objects are deployed.
begin;

do $$
begin
  if to_regclass('public.academic_units') is null
     or to_regclass('public.academic_chapters') is null
     or to_regclass('public.academic_topics') is null
     or to_regprocedure('public.is_current_user_active()') is null
     or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'Apply the academic catalog and Super Admin RBAC prerequisites before syllabus import.';
  end if;
end;
$$;

create table if not exists public.academic_syllabus_sources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  storage_path text not null unique,
  original_filename text not null,
  file_size bigint not null check (file_size between 1 and 26214400),
  status text not null default 'pending_review' check (status in ('pending_review','verified','failed')),
  extracted_outline jsonb not null default '{}'::jsonb,
  processing_error text,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  verified_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.academic_units add column if not exists syllabus_source_id uuid references public.academic_syllabus_sources(id) on delete set null;
alter table public.academic_units add column if not exists syllabus_source_key text;
alter table public.academic_chapters add column if not exists syllabus_source_id uuid references public.academic_syllabus_sources(id) on delete set null;
alter table public.academic_chapters add column if not exists syllabus_source_key text;
alter table public.academic_topics add column if not exists syllabus_source_id uuid references public.academic_syllabus_sources(id) on delete set null;
alter table public.academic_topics add column if not exists syllabus_source_key text;
alter table public.academic_topics add column if not exists parent_topic_id uuid references public.academic_topics(id) on delete cascade;
create unique index if not exists academic_units_source_key_uidx on public.academic_units(syllabus_source_key) where syllabus_source_key is not null;
create unique index if not exists academic_chapters_source_key_uidx on public.academic_chapters(syllabus_source_key) where syllabus_source_key is not null;
create unique index if not exists academic_topics_source_key_uidx on public.academic_topics(syllabus_source_key) where syllabus_source_key is not null;
create index if not exists academic_topics_parent_position_idx on public.academic_topics(parent_topic_id, position) where parent_topic_id is not null;
create index if not exists academic_syllabus_sources_course_created_idx on public.academic_syllabus_sources(course_id, created_at desc);

create or replace function public.syllabus_source_is_verified(p_source_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog, public
as $$ select exists (select 1 from public.academic_syllabus_sources s where s.id=p_source_id and s.status='verified') $$;
revoke all on function public.syllabus_source_is_verified(uuid) from public, anon;
grant execute on function public.syllabus_source_is_verified(uuid) to authenticated;

-- Staged import rows remain invisible to students until the API has finished
-- publishing every row and marks its source verified.
drop policy if exists "pending syllabus units hidden" on public.academic_units;
create policy "pending syllabus units hidden" on public.academic_units as restrictive for select to authenticated
  using (syllabus_source_id is null or public.syllabus_source_is_verified(syllabus_source_id));
drop policy if exists "pending syllabus chapters hidden" on public.academic_chapters;
create policy "pending syllabus chapters hidden" on public.academic_chapters as restrictive for select to authenticated
  using (syllabus_source_id is null or public.syllabus_source_is_verified(syllabus_source_id));
drop policy if exists "pending syllabus topics hidden" on public.academic_topics;
create policy "pending syllabus topics hidden" on public.academic_topics as restrictive for select to authenticated
  using (syllabus_source_id is null or public.syllabus_source_is_verified(syllabus_source_id));

alter table public.academic_syllabus_sources enable row level security;
revoke all on public.academic_syllabus_sources from public, anon;
grant select, insert, update, delete on public.academic_syllabus_sources to authenticated;
grant all on public.academic_syllabus_sources to service_role;
drop policy if exists "syllabus sources super admin access" on public.academic_syllabus_sources;
create policy "syllabus sources super admin access" on public.academic_syllabus_sources
  for all to authenticated using (public.is_current_user_active() and public.is_super_admin())
  with check (public.is_current_user_active() and public.is_super_admin());
drop policy if exists "syllabus sources active account guard" on public.academic_syllabus_sources;
create policy "syllabus sources active account guard" on public.academic_syllabus_sources as restrictive
  for all to authenticated using (public.is_current_user_active()) with check (public.is_current_user_active());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('academic-syllabi', 'academic-syllabi', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from storage.buckets where id='academic-syllabi' and public=false
    and file_size_limit=26214400 and allowed_mime_types=array['application/pdf']::text[]) then
    raise exception 'academic-syllabi bucket must be private, PDF-only and limited to 25 MiB; existing settings were not changed.';
  end if;
end;
$$;
drop policy if exists "syllabus source super admin select" on storage.objects;
create policy "syllabus source super admin select" on storage.objects for select to authenticated
  using (bucket_id='academic-syllabi' and public.is_current_user_active() and public.is_super_admin());
drop policy if exists "syllabus source super admin insert" on storage.objects;
create policy "syllabus source super admin insert" on storage.objects for insert to authenticated
  with check (bucket_id='academic-syllabi' and owner_id=auth.uid()::text and name like ('syllabus/' || auth.uid()::text || '/%') and public.is_current_user_active() and public.is_super_admin());
drop policy if exists "syllabus source super admin delete" on storage.objects;
create policy "syllabus source super admin delete" on storage.objects for delete to authenticated
  using (bucket_id='academic-syllabi' and public.is_current_user_active() and public.is_super_admin());
drop policy if exists "syllabus storage active account guard" on storage.objects;
create policy "syllabus storage active account guard" on storage.objects as restrictive for all to authenticated
  using (bucket_id<>'academic-syllabi' or public.is_current_user_active())
  with check (bucket_id<>'academic-syllabi' or public.is_current_user_active());
drop policy if exists "syllabus storage select guard" on storage.objects;
create policy "syllabus storage select guard" on storage.objects as restrictive for select to authenticated
  using (bucket_id<>'academic-syllabi' or public.is_super_admin());
drop policy if exists "syllabus storage insert guard" on storage.objects;
create policy "syllabus storage insert guard" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id<>'academic-syllabi' or (public.is_super_admin() and owner_id=auth.uid()::text and name like ('syllabus/' || auth.uid()::text || '/%')));
drop policy if exists "syllabus storage delete guard" on storage.objects;
create policy "syllabus storage delete guard" on storage.objects as restrictive for delete to authenticated
  using (bucket_id<>'academic-syllabi' or public.is_super_admin());

commit;
