import { createClient } from "@supabase/supabase-js";
import { logApiFailure, missingServerEnv, readServerEnv, reportMissingServerEnv } from "../server/apiDiagnostics.js";
import { authorizeLearningAction, evaluateAttempt, MOCK_DIFFICULTIES, MOCK_LENGTHS, MOCK_SCOPES, validateQuestion } from "../server/learningTools.js";
import { verifyActiveSuperAdmin } from "../server/teacherApprovalApi.js";

const url = readServerEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const publishableKey = readServerEnv("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY");
const secretKey = readServerEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
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

async function listTests() {
  return (await adminConfigList()).filter((test) => test.is_published);
}

async function beginTest(userId, input) {
  if (!validId(input.test_id)) throw fail("Choose a valid available test.");
  const { data: config, error: configError } = await admin.from("mock_test_configs").select("*").eq("id", input.test_id).eq("is_published", true).maybeSingle();
  if (configError) throw configError;
  if (!config) throw fail("This test is no longer available.", 404);
  let query = admin.from("mock_test_questions").select("id, prompt, options, correct_index, explanation, difficulty")
    .eq("course_id", config.course_id).eq("is_active", true).eq("source_verified", true);
  if (config.scope === "unit") query = query.eq("unit_id", config.unit_id);
  if (config.scope === "topic") query = query.eq("topic_id", config.topic_id);
  const requestedDifficulty = input.difficulty || config.difficulty;
  if (!["any", ...MOCK_DIFFICULTIES].includes(requestedDifficulty)
      || (config.difficulty !== "any" && requestedDifficulty !== config.difficulty)) throw fail("The selected difficulty is unavailable for this test.");
  if (requestedDifficulty !== "any") query = query.eq("difficulty", requestedDifficulty);
  const { data: bank, error: bankError } = await query;
  if (bankError) throw bankError;
  const requestedCount = Number(input.question_count || config.question_count);
  const requestedDuration = Number(input.duration_minutes || config.duration_minutes);
  if (!MOCK_LENGTHS.has(requestedCount) || !Number.isInteger(requestedDuration) || requestedDuration < 5 || requestedDuration > 180) throw fail("Choose a valid question count and duration.");
  if ((bank || []).length < requestedCount) throw fail(`This practice test needs ${requestedCount} active questions. The available verified question bank currently has ${bank?.length || 0}.`, 409);
  const selection = [...bank].sort(() => Math.random() - 0.5).slice(0, requestedCount);
  const now = new Date();
  const endsAt = new Date(now.getTime() + requestedDuration * 60_000);
  const { data: attempt, error: attemptError } = await admin.from("mock_test_attempts").insert({
    test_config_id: config.id, student_id: userId, question_ids: selection.map((question) => question.id), ends_at: endsAt.toISOString(),
  }).select("id, started_at, ends_at").single();
  if (attemptError) throw attemptError;
  return { attempt, test: { id: config.id, title: config.title, duration_minutes: requestedDuration }, questions: selection.map(publicQuestion) };
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
  const result = evaluateAttempt(ordered, attempt.answers || {});
  return { id: attempt.id, title, submitted_at: attempt.submitted_at, total: ordered.length, ...result };
}

