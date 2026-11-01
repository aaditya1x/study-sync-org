-- Additive learning assessment, private question bank, PYQ and topic progress.
-- Requires 20261102_super_admin_rbac.sql (role helpers and academic curriculum).
-- Review against the target project's live schema before manually applying.
begin;

create table if not exists public.academic_topic_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.academic_topics(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
alter table public.academic_topic_progress enable row level security;
revoke all on public.academic_topic_progress from public, anon;
grant select, insert, update, delete on public.academic_topic_progress to authenticated;
grant all on public.academic_topic_progress to service_role;
drop policy if exists "topic progress own rows" on public.academic_topic_progress;
create policy "topic progress own rows" on public.academic_topic_progress
  for all to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_current_user_active());
drop policy if exists "topic progress active account guard" on public.academic_topic_progress;
create policy "topic progress active account guard" on public.academic_topic_progress as restrictive
  for all to authenticated using (public.is_current_user_active())
  with check (public.is_current_user_active());

-- Correct answers are served only by the authenticated server API; browser
-- roles receive no direct access to these tables.
create table if not exists public.mock_test_configs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  course_id uuid not null references public.courses(id) on delete cascade,
  scope text not null default 'subject' check (scope in ('subject','unit','topic','full')),
  unit_id uuid references public.academic_units(id) on delete set null,
  topic_id uuid references public.academic_topics(id) on delete set null,
  difficulty text not null default 'any' check (difficulty in ('any','easy','medium','hard')),
  question_count integer not null default 10 check (question_count in (10,20,30)),
  duration_minutes integer not null default 20 check (duration_minutes between 5 and 180),
  is_published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope <> 'unit') or unit_id is not null),
  check ((scope <> 'topic') or topic_id is not null)
);
create table if not exists public.mock_test_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  unit_id uuid references public.academic_units(id) on delete set null,
  topic_id uuid references public.academic_topics(id) on delete set null,
  prompt text not null check (char_length(btrim(prompt)) between 1 and 4000),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4),
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text not null default '' check (char_length(explanation) <= 4000),
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  is_active boolean not null default false,
  source_verified boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_active or (source_verified and topic_id is not null))
);
create index if not exists mock_test_questions_scope_idx
  on public.mock_test_questions(course_id, unit_id, topic_id, difficulty) where is_active;
create table if not exists public.mock_test_attempts (
  id uuid primary key default gen_random_uuid(),
  test_config_id uuid not null references public.mock_test_configs(id) on delete restrict,
  student_id uuid not null references auth.users(id) on delete cascade,
  question_ids uuid[] not null check (cardinality(question_ids) between 1 and 30),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  submitted_at timestamptz,
  correct_count integer check (correct_count >= 0),
  wrong_count integer check (wrong_count >= 0),
  unanswered_count integer check (unanswered_count >= 0),
  score integer check (score >= 0),
  created_at timestamptz not null default now(),
  check ((submitted_at is null and score is null) or
         (submitted_at is not null and score is not null and correct_count is not null
          and wrong_count is not null and unanswered_count is not null))
);
create index if not exists mock_test_attempts_student_idx
  on public.mock_test_attempts(student_id, created_at desc);

alter table public.mock_test_configs enable row level security;
alter table public.mock_test_questions enable row level security;
alter table public.mock_test_attempts enable row level security;
revoke all on public.mock_test_configs, public.mock_test_questions, public.mock_test_attempts from public, anon, authenticated;
grant all on public.mock_test_configs, public.mock_test_questions, public.mock_test_attempts to service_role;
drop policy if exists "active account guard mock test configs" on public.mock_test_configs;
create policy "active account guard mock test configs" on public.mock_test_configs as restrictive
  for all to authenticated using (public.is_current_user_active()) with check (public.is_current_user_active());
drop policy if exists "active account guard mock questions" on public.mock_test_questions;
create policy "active account guard mock questions" on public.mock_test_questions as restrictive
  for all to authenticated using (public.is_current_user_active()) with check (public.is_current_user_active());
drop policy if exists "active account guard mock attempts" on public.mock_test_attempts;
create policy "active account guard mock attempts" on public.mock_test_attempts as restrictive
  for all to authenticated using (public.is_current_user_active()) with check (public.is_current_user_active());

