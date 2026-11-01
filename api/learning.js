import { createClient } from "@supabase/supabase-js";
import { logApiFailure, missingServerEnv, readServerEnv, reportMissingServerEnv } from "../server/apiDiagnostics.js";
import { authorizeLearningAction, evaluateAttempt, getStudentCourseIds, mapLearningFailure, MOCK_DIFFICULTIES, MOCK_LENGTHS, MOCK_MARKS_PER_QUESTION, MOCK_SCOPES, uniquePracticeQuestions, validateQuestion } from "../server/learningTools.js";
import { verifyActiveSuperAdmin } from "../server/teacherApprovalApi.js";
import { extractPdfText } from "../server/syllabusPdf.js";
import { buildQuestionGenerationPrompt, difficultyTargets, requestGeminiQuestions, validateGeneratedQuestions } from "../server/mockTestGenerator.js";

const url = readServerEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const publishableKey = readServerEnv("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY");
const secretKey = readServerEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const geminiKey = readServerEnv("GEMINI_API_KEY");
const authClient = url && publishableKey ? createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const admin = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

function respond(res, status, body) { return res.status(status).json(body); }
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
function validId(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function publicQuestion(row) { return { id: row.id, prompt: row.prompt, options: row.options }; }

async function auditLearningAdmin(actorId, action, entityType, entityId, metadata = {}) {
  try {
    const { error } = await admin.from("platform_audit_logs").insert({
      actor_id: actorId, action, entity_type: entityType, entity_id: entityId ? String(entityId) : null, metadata,
    });
    if (error) logApiFailure("learning_admin_audit_failed", error, { entity_type: entityType });
  } catch (error) { logApiFailure("learning_admin_audit_failed", error, { entity_type: entityType }); }
}

async function identity(token) {
  let user;
  try { user = await verifyActiveSuperAdmin({ authClient, adminClient: admin, accessToken: token }); }
  catch (error) {
    if (error.status === 403 && error.code === "SUPER_ADMIN_REQUIRED") {
      const { data, error: authError } = await authClient.auth.getUser(token);
      if (authError || !data.user) throw fail("Sign in again to continue.", 401);
      const { data: status, error: statusError } = await admin.from("platform_user_status").select("user_id").eq("user_id", data.user.id).maybeSingle();
      if (statusError) throw fail("Could not verify account access.", 503);
      if (status) throw fail("This account is suspended.", 403);
      const { data: staff, error: staffError } = await admin.from("academic_staff").select("role").eq("user_id", data.user.id).maybeSingle();
      if (staffError) throw fail("Could not verify account role.", 503);
      return { id: data.user.id, role: staff?.role || "student" };
    }
    throw error;
  }
  return { id: user.id, role: "super_admin" };
}

async function studentCourseIds(userId) {
  const { data: profile, error: profileError } = await admin.from("academic_profiles")
    .select("degree_id, branch_id, academic_cycle_id, year_level, semester").eq("user_id", userId).maybeSingle();
  if (profileError) throw profileError;
  const { data: courses, error: coursesError } = await admin.from("courses")
    .select("id, owner_id, branch_id, academic_cycle_id, year_level, semester, archived_at").limit(2000);
  if (coursesError) throw coursesError;
  const { data: mappings, error: mappingsError } = profile?.branch_id
    ? await admin.from("course_branch_visibility").select("course_id, branch_id").eq("branch_id", profile.branch_id)
    : { data: [], error: null };
  if (mappingsError) throw mappingsError;
  const branchIds = [...new Set([
    ...(courses || []).map((course) => course.branch_id),
    ...(mappings || []).map((mapping) => mapping.branch_id),
  ].filter(Boolean))];
  const { data: branches, error: branchesError } = branchIds.length
    ? await admin.from("academic_branches").select("id, degree_id").in("id", branchIds)
    : { data: [], error: null };
  if (branchesError) throw branchesError;
  const degreesByBranch = new Map((branches || []).map((branch) => [branch.id, branch.degree_id]));
  const mappedBranchByCourse = new Map((mappings || []).map((mapping) => [mapping.course_id, mapping.branch_id]));
  const allocatedCourses = (courses || []).map((course) => ({
    ...course,
    degree_id: degreesByBranch.get(mappedBranchByCourse.get(course.id)) || degreesByBranch.get(course.branch_id) || null,
  }));
  return getStudentCourseIds(profile, allocatedCourses, mappings || [], userId);
}

async function listTests(userId) {
  const allowedCourseIds = new Set(await studentCourseIds(userId));
  return (await adminConfigList()).filter((test) => test.is_published && allowedCourseIds.has(test.course_id));
}

async function beginTest(userId, input) {
  if (!validId(input.test_id)) throw fail("Choose a valid available test.");
  const { data: config, error: configError } = await admin.from("mock_test_configs").select("*").eq("id", input.test_id).eq("is_published", true).maybeSingle();
  if (configError) throw configError;
  if (!config) throw fail("This test is no longer available.", 404);
  if (!(await studentCourseIds(userId)).includes(config.course_id)) throw fail("This practice test is not assigned to your current course, branch, and semester.", 403);
  let query = admin.from("mock_test_questions").select("id, prompt, options, correct_index, explanation, difficulty")
    .eq("course_id", config.course_id).eq("is_active", true).eq("source_verified", true);
  if (config.scope === "unit") query = query.eq("unit_id", config.unit_id);
  if (config.scope === "topic") query = query.eq("topic_id", config.topic_id);
  const requestedDifficulty = input.difficulty || config.difficulty;
  if (!["any", ...MOCK_DIFFICULTIES].includes(requestedDifficulty)
      || (config.difficulty !== "any" && requestedDifficulty !== config.difficulty)) throw fail("The selected difficulty is unavailable for this test.");
  if (requestedDifficulty !== "any") query = query.eq("difficulty", requestedDifficulty);
  const { data: rawBank, error: bankError } = await query;
  if (bankError) throw bankError;
  const bank = uniquePracticeQuestions(rawBank);
  const requestedCount = Number(input.question_count || config.question_count);
  const requestedDuration = Number(input.duration_minutes || config.duration_minutes);
  if (!MOCK_LENGTHS.has(requestedCount) || !Number.isInteger(requestedDuration) || requestedDuration < 5 || requestedDuration > 180) throw fail("Choose a valid question count and duration.");
  if ((bank || []).length < requestedCount) throw fail(`This practice test needs ${requestedCount} active questions. The available verified question bank currently has ${bank?.length || 0}.`, 409);
  let selection;
  if (requestedDifficulty === "any") {
    const targets = difficultyTargets(requestedCount);
    const groups = Object.fromEntries(Object.keys(targets).map((level) => [level, bank.filter((question) => question.difficulty === level)]));
    const shortages = Object.entries(targets).filter(([level, required]) => groups[level].length < required);
    if (shortages.length) throw fail(`This test requires ${targets.easy} Easy, ${targets.medium} Medium, and ${targets.hard} Hard verified questions. The available bank does not meet that distribution.`, 409);
    selection = Object.entries(targets).flatMap(([level, count]) => [...groups[level].sort(() => Math.random() - 0.5).slice(0, count)]);
    selection.sort(() => Math.random() - 0.5);
  } else selection = [...bank].sort(() => Math.random() - 0.5).slice(0, requestedCount);
  const now = new Date();
  const endsAt = new Date(now.getTime() + requestedDuration * 60_000);
  const { data: attempt, error: attemptError } = await admin.from("mock_test_attempts").insert({
    test_config_id: config.id, student_id: userId, question_ids: selection.map((question) => question.id), ends_at: endsAt.toISOString(),
    marks_per_question: config.marks_per_question || 1,
  }).select("id, started_at, ends_at").single();
  if (attemptError) throw attemptError;
  return { attempt, test: { id: config.id, title: config.title, duration_minutes: requestedDuration, marks_per_question: config.marks_per_question || 1 }, questions: selection.map(publicQuestion) };
}

async function submitTest(userId, input) {
  if (!validId(input.attempt_id)) throw fail("Choose a valid test attempt.");
  const { data: attempt, error } = await admin.from("mock_test_attempts").select("*").eq("id", input.attempt_id).eq("student_id", userId).maybeSingle();
  if (error) throw error;
  if (!attempt) throw fail("Test attempt not found.", 404);
  if (attempt.submitted_at) return loadResult(attempt);
  const { error: submitError } = await admin.rpc("submit_mock_test_attempt", {
    p_attempt_id: attempt.id, p_student_id: userId, p_submitted_answers: input.answers || {},
  });
  if (submitError) {
    if (submitError.code === "P0002") throw fail("The test attempt or a question in it could not be found.", 404);
    if (submitError.code === "22023") throw fail("Submitted answers were invalid.");
    throw submitError;
  }
  const { data: submitted, error: submittedError } = await admin.from("mock_test_attempts").select("*").eq("id", attempt.id).eq("student_id", userId).single();
  if (submittedError) throw submittedError;
  return loadResult(submitted);
}

async function saveAnswer(userId, input) {
  if (!validId(input.attempt_id) || !validId(input.question_id)
      || !Number.isInteger(input.answer_index) || input.answer_index < 0 || input.answer_index > 3) throw fail("The selected answer is invalid.");
  const { error } = await admin.rpc("save_mock_test_answer", {
    p_attempt_id: input.attempt_id, p_student_id: userId,
    p_question_id: input.question_id, p_answer_index: input.answer_index,
  });
  if (error) {
    if (error.code === "P0002") throw fail("Test attempt not found.", 404);
    if (error.code === "42501") throw fail("This answer cannot be changed.", 403);
    if (error.code === "22023") throw fail("The test time has expired.", 409);
    throw error;
  }
  return { saved: true };
}

async function testTitle(id) {
  const { data, error } = await admin.from("mock_test_configs").select("title").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.title || "Practice test";
}

async function loadResult(attempt) {
  const { data: questions, error } = await admin.from("mock_test_questions")
    .select("id, prompt, options, correct_index, explanation").in("id", attempt.question_ids);
  if (error) throw error;
  const ordered = attempt.question_ids.map((id) => questions.find((question) => question.id === id)).filter(Boolean);
  const title = await testTitle(attempt.test_config_id);
  const result = evaluateAttempt(ordered, attempt.answers || {}, Number(attempt.marks_per_question || 1));
  return { id: attempt.id, title, submitted_at: attempt.submitted_at, question_count: ordered.length, ...result };
}

async function listHistory(userId) {
  const { data: attempts, error } = await admin.from("mock_test_attempts")
    .select("id, test_config_id, created_at, submitted_at, score, correct_count, wrong_count, unanswered_count, question_ids, marks_per_question")
    .eq("student_id", userId).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(100);
  if (error) throw error;
  const configIds = [...new Set((attempts || []).map((row) => row.test_config_id))];
  const { data: tests, error: testError } = configIds.length
    ? await admin.from("mock_test_configs").select("id,title").in("id", configIds)
    : { data: [], error: null };
  if (testError) throw testError;
  const configById = new Map((tests || []).map((test) => [test.id, test]));
  return (attempts || []).map((row) => {
    const config = configById.get(row.test_config_id);
    const marksPerQuestion = Number(row.marks_per_question || 1);
    return { ...row, title: config?.title || "Practice test", total: row.question_ids.length * marksPerQuestion, question_count: row.question_ids.length };
  });
}

async function viewOwnResult(userId, input) {
  if (!validId(input.attempt_id)) throw fail("Choose a valid result.");
  const { data, error } = await admin.from("mock_test_attempts").select("*")
    .eq("id", input.attempt_id).eq("student_id", userId).not("submitted_at", "is", null).maybeSingle();
  if (error) throw error;
  if (!data) throw fail("Submitted result not found.", 404);
  return loadResult(data);
}

async function adminConfigList() {
  const { data, error } = await admin.from("mock_test_configs").select("*, courses(name,title,code,course_code)").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  const configs = data || [];
  const { data: questions, error: questionsError } = await admin.from("mock_test_questions").select("course_id,unit_id,topic_id,difficulty,prompt").eq("is_active", true).eq("source_verified", true);
  if (questionsError) throw questionsError;
  return configs.map((config) => {
    const matching = uniquePracticeQuestions((questions || []).filter((question) => question.course_id === config.course_id
      && (config.scope !== "unit" || question.unit_id === config.unit_id)
      && (config.scope !== "topic" || question.topic_id === config.topic_id)));
    const byDifficulty = Object.fromEntries(["easy", "medium", "hard"].map((difficulty) => [difficulty, matching.filter((question) => question.difficulty === difficulty).length]));
    const available = config.difficulty === "any" ? matching.length : byDifficulty[config.difficulty];
    return { ...config, available_questions: available, available_by_difficulty: byDifficulty };
  });
}

async function resolveTopic(topicId) {
  const { data: topic, error: topicError } = await admin.from("academic_topics").select("id,chapter_id").eq("id", topicId).maybeSingle();
  if (topicError) throw topicError;
  const { data: chapter, error: chapterError } = topic?.chapter_id
    ? await admin.from("academic_chapters").select("id,unit_id").eq("id", topic.chapter_id).maybeSingle()
    : { data: null, error: null };
  if (chapterError) throw chapterError;
  const { data: unit, error: unitError } = chapter?.unit_id
    ? await admin.from("academic_units").select("id,course_id").eq("id", chapter.unit_id).maybeSingle()
    : { data: null, error: null };
  if (unitError) throw unitError;
  return unit || null;
}

async function saveConfig(actorId, input) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const row = {
    title, course_id: input.course_id, scope: input.scope, unit_id: input.unit_id || null, topic_id: input.topic_id || null,
    difficulty: input.difficulty, question_count: Number(input.question_count), marks_per_question: Number(input.marks_per_question || 1), duration_minutes: Number(input.duration_minutes),
    is_published: input.is_published === true, created_by: actorId, updated_at: new Date().toISOString(),
  };
  if (title.length < 3 || title.length > 160 || !validId(row.course_id) || !MOCK_SCOPES.has(row.scope)
    || (row.unit_id && !validId(row.unit_id)) || (row.topic_id && !validId(row.topic_id))
    || !["any", ...MOCK_DIFFICULTIES].includes(row.difficulty) || !MOCK_LENGTHS.has(row.question_count)
    || !MOCK_MARKS_PER_QUESTION.has(row.marks_per_question)
    || !Number.isInteger(row.duration_minutes) || row.duration_minutes < 5 || row.duration_minutes > 180) {
    throw fail("Check the test title, subject, scope, difficulty, length and duration.");
  }
  if ((row.scope === "unit" && !row.unit_id) || (row.scope === "topic" && !row.topic_id)) throw fail("Choose a unit or topic for this test scope.");
  if (row.scope === "unit") {
    const { data: unit, error: unitError } = await admin.from("academic_units").select("id,course_id").eq("id", row.unit_id).maybeSingle();
    if (unitError) throw unitError;
    if (!unit || unit.course_id !== row.course_id) throw fail("The selected unit does not belong to this subject.");
  }
  if (row.scope === "topic") {
    const unit = await resolveTopic(row.topic_id);
    if (!unit || unit.course_id !== row.course_id || (row.unit_id && row.unit_id !== unit.id)) throw fail("The selected topic does not belong to this subject and unit.");
    row.unit_id = unit.id;
  }
  if (row.is_published) {
    let query = admin.from("mock_test_questions").select("prompt")
      .eq("course_id", row.course_id).eq("is_active", true).eq("source_verified", true);
    if (row.scope === "unit") query = query.eq("unit_id", row.unit_id);
    if (row.scope === "topic") query = query.eq("topic_id", row.topic_id);
    if (row.difficulty !== "any") query = query.eq("difficulty", row.difficulty);
    const { data: matchingQuestions, error: countError } = await query;
    if (countError) throw countError;
    const unique = uniquePracticeQuestions(matchingQuestions);
    const availableCount = unique.length;
    if (availableCount < row.question_count) throw fail(`Add and verify at least ${row.question_count} unique matching practice questions before publishing this test. The bank currently has ${availableCount}.`);
    if (row.difficulty === "any") {
      const targets = difficultyTargets(row.question_count);
      const counts = Object.fromEntries(Object.keys(targets).map((level) => [level, unique.filter((question) => question.difficulty === level).length]));
      if (Object.entries(targets).some(([level, required]) => counts[level] < required)) throw fail(`Publishing requires ${targets.easy} Easy, ${targets.medium} Medium, and ${targets.hard} Hard unique verified questions.`, 409);
    }
  }
  if (input.id) {
    if (!validId(input.id)) throw fail("Invalid test ID.");
    delete row.created_by;
    const { data, error } = await admin.from("mock_test_configs").update(row).eq("id", input.id).select("id").single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await admin.from("mock_test_configs").insert(row).select("id").single();
  if (error) throw error;
  return data;
}

async function generateQuestions(input) {
  if (!geminiKey) throw Object.assign(new Error("Gemini question generation is not configured on the server."), { status: 503, code: "GEMINI_NOT_CONFIGURED" });
  if (!validId(input.course_id) || !validId(input.unit_id) || !validId(input.topic_id)
      || ![10, 20, 30].includes(Number(input.question_count))
      || !["any", ...MOCK_DIFFICULTIES].includes(input.difficulty)) throw fail("Choose a valid subject, unit, topic, difficulty, and question count.");
  const unit = await resolveTopic(input.topic_id);
  if (!unit || unit.course_id !== input.course_id || unit.id !== input.unit_id) throw fail("The selected topic does not belong to this subject and unit.");
  const sourceSchemaUnavailable = (error) => {
    if (["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code)) return Object.assign(new Error("Verified syllabus source records are unavailable. Check that the syllabus import schema is installed."), { status: 503, code: "VERIFIED_SYLLABUS_SCHEMA_UNAVAILABLE", required_migration: "20261109_academic_syllabus_import.sql", migration_status: "CHECK_REQUIRED" });
    return error;
  };
  const { data: topic, error: topicError } = await admin.from("academic_topics").select("id,title,syllabus_source_id").eq("id", input.topic_id).single();
  if (topicError) throw sourceSchemaUnavailable(topicError);
  const { data: unitRow, error: unitError } = await admin.from("academic_units").select("id,title,syllabus_source_id").eq("id", input.unit_id).single();
  if (unitError) throw sourceSchemaUnavailable(unitError);
  const sourceId = topic.syllabus_source_id || unitRow.syllabus_source_id;
  if (!sourceId) throw Object.assign(new Error("This topic is not linked to a verified syllabus PDF. Link and verify a syllabus source before generating questions."), { status: 409, code: "VERIFIED_SOURCE_REQUIRED" });
  const { data: source, error: sourceError } = await admin.from("academic_syllabus_sources")
    .select("id,course_id,storage_path,original_filename,status").eq("id", sourceId).eq("course_id", input.course_id).eq("status", "verified").maybeSingle();
  if (sourceError) throw sourceSchemaUnavailable(sourceError);
  if (!source) throw Object.assign(new Error("No verified syllabus PDF is available for this topic."), { status: 409, code: "VERIFIED_SOURCE_REQUIRED" });
  const { data: file, error: fileError } = await admin.storage.from("academic-syllabi").download(source.storage_path);
  if (fileError || !file) throw Object.assign(new Error("The verified syllabus PDF could not be retrieved from private storage."), { status: 503, code: "SOURCE_UNAVAILABLE" });
  let sourceText;
  try { sourceText = await extractPdfText(Buffer.from(await file.arrayBuffer())); }
  catch { throw Object.assign(new Error("The verified syllabus PDF text could not be extracted. No questions were generated."), { status: 422, code: "SOURCE_TEXT_EXTRACTION_FAILED" }); }
  if (sourceText.trim().length < 300) throw Object.assign(new Error("The verified syllabus PDF has too little extractable text to ground questions. No questions were generated."), { status: 422, code: "SOURCE_CONTENT_INSUFFICIENT" });
  const normalizeSourceText = (value) => String(value).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizeSourceText(sourceText).includes(normalizeSourceText(topic.title))) throw Object.assign(new Error("The selected topic could not be found in its linked verified syllabus PDF. No questions were generated."), { status: 422, code: "SOURCE_TOPIC_NOT_FOUND" });
  const { data: course, error: courseError } = await admin.from("courses").select("name,title,code,course_code,branch_id,academic_cycle_id,semester").eq("id", input.course_id).single();
  if (courseError) throw courseError;
  const allocationBranchId = input.branch_id || course.branch_id;
  const { data: targetBranch, error: branchError } = allocationBranchId
    ? await admin.from("academic_branches").select("id,degree_id").eq("id", allocationBranchId).maybeSingle()
    : { data: null, error: null };
  if (branchError) throw branchError;
  let branchVisible = !input.branch_id || input.branch_id === course.branch_id;
  if (input.branch_id && !branchVisible) {
    const { data: mapping, error: mappingError } = await admin.from("course_branch_visibility")
      .select("course_id").eq("course_id", input.course_id).eq("branch_id", input.branch_id).maybeSingle();
    if (mappingError) throw mappingError;
    branchVisible = Boolean(mapping);
  }
  if ((input.branch_id && !targetBranch) || (input.degree_id && input.degree_id !== targetBranch?.degree_id)
      || !branchVisible
      || (input.academic_cycle_id && input.academic_cycle_id !== course.academic_cycle_id)
      || (input.semester && Number(input.semester) !== Number(course.semester))) throw fail("The selected subject does not match the requested academic allocation.");
  const prompt = buildQuestionGenerationPrompt({
    course: course.name || course.title || course.code || course.course_code,
    unit: unitRow.title, topic: topic.title, difficulty: input.difficulty,
    count: Number(input.question_count), sourceText, sourceName: source.original_filename,
  });
  const generated = await requestGeminiQuestions({ apiKey: geminiKey, prompt, signal: AbortSignal.timeout(60000) });
  let questions;
  try {
    questions = validateGeneratedQuestions(generated, {
      count: Number(input.question_count), courseId: input.course_id, unitId: input.unit_id,
      topicId: input.topic_id, difficulty: input.difficulty, sourceText,
      sourceReference: `${source.original_filename} (verified syllabus; no page number available)`,
    });
  } catch (error) { throw Object.assign(error, { status: 502, code: "GEMINI_INVALID_QUESTIONS" }); }
  const { data: rows, error: insertError } = await admin.from("mock_test_questions").insert(questions.map((question) => ({ ...question, created_by: input.actor_id })))
    .select("id,course_id,unit_id,topic_id,prompt,options,correct_index,explanation,difficulty,is_active,source_verified,created_at");
  if (insertError) throw insertError;
  return { questions: rows || [], saved_as: "draft", source: source.original_filename };
}

async function saveQuestion(actorId, input) {
  if (!validId(input.course_id) || !validId(input.topic_id) || (input.unit_id && !validId(input.unit_id))) throw fail("Choose a valid subject, unit and topic.");
  const unit = await resolveTopic(input.topic_id);
  if (!unit || unit.course_id !== input.course_id || (input.unit_id && input.unit_id !== unit.id)) throw fail("The selected topic does not belong to this subject and unit.");
  if (input.is_active === true && input.source_verified !== true) throw fail("Review this Practice Question against the verified source syllabus before making it available.");
  const question = validateQuestion(input);
  if (input.source_verified === true && input.confirm_source_review !== true) throw fail("Confirm that you manually checked the question and answer against its source.");
  if (input.source_verified === true && !question.explanation.includes("Source reference:")) throw fail("Add a source reference to the explanation before approving this question.");
  const row = { ...question, course_id: input.course_id, unit_id: unit.id, topic_id: input.topic_id, is_active: input.is_active === true, source_verified: input.source_verified === true, created_by: actorId, updated_at: new Date().toISOString() };
  if (input.id) {
    if (!validId(input.id)) throw fail("Invalid question ID.");
    const { data: existing, error: existingError } = await admin.from("mock_test_questions").select("course_id,unit_id,topic_id,prompt,options,correct_index,explanation,difficulty,source_verified").eq("id", input.id).maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw fail("Practice Question not found.", 404);
    const { data: references, error: referencesError } = await admin.from("mock_test_attempts").select("id").contains("question_ids", [input.id]).limit(1);
    if (referencesError) throw referencesError;
    const unchangedContent = ["course_id", "unit_id", "topic_id", "prompt", "options", "correct_index", "explanation", "difficulty", "source_verified"]
      .every((key) => JSON.stringify(existing[key]) === JSON.stringify(row[key]));
    if (references?.length && !unchangedContent) throw fail("This question is part of a saved test attempt and cannot be edited. Deactivate it instead.", 409);
    delete row.created_by;
    const { data, error } = await admin.from("mock_test_questions").update(row).eq("id", input.id).select("id").single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await admin.from("mock_test_questions").insert(row).select("id").single();
  if (error) throw error;
  return data;
}

async function approveQuestions(input) {
  const ids = input.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => !validId(id)) || input.confirm_source_review !== true) {
    throw fail("Select questions and confirm that you manually checked every question against its cited source.");
  }
  const { data: rows, error: loadError } = await admin.from("mock_test_questions")
    .select("id,course_id,unit_id,topic_id,explanation,is_active,source_verified").in("id", ids);
  if (loadError) throw loadError;
  if ((rows || []).length !== ids.length) throw fail("One or more selected questions could not be found.", 404);
  if (rows.some((row) => row.source_verified || row.is_active)) throw fail("Only unreviewed draft questions can be approved in this action.", 409);
  if (rows.some((row) => !row.topic_id || !row.unit_id || !row.explanation.includes("Source reference:"))) throw fail("Every question needs a syllabus topic and source reference before approval.", 409);
  const { error } = await admin.from("mock_test_questions").update({ source_verified: true, is_active: true, updated_at: new Date().toISOString() }).in("id", ids);
  if (error) throw error;
  return { approved: ids.length };
}

async function adminAnalytics() {
  const { data: attempts, error } = await admin.from("mock_test_attempts")
    .select("test_config_id,question_ids,answers,score,marks_per_question,submitted_at")
    .not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(500);
  if (error) throw error;
  const rows = attempts || [];
  const configIds = [...new Set(rows.map((row) => row.test_config_id))];
  const { data: configs, error: configError } = configIds.length
    ? await admin.from("mock_test_configs").select("id,title,course_id,courses(name,title,code,course_code)").in("id", configIds)
    : { data: [], error: null };
  if (configError) throw configError;
  const configMap = new Map((configs || []).map((row) => [row.id, row]));
  const ids = [...new Set(rows.flatMap((row) => row.question_ids || []))];
  const questionMap = new Map();
  for (let offset = 0; offset < ids.length; offset += 500) {
    const { data, error: questionError } = await admin.from("mock_test_questions").select("id,difficulty,correct_index").in("id", ids.slice(offset, offset + 500));
    if (questionError) throw questionError;
    for (const question of data || []) questionMap.set(question.id, question);
  }
  const submitted = rows.filter((row) => row.submitted_at);
  const totalPercent = submitted.reduce((sum, row) => sum + (Number(row.score || 0) / Math.max(1, row.question_ids.length * Number(row.marks_per_question || 1))) * 100, 0);
  const byCourse = new Map(); const byDay = new Map();
  const byDifficulty = Object.fromEntries(["easy", "medium", "hard"].map((key) => [key, { correct: 0, answered: 0, questions: 0 }]));
  for (const row of submitted) {
    const config = configMap.get(row.test_config_id);
    const label = config?.courses?.name || config?.courses?.title || config?.courses?.code || config?.course_id || "Unknown subject";
    const percent = (Number(row.score || 0) / Math.max(1, row.question_ids.length * Number(row.marks_per_question || 1))) * 100;
    const course = byCourse.get(label) || { attempts: 0, score_total: 0 };
    course.attempts++; course.score_total += percent; byCourse.set(label, course);
    const day = String(row.submitted_at).slice(0, 10); const trend = byDay.get(day) || { attempts: 0, score_total: 0 };
    trend.attempts++; trend.score_total += percent; byDay.set(day, trend);
    for (const id of row.question_ids || []) {
      const question = questionMap.get(id); if (!question || !byDifficulty[question.difficulty]) continue;
      const level = byDifficulty[question.difficulty]; level.questions++;
      if (Object.hasOwn(row.answers || {}, id)) { level.answered++; if (Number(row.answers[id]) === question.correct_index) level.correct++; }
    }
  }
  return {
    total_attempts: submitted.length,
    average_percentage: submitted.length ? Math.round(totalPercent / submitted.length) : null,
    by_course: [...byCourse].map(([course, value]) => ({ course, attempts: value.attempts, average_percentage: Math.round(value.score_total / value.attempts) })),
    by_day: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, attempts: value.attempts, average_percentage: Math.round(value.score_total / value.attempts) })),
    by_difficulty: byDifficulty,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return respond(res, 405, { error: "Only POST requests are allowed." }); }
  const missing = missingServerEnv({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SECRET_KEY: secretKey });
  if (missing.length || !authClient || !admin) return reportMissingServerEnv(res, "Learning tools", missing);
  const token = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return respond(res, 401, { error: "Sign in to continue." });
  try {
    const actor = await identity(token);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const action = body.action;
    authorizeLearningAction(actor.role, action);
    let data;
  if (action === "list-tests") data = await listTests(actor.id);
    else if (action === "start-test") data = await beginTest(actor.id, body);
    else if (action === "save-answer") data = await saveAnswer(actor.id, body);
    else if (action === "submit-test") data = await submitTest(actor.id, body);
    else if (action === "history") data = await listHistory(actor.id);
    else if (action === "view-result") data = await viewOwnResult(actor.id, body);
    else if (action === "admin-list") data = await adminConfigList();
    else if (action === "admin-questions") {
      const { data: rows, error } = await admin.from("mock_test_questions")
        .select("id, course_id, unit_id, topic_id, prompt, options, correct_index, explanation, difficulty, is_active, source_verified, created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      data = rows || [];
    }
    else if (action === "admin-results") {
      const { data: rows, error } = await admin.from("mock_test_attempts").select("id, test_config_id, student_id, created_at, submitted_at, score, correct_count, wrong_count, unanswered_count, question_ids, marks_per_question").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      data = rows || [];
    } else if (action === "generate-questions") data = await generateQuestions({ ...body, actor_id: actor.id });
    else if (action === "admin-analytics") data = await adminAnalytics();
    else if (action === "approve-questions") data = await approveQuestions(body);
    else if (action === "admin-contacts") {
      const { data: rows, error } = await admin.from("contact_messages").select("id,name,email,subject,message,status,created_at").order("created_at", { ascending: false }).limit(250);
      if (error) throw error;
      data = rows || [];
    } else if (action === "set-contact-status") {
      if (!validId(body.id) || !["new", "reviewed", "closed"].includes(body.status)) throw fail("Choose a valid contact record and status.");
      const { error } = await admin.from("contact_messages").update({ status: body.status }).eq("id", body.id);
      if (error) throw error;
      data = { updated: true };
    } else if (action === "save-config") data = await saveConfig(actor.id, body);
    else if (action === "delete-config") {
      if (!validId(body.id)) throw fail("Invalid test ID.");
      const { error } = await admin.from("mock_test_configs").delete().eq("id", body.id);
      if (error) throw error;
      data = { deleted: true };
    } else if (action === "save-question") data = await saveQuestion(actor.id, body);
    else if (action === "delete-question") {
      if (!validId(body.id)) throw fail("Invalid question ID.");
      const { data: references, error: referencesError } = await admin.from("mock_test_attempts").select("id").contains("question_ids", [body.id]).limit(1);
      if (referencesError) throw referencesError;
      if (references?.length) throw fail("This question is part of a saved test attempt and cannot be deleted. Deactivate it instead.", 409);
      const { error } = await admin.from("mock_test_questions").delete().eq("id", body.id);
      if (error) throw error;
      data = { deleted: true };
    } else throw fail("Unknown learning tool action.");
    if (["save-config", "delete-config", "save-question", "delete-question", "set-contact-status", "generate-questions", "approve-questions"].includes(action)) {
      const entityType = action.includes("config") ? "mock_test_config" : action.includes("question") ? "mock_test_question" : "contact_message";
      const verb = action === "generate-questions" ? "generated_drafts" : action === "approve-questions" ? "approved_questions" : action.startsWith("save-") ? (body.id ? "updated" : "created")
        : action.startsWith("delete-") ? "deleted" : "status_changed";
      const metadata = action === "save-config"
        ? { published: body.is_published === true, scope: body.scope, question_count: Number(body.question_count) }
        : action === "generate-questions" ? { course_id: body.course_id, topic_id: body.topic_id, question_count: Number(body.question_count) }
        : action === "approve-questions" ? { count: data?.approved || 0 }
        : action === "save-question"
          ? { course_id: body.course_id, topic_id: body.topic_id, difficulty: body.difficulty, active: body.is_active === true, source_verified: body.source_verified === true }
          : action === "set-contact-status" ? { status: body.status } : {};
      await auditLearningAdmin(actor.id, verb, entityType, data?.id || body.id, metadata);
    }
    return respond(res, 200, { data });
  } catch (error) {
    logApiFailure("learning_tools_request_failed", error, { route: "/api/learning" });
    const failure = mapLearningFailure(error);
    const { status, ...payload } = failure;
    return respond(res, status, payload);
  }
}