async function listHistory(userId) {
  const { data: attempts, error } = await admin.from("mock_test_attempts")
    .select("id, test_config_id, created_at, submitted_at, score, correct_count, wrong_count, unanswered_count, question_ids")
    .eq("student_id", userId).not("submitted_at", "is", null).order("submitted_at", { ascending: false }).limit(100);
  if (error) throw error;
  const configs = [...new Set((attempts || []).map((row) => row.test_config_id))];
  const { data: tests, error: testError } = configs.length
    ? await admin.from("mock_test_configs").select("id,title").in("id", configs)
    : { data: [], error: null };
  if (testError) throw testError;
  const titles = new Map((tests || []).map((test) => [test.id, test.title]));
  return (attempts || []).map((row) => ({ ...row, title: titles.get(row.test_config_id) || "Practice test", total: row.question_ids.length }));
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
  const { data: questions, error: questionsError } = await admin.from("mock_test_questions").select("course_id,unit_id,topic_id,difficulty").eq("is_active", true).eq("source_verified", true);
  if (questionsError) throw questionsError;
  return configs.map((config) => {
    const matching = (questions || []).filter((question) => question.course_id === config.course_id
      && (config.scope !== "unit" || question.unit_id === config.unit_id)
      && (config.scope !== "topic" || question.topic_id === config.topic_id));
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
    difficulty: input.difficulty, question_count: Number(input.question_count), duration_minutes: Number(input.duration_minutes),
    is_published: input.is_published === true, created_by: actorId, updated_at: new Date().toISOString(),
  };
  if (title.length < 3 || title.length > 160 || !validId(row.course_id) || !MOCK_SCOPES.has(row.scope)
    || (row.unit_id && !validId(row.unit_id)) || (row.topic_id && !validId(row.topic_id))
    || !["any", ...MOCK_DIFFICULTIES].includes(row.difficulty) || !MOCK_LENGTHS.has(row.question_count)
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
    let query = admin.from("mock_test_questions").select("id", { count: "exact", head: true })
      .eq("course_id", row.course_id).eq("is_active", true).eq("source_verified", true);
    if (row.scope === "unit") query = query.eq("unit_id", row.unit_id);
    if (row.scope === "topic") query = query.eq("topic_id", row.topic_id);
    if (row.difficulty !== "any") query = query.eq("difficulty", row.difficulty);
    const { count, error: countError } = await query;
    if (countError) throw countError;
    if ((count || 0) < row.question_count) throw fail(`Add and verify at least ${row.question_count} matching practice questions before publishing this test.`);
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

async function saveQuestion(actorId, input) {
  if (!validId(input.course_id) || !validId(input.topic_id) || (input.unit_id && !validId(input.unit_id))) throw fail("Choose a valid subject, unit and topic.");
  const unit = await resolveTopic(input.topic_id);
  if (!unit || unit.course_id !== input.course_id || (input.unit_id && input.unit_id !== unit.id)) throw fail("The selected topic does not belong to this subject and unit.");
  if (input.is_active === true && input.source_verified !== true) throw fail("Review this Practice Question against the verified source syllabus before making it available.");
  const question = validateQuestion(input);
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
    if (action === "list-tests") data = await listTests();
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
      const { data: rows, error } = await admin.from("mock_test_attempts").select("id, test_config_id, student_id, created_at, submitted_at, score, correct_count, wrong_count, unanswered_count, question_ids").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      data = rows || [];
    } else if (action === "admin-contacts") {
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
    if (["save-config", "delete-config", "save-question", "delete-question", "set-contact-status"].includes(action)) {
      const entityType = action.includes("config") ? "mock_test_config" : action.includes("question") ? "mock_test_question" : "contact_message";
      const verb = action.startsWith("save-") ? (body.id ? "updated" : "created")
        : action.startsWith("delete-") ? "deleted" : "status_changed";
      const metadata = action === "save-config"
        ? { published: body.is_published === true, scope: body.scope, question_count: Number(body.question_count) }
        : action === "save-question"
          ? { course_id: body.course_id, topic_id: body.topic_id, difficulty: body.difficulty, active: body.is_active === true, source_verified: body.source_verified === true }
          : action === "set-contact-status" ? { status: body.status } : {};
      await auditLearningAdmin(actor.id, verb, entityType, data?.id || body.id, metadata);
    }
    return respond(res, 200, { data });
  } catch (error) {
    logApiFailure("learning_tools_request_failed", error, { route: "/api/learning" });
    return respond(res, error.status || 500, { error: error.status ? error.message : "The learning request could not be completed." });
  }
}