create or replace function public.save_mock_test_answer(
  p_attempt_id uuid, p_student_id uuid, p_question_id uuid, p_answer_index smallint
) returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare saved_attempt public.mock_test_attempts%rowtype;
begin
  if p_answer_index not between 0 and 3 then
    raise exception 'Choose one of the four answers.' using errcode = '22023';
  end if;
  select * into saved_attempt from public.mock_test_attempts
    where id = p_attempt_id and student_id = p_student_id for update;
  if not found then raise exception 'Test attempt not found.' using errcode = 'P0002'; end if;
  if saved_attempt.submitted_at is not null then
    raise exception 'Submitted answers are locked.' using errcode = '42501';
  end if;
  if saved_attempt.ends_at <= now() then
    raise exception 'The test time has expired.' using errcode = '22023';
  end if;
  if not p_question_id = any(saved_attempt.question_ids) then
    raise exception 'Question is not part of this attempt.' using errcode = '42501';
  end if;
  update public.mock_test_attempts set answers = answers || jsonb_build_object(p_question_id::text, p_answer_index)
    where id = p_attempt_id;
end;
$$;
revoke all on function public.save_mock_test_answer(uuid,uuid,uuid,smallint) from public, anon, authenticated;
grant execute on function public.save_mock_test_answer(uuid,uuid,uuid,smallint) to service_role;

create or replace function public.submit_mock_test_attempt(
  p_attempt_id uuid, p_student_id uuid, p_submitted_answers jsonb
) returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  saved_attempt public.mock_test_attempts%rowtype;
  effective_answers jsonb;
  question_id uuid;
  answer_value text;
  correct_value smallint;
  correct_total integer := 0;
  wrong_total integer := 0;
  unanswered_total integer := 0;
begin
  select * into saved_attempt from public.mock_test_attempts
    where id = p_attempt_id and student_id = p_student_id for update;
  if not found then raise exception 'Test attempt not found.' using errcode = 'P0002'; end if;
  if saved_attempt.submitted_at is not null then return; end if;
  if jsonb_typeof(coalesce(p_submitted_answers, '{}'::jsonb)) <> 'object' then
    raise exception 'Submitted answers are invalid.' using errcode = '22023';
  end if;
  effective_answers := case when now() > saved_attempt.ends_at
    then saved_attempt.answers else coalesce(p_submitted_answers, '{}'::jsonb) end;
  for question_id, answer_value in select key::uuid, value from jsonb_each_text(effective_answers) loop
    if not question_id = any(saved_attempt.question_ids) or answer_value !~ '^[0-3]$' then
      raise exception 'Submitted answers contain an invalid question or option.' using errcode = '22023';
    end if;
  end loop;
  foreach question_id in array saved_attempt.question_ids loop
    select correct_index into correct_value from public.mock_test_questions where id = question_id;
    if not found then raise exception 'The practice question bank is incomplete.' using errcode = 'P0002'; end if;
    if not (effective_answers ? question_id::text) then
      unanswered_total := unanswered_total + 1;
    elsif (effective_answers->>question_id::text)::smallint = correct_value then
      correct_total := correct_total + 1;
    else
      wrong_total := wrong_total + 1;
    end if;
  end loop;
  update public.mock_test_attempts set
    answers = effective_answers, submitted_at = now(), correct_count = correct_total,
    wrong_count = wrong_total, unanswered_count = unanswered_total, score = correct_total
  where id = p_attempt_id;
end;
$$;
revoke all on function public.submit_mock_test_attempt(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.submit_mock_test_attempt(uuid,uuid,jsonb) to service_role;

create table if not exists public.previous_year_papers (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  course_id uuid references public.courses(id) on delete restrict,
  semester smallint not null check (semester between 1 and 24),
  exam_year smallint not null check (exam_year between 1950 and 2200),
  unit_id uuid references public.academic_units(id) on delete set null,
  storage_path text not null unique check (storage_path !~ '(^/|\.\.|\\)'),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  content_type text not null check (content_type = 'application/pdf'),
  file_size bigint not null check (file_size between 1 and 26214400),
  verified boolean not null default false,
  is_published boolean not null default false,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (not is_published or (verified and published_at is not null))
);
create index if not exists previous_year_papers_public_idx
  on public.previous_year_papers(semester, exam_year desc, course_id) where is_published and verified;
alter table public.previous_year_papers enable row level security;
revoke all on public.previous_year_papers from public, anon;
grant select on public.previous_year_papers to authenticated;
grant all on public.previous_year_papers to service_role;
drop policy if exists "published verified papers read" on public.previous_year_papers;
create policy "published verified papers read" on public.previous_year_papers
  for select to authenticated using (
    public.is_current_user_active() and ((is_published and verified) or public.is_super_admin())
  );
drop policy if exists "super admins manage papers" on public.previous_year_papers;
create policy "super admins manage papers" on public.previous_year_papers
  for all to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
drop policy if exists "paper active account guard" on public.previous_year_papers;
create policy "paper active account guard" on public.previous_year_papers as restrictive
  for all to authenticated using (public.is_current_user_active()) with check (public.is_current_user_active());
drop trigger if exists audit_previous_year_papers on public.previous_year_papers;
create trigger audit_previous_year_papers after insert or update or delete on public.previous_year_papers
  for each row execute function public.log_academic_admin_change();

-- The bucket stays private. Only verified, published metadata grants signed-in
-- students read access to an object; upload and deletion are Super Admin-only.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('previous-year-papers', 'previous-year-papers', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;
do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'previous-year-papers' and public is false
      and (file_size_limit is null or file_size_limit >= 26214400)
      and (allowed_mime_types is null or 'application/pdf' = any(allowed_mime_types))
  ) then
    raise exception 'The previous-year-papers bucket already exists with incompatible public, size, or MIME settings. Review it manually; no bucket settings were changed.';
  end if;
end;
$$;
drop policy if exists "published pyq objects read" on storage.objects;
create policy "published pyq objects read" on storage.objects for select to authenticated
  using (bucket_id = 'previous-year-papers' and (public.is_super_admin() or exists (
    select 1 from public.previous_year_papers p where p.storage_path = name
      and p.is_published and p.verified and public.is_current_user_active()
  )));
drop policy if exists "super admins upload pyq objects" on storage.objects;
create policy "super admins upload pyq objects" on storage.objects for insert to authenticated
  with check (bucket_id = 'previous-year-papers' and owner_id = auth.uid()::text and public.is_super_admin());
drop policy if exists "super admins delete pyq objects" on storage.objects;
create policy "super admins delete pyq objects" on storage.objects for delete to authenticated
  using (bucket_id = 'previous-year-papers' and public.is_super_admin());
drop policy if exists "pyq object active account guard" on storage.objects;
create policy "pyq object active account guard" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'previous-year-papers' or public.is_current_user_active())
  with check (bucket_id <> 'previous-year-papers' or public.is_current_user_active());
