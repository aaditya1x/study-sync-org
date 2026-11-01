export const MOCK_DIFFICULTIES = new Set(["easy", "medium", "hard"]);
export const MOCK_SCOPES = new Set(["subject", "unit", "topic", "full"]);
export const MOCK_LENGTHS = new Set([10, 20, 30]);
const ADMIN_ACTIONS = new Set(["admin-list", "admin-questions", "admin-results", "admin-contacts", "set-contact-status", "save-config", "delete-config", "save-question", "delete-question"]);
const STUDENT_ACTIONS = new Set(["list-tests", "start-test", "save-answer", "submit-test", "history", "view-result"]);

export function authorizeLearningAction(role, action) {
  if (ADMIN_ACTIONS.has(action) && role !== "super_admin") throw Object.assign(new Error("Super Admin access is required."), { status: 403 });
  if (STUDENT_ACTIONS.has(action) && role !== "student") throw Object.assign(new Error("Mock tests are available to student accounts."), { status: 403 });
  return true;
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

export function evaluateAttempt(questions, answers) {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 30) throw new Error("The test question set is invalid.");
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("Submitted answers are invalid.");
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
  return { correct, wrong, unanswered, score: correct, percentage: Math.round((correct / questions.length) * 100), review };
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
