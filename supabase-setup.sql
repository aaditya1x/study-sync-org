-- Initial-setup template only. Do not run against an existing project.
-- The Study Sync app uses courses.owner_id. Existing-project changes belong in
-- reviewed migrations under supabase-migrations.
-- These buckets are private. The app creates short lived signed download URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('study-materials', 'study-materials', false, 52428800),
  ('profile-photos', 'profile-photos', false, 2097152)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create table if not exists public.study_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  subject text not null,
  size bigint not null default 0,
  type text not null,
  is_indexed boolean not null default false,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

alter table public.study_materials
  add column if not exists is_indexed boolean not null default false;
alter table public.study_materials
  add column if not exists is_shared boolean not null default false;

create table if not exists public.book_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null references public.study_materials(storage_path) on delete cascade,
  book_name text not null,
  subject text not null,
  page_number integer not null check (page_number > 0),
  content text not null,
  created_at timestamptz not null default now()
);

delete from public.book_chunks as chunk
where not exists (
  select 1 from public.study_materials as material
  where material.storage_path = chunk.storage_path
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'book_chunks_storage_path_fkey'
      and conrelid = 'public.book_chunks'::regclass
  ) then
    alter table public.book_chunks
      add constraint book_chunks_storage_path_fkey
      foreign key (storage_path)
      references public.study_materials(storage_path)
      on delete cascade;
  end if;
end;
$$;

update public.study_materials as material
set is_indexed = true
where exists (
  select 1
  from public.book_chunks as chunk
  where chunk.user_id = material.user_id
    and chunk.storage_path = material.storage_path
);

create table if not exists public.user_app_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  data_key text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, data_key)
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  code text not null,
  title text not null,
  course_code text not null,
  semester integer not null default 1 check (semester between 1 and 12),
  description text not null default '',
  progress numeric not null default 0 check (progress between 0 and 100),
  color text not null default 'purple',
  materials integer not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, code)
);

alter table public.study_materials enable row level security;
alter table public.book_chunks enable row level security;
alter table public.user_app_data enable row level security;
alter table public.courses enable row level security;
grant select, insert, update, delete on public.study_materials to authenticated;
grant select, insert, update, delete on public.study_materials to service_role;
grant select, insert, update, delete on public.book_chunks to service_role;
grant select, insert, update, delete on public.user_app_data to authenticated;
grant insert, update, delete on public.courses to authenticated;
revoke select on table public.courses from public, anon, authenticated;
grant select (id, owner_id, name, title, code, course_code, semester, description, color, created_at)
  on table public.courses to authenticated;

drop policy if exists "Users can read own app data" on public.user_app_data;
create policy "Users can read own app data"
  on public.user_app_data for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own app data" on public.user_app_data;
create policy "Users can insert own app data"
  on public.user_app_data for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own app data" on public.user_app_data;
create policy "Users can update own app data"
  on public.user_app_data for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own courses" on public.courses;
create policy "Authenticated students can read shared courses"
  on public.courses for select to authenticated
  using (auth.uid() is not null);

drop policy if exists "Users can insert own courses" on public.courses;
create policy "Users can insert own courses"
  on public.courses for insert to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "Users can update own courses" on public.courses;
create policy "Users can update own courses"
  on public.courses for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Users can delete own courses" on public.courses;
create policy "Users can delete own courses"
  on public.courses for delete to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Users can read own study materials" on public.study_materials;
create policy "Users can read own study materials"
  on public.study_materials for select to authenticated
  using (auth.uid() = user_id or is_shared is true);

drop policy if exists "Users can add own study materials" on public.study_materials;
create policy "Users can add own study materials"
  on public.study_materials for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own study materials" on public.study_materials;
create policy "Users can delete own study materials"
  on public.study_materials for delete to authenticated
  using (auth.uid() = user_id);

create index if not exists book_chunks_owner_file_idx
  on public.book_chunks (user_id, storage_path, page_number);

create or replace function public.search_book_chunks(
  p_user_id uuid,
  p_storage_path text,
  p_query text,
  p_limit integer default 8
)
returns table (page_number integer, content text, book_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select chunk.page_number, chunk.content, chunk.book_name
  from public.book_chunks as chunk
  where chunk.user_id = p_user_id
    and chunk.storage_path = p_storage_path
    and to_tsvector('english', chunk.content)
      @@ websearch_to_tsquery('english', p_query)
  order by ts_rank(
    to_tsvector('english', chunk.content),
    websearch_to_tsquery('english', p_query)
  ) desc, chunk.page_number asc
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

revoke all on function public.search_book_chunks(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_book_chunks(uuid, text, text, integer)
  to service_role;

drop policy if exists "Users can access own study material files" on storage.objects;
create policy "Users can access own study material files"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'study-materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'study-materials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Authenticated students can read shared study material files" on storage.objects;
create policy "Authenticated students can read shared study material files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'study-materials'
    and exists (
      select 1 from public.study_materials as material
      where material.storage_path = storage.objects.name
        and (material.user_id = auth.uid() or material.is_shared is true)
    )
  );

drop policy if exists "Users can access own profile photos" on storage.objects;
create policy "Users can access own profile photos"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