-- Restrictive guards keep any pre-existing permissive storage policy from
-- broadening access to the new private bucket.
drop policy if exists "pyq object select access guard" on storage.objects;
create policy "pyq object select access guard" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'previous-year-papers' or (public.is_current_user_active()
    and (public.is_super_admin() or exists (
      select 1 from public.previous_year_papers p where p.storage_path = name
        and p.is_published and p.verified
    ))));
drop policy if exists "pyq object insert access guard" on storage.objects;
create policy "pyq object insert access guard" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'previous-year-papers' or (public.is_super_admin() and owner_id = auth.uid()::text));
drop policy if exists "pyq object update access guard" on storage.objects;
create policy "pyq object update access guard" on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'previous-year-papers' or public.is_super_admin())
  with check (bucket_id <> 'previous-year-papers' or public.is_super_admin());
drop policy if exists "pyq object delete access guard" on storage.objects;
create policy "pyq object delete access guard" on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'previous-year-papers' or public.is_super_admin());

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  email text not null check (char_length(email) between 3 and 254),
  subject text not null check (char_length(btrim(subject)) between 3 and 160),
  message text not null check (char_length(btrim(message)) between 10 and 5000),
  status text not null default 'new' check (status in ('new','reviewed','closed')),
  created_at timestamptz not null default now()
);
create table if not exists public.contact_rate_limits (
  rate_key text not null,
  created_at timestamptz not null default now()
);
create index if not exists contact_rate_limits_key_time_idx on public.contact_rate_limits(rate_key, created_at desc);
alter table public.contact_messages enable row level security;
alter table public.contact_rate_limits enable row level security;
revoke all on public.contact_messages, public.contact_rate_limits from public, anon, authenticated;
grant all on public.contact_messages, public.contact_rate_limits to service_role;

create or replace function public.submit_contact_message(
  p_name text, p_email text, p_subject text, p_message text, p_rate_key text
) returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare recent_count integer;
begin
  if char_length(btrim(p_name)) not between 2 and 100
     or char_length(p_email) not between 3 and 254
     or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or char_length(btrim(p_subject)) not between 3 and 160
     or char_length(btrim(p_message)) not between 10 and 5000
     or p_rate_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Please check the contact form fields.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_rate_key, 0));
  delete from public.contact_rate_limits where created_at < now() - interval '1 day';
  select count(*) into recent_count from public.contact_rate_limits
    where rate_key = p_rate_key and created_at > now() - interval '1 hour';
  if recent_count >= 3 then
    raise exception 'Please wait before sending another message.' using errcode = 'P0001';
  end if;
  insert into public.contact_rate_limits(rate_key) values (p_rate_key);
  insert into public.contact_messages(name,email,subject,message)
    values (btrim(p_name), lower(btrim(p_email)), btrim(p_subject), btrim(p_message));
end;
$$;
revoke all on function public.submit_contact_message(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_contact_message(text,text,text,text,text) to service_role;

notify pgrst, 'reload schema';
commit;
