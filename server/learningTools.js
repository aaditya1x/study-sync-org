export const MOCK_DIFFICULTIES = new Set(["easy", "medium", "hard"]);
export const MOCK_SCOPES = new Set(["subject", "unit", "topic", "full"]);
export const MOCK_LENGTHS = new Set([10, 20, 30]);
export const MOCK_MARKS_PER_QUESTION = new Set([1, 2, 3, 4, 5]);
const ADMIN_ACTIONS = new Set(["admin-list", "admin-questions", "admin-results", "admin-analytics", "admin-contacts", "set-contact-status", "save-config", "delete-config", "save-question", "delete-question", "generate-questions", "approve-questions"]);
const STUDENT_ACTIONS = new Set(["list-tests", "start-test", "save-answer", "submit-test", "history", "view-result"]);

export function authorizeLearningAction(role, action) {
  if (ADMIN_ACTIONS.has(action) && role !== "super_admin") throw Object.assign(new Error("Super Admin access is required."), { status: 403 });
  if (STUDENT_ACTIONS.has(action) && role !== "student") throw Object.assign(new Error("Mock tests are available to student accounts."), { status: 403 });
  return true;
}

export function getStudentCourseIds(profile, courses, mappings, userId) {
  if (!profile || !profile.branch_id || profile.semester === null || profile.semester === undefined || !Number.isInteger(Number(profile.semester))) {
    throw Object.assign(new Error("Complete your academic profile, including branch and semester, to view practice tests."), { status: 409 });
  }
  const mapped = new Set((mappings || []).filter((row) => row.branch_id === profile.branch_id).map((row) => row.course_id));
  return [...new Set((courses || []).filter((course) => {
    const inAllocation = course.semester === Number(profile.semester)
      && (!course.academic_cycle_id || course.academic_cycle_id === profile.academic_cycle_id)
      && (profile.year_level == null || course.year_level == null || Number(course.year_level) === Number(profile.year_level));
    const visible = course.owner_id === userId || mapped.has(course.id);
    return inAllocation && visible && !course.archived_at;
  }).map((course) => course.id))];
}

export function uniquePracticeQuestions(questions) {
  const seen = new Set();
  return (questions || []).filter((question) => {
    const key = typeof question.prompt === "string"
      ? question.prompt.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase()
      : "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mapLearningFailure(error) {
  const databaseCode = String(error?.code || "");
  if (["42P01", "42703", "PGRST200", "PGRST201", "PGRST204", "PGRST205"].includes(databaseCode)) return {
    status: 503, code: "LEARNING_SCHEMA_UNAVAILABLE",
    error: "Mock Test schema is unavailable. The learning assessment migration is not applied or its required schema is incomplete.",
    database_code: databaseCode,
    required_migration: "20261106_learning_assessment_and_papers.sql",
    migration_status: "NOT_APPLIED",
  };
  if (["42883", "PGRST202"].includes(databaseCode)) return {
    status: 503, code: "LEARNING_DATABASE_FUNCTION_MISSING",
    error: "Mock Test scoring functions are unavailable. Review the learning assessment migration, then retry.",
    database_code: databaseCode,
    required_migration: "20261106_learning_assessment_and_papers.sql",
    migration_status: "NOT_APPLIED",
  };
  if (databaseCode === "42501") return {
    status: 403, code: "LEARNING_DATABASE_PERMISSION_DENIED",
    error: "The learning service does not have permission to complete this request. Check server database role configuration.",
    database_code: databaseCode,
  };
  if (error?.status) return {
    status: error.status, code: error.code || "LEARNING_REQUEST_REJECTED", error: error.message,
    ...(error.required_migration ? { required_migration: error.required_migration, migration_status: error.migration_status || "UNKNOWN" } : {}),
  };
  return {
    status: 500, code: "LEARNING_REQUEST_FAILED",
    error: "Mock Test data could not be loaded or saved. Check the learning API logs and retry.",
    ...(databaseCode ? { database_code: databaseCode } : {}),
  };
}

export function remainingSeconds(endsAt, now = Date.now()) {
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

export function validatePdfFile(file) {
  return Boolean(file && file.type === "application/pdf" && typeof file.name === "string"
    && file.name.toLowerCase().endsWith(".pdf") && Number.isInteger(file.size) && file.size > 0 && file.size <= 25 * 1024 * 1024);
}

export function validateQuestion(input = {}) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const options = input.options;
  const correctIndex = Number(input.correct_index);
  const difficulty = input.difficulty;
  if (prompt.length < 1 || prompt.length > 4000) throw new Error("Question text must be between 1 and 4000 characters.");
  if (!Array.isArray(options) || options.length !== 4 || options.some((option) => typeof option !== "string" || !option.trim() || option.length > 1000)) {
    throw new Error("Each practice question must have four non-empty options of at most 1000 characters.");
  }
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) throw new Error("Choose one correct answer.");
  if (!MOCK_DIFFICULTIES.has(difficulty)) throw new Error("Choose Easy, Medium, or Hard difficulty.");
  const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
  if (explanation.length > 4000) throw new Error("Explanation is too long.");
  return { prompt, options: options.map((option) => option.trim()), correct_index: correctIndex, difficulty, explanation };
}

export function evaluateAttempt(questions, answers, marksPerQuestion = 1) {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 30) throw new Error("The test question set is invalid.");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("Submitted answers are invalid.");
  if (!Number.isInteger(marksPerQuestion) || marksPerQuestion < 1 || marksPerQuestion > 5) throw new Error("The test marks configuration is invalid.");
  const allowedIds = new Set(questions.map((question) => question.id));
  for (const [id, value] of Object.entries(answers)) {
    if (!allowedIds.has(id) || !Number.isInteger(value) || value < 0 || value > 3) throw new Error("Submitted answers contain an invalid question or option.");
  }
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;
  const review = questions.map((question) => {
    const picked = Object.hasOwn(answers, question.id) ? answers[question.id] : null;
    if (picked === null) unanswered += 1;
    else if (picked === question.correct_index) correct += 1;
    else wrong += 1;
    return { id: question.id, prompt: question.prompt, options: question.options, picked, correct_index: question.correct_index, explanation: question.explanation || "" };
  });
  return { correct, wrong, unanswered, score: correct * marksPerQuestion, total: questions.length * marksPerQuestion, marks_per_question: marksPerQuestion, percentage: Math.round((correct / questions.length) * 100), review };
}

export function validateContact(input = {}) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (name.length < 2 || name.length > 100) throw new Error("Enter a name between 2 and 100 characters.");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (subject.length < 3 || subject.length > 160) throw new Error("Enter a subject between 3 and 160 characters.");
  if (message.length < 10 || message.length > 5000) throw new Error("Enter a message between 10 and 5000 characters.");
  return { name, email, subject, message };
}

export function sha256Hex(value, createHash) {
  return createHash("sha256").update(String(value || "unknown")).digest("hex");
}
