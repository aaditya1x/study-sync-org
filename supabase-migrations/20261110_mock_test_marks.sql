-- Add explicit marks per approved practice question.
-- Prerequisite: 20261106_learning_assessment_and_papers.sql.
-- Review and apply manually; this migration does not alter existing attempts.
begin;

alter table public.mock_test_configs
  add column if not exists marks_per_question integer not null default 1;
alter table public.mock_test_attempts
  add column if not exists marks_per_question integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mock_test_configs'::regclass
      and conname = 'mock_test_configs_marks_per_question_check'
  ) then
    alter table public.mock_test_configs
      add constraint mock_test_configs_marks_per_question_check
      check (marks_per_question between 1 and 5);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mock_test_attempts'::regclass
      and conname = 'mock_test_attempts_marks_per_question_check'
  ) then
    alter table public.mock_test_attempts
      add constraint mock_test_attempts_marks_per_question_check
      check (marks_per_question between 1 and 5);
  end if;
end;
$$;

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
    wrong_count = wrong_total, unanswered_count = unanswered_total, score = correct_total * saved_attempt.marks_per_question
  where id = p_attempt_id;
end;
$$;
revoke all on function public.submit_mock_test_attempt(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.submit_mock_test_attempt(uuid,uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
