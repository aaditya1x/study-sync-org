-- Personal chapter and topic progress for Study Sync courses.
-- Review and run manually in the intended Supabase project after the existing
-- course-sharing migrations. This migration does not change courses, materials,
-- tasks, authentication, or existing user data.
begin;

create table if not exists public.course_chapters (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_topics (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.course_chapters(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  position integer not null default 0 check (position >= 0),
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists course_chapters_user_course_position_idx
  on public.course_chapters (user_id, course_id, position, created_at);
create index if not exists course_topics_user_chapter_position_idx
  on public.course_topics (user_id, chapter_id, position, created_at);

alter table public.course_chapters enable row level security;
alter table public.course_topics enable row level security;

drop policy if exists "study-sync-chapters-own" on public.course_chapters;
create policy "study-sync-chapters-own" on public.course_chapters
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "study-sync-topics-own" on public.course_topics;
create policy "study-sync-topics-own" on public.course_topics
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.course_chapters chapter
      where chapter.id = chapter_id and chapter.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.course_chapters chapter
      where chapter.id = chapter_id and chapter.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.course_chapters to authenticated;
grant select, insert, update, delete on public.course_topics to authenticated;

notify pgrst, 'reload schema';
commit;
