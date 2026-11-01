import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  authorizeLearningAction,
  evaluateAttempt,
  getStudentCourseIds,
  mapLearningFailure,
  remainingSeconds,
  sha256Hex,
  uniquePracticeQuestions,
  validateContact,
  validatePdfFile,
  validateQuestion,
} from "../server/learningTools.js";
import { parseLearningResponse } from "../src/lib/learningResponse.js";
import { buildQuestionGenerationPrompt, difficultyTargets, validateGeneratedQuestions } from "../server/mockTestGenerator.js";

const learningMigration = await readFile(new URL("../supabase-migrations/20261110_mock_test_marks.sql", import.meta.url), "utf8");
const viteConfig = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");

test("student, teacher, and Super Admin learning access is role-scoped", () => {
  assert.equal(authorizeLearningAction("student", "list-tests"), true);
  assert.equal(authorizeLearningAction("student", "view-result"), true);
  assert.throws(() => authorizeLearningAction("teacher", "start-test"), { status: 403 });
  assert.throws(() => authorizeLearningAction("teacher", "admin-list"), { status: 403 });
  assert.throws(() => authorizeLearningAction("student", "admin-contacts"), { status: 403 });
  assert.equal(authorizeLearningAction("super_admin", "admin-list"), true);
  assert.equal(authorizeLearningAction("super_admin", "admin-results"), true);
  assert.equal(authorizeLearningAction("super_admin", "generate-questions"), true);
  assert.equal(authorizeLearningAction("super_admin", "approve-questions"), true);
  assert.throws(() => authorizeLearningAction("teacher", "generate-questions"), { status: 403 });
  assert.throws(() => authorizeLearningAction("student", "approve-questions"), { status: 403 });
});

test("AI mock questions are source-attributed drafts with validated structure and exact difficulty mix", () => {
  assert.deepEqual(difficultyTargets(10), { easy: 3, medium: 5, hard: 2 });
  assert.deepEqual(difficultyTargets(20), { easy: 6, medium: 10, hard: 4 });
  assert.deepEqual(difficultyTargets(30), { easy: 9, medium: 15, hard: 6 });
  const questions = Array.from({ length: 10 }, (_, index) => ({
    prompt: `Question ${index + 1}?`, options: ["A", "B", "C", "D"], correct_index: 0,
    explanation: "Supported by the source.", difficulty: index < 3 ? "easy" : index < 8 ? "medium" : "hard", source_evidence: "verified source statement with enough detail",
  }));
  const saved = validateGeneratedQuestions({ questions }, {
    count: 10, courseId: "course", unitId: "unit", topicId: "topic", difficulty: "any", sourceReference: "verified-syllabus.pdf", sourceText: "This verified source statement with enough detail supports the answer.",
  });
  assert.equal(saved.length, 10);
  assert.equal(saved.every((row) => row.is_active === false && row.source_verified === false), true);
  assert.equal(saved.every((row) => row.explanation.includes("Source reference: verified-syllabus.pdf")), true);
  assert.equal(saved.every((row) => row.explanation.includes("Source evidence:")), true);
  assert.throws(() => validateGeneratedQuestions({ questions: questions.slice(1) }, {
    count: 10, courseId: "course", unitId: "unit", topicId: "topic", difficulty: "any", sourceReference: "source.pdf", sourceText: "verified source statement with enough detail",
  }), /requested number/);
  assert.throws(() => validateGeneratedQuestions({ questions: questions.map((row) => ({ ...row, difficulty: "easy" })) }, {
    count: 10, courseId: "course", unitId: "unit", topicId: "topic", difficulty: "any", sourceReference: "source.pdf", sourceText: "verified source statement with enough detail",
  }), /30\/50\/20/);
  const prompt = buildQuestionGenerationPrompt({ course: "Math", unit: "Unit 1", topic: "Limits", difficulty: "any", count: 10, sourceText: "verified syllabus excerpt", sourceName: "syllabus.pdf" });
  assert.match(prompt, /verified syllabus PDF text/);
  assert.match(prompt, /syllabus\.pdf/);
});

test("local Vite serves the learning API and safely diagnoses missing learning schema", () => {
  assert.match(viteConfig, /"\/api\/learning"\s*:\s*\(\)\s*=>\s*loadApiHandler\("learning\.js"\)/);
  assert.deepEqual(mapLearningFailure({ code: "42P01" }), {
    status: 503,
    code: "LEARNING_SCHEMA_UNAVAILABLE",
    error: "Mock Test schema is unavailable. The learning assessment migration is not applied or its required schema is incomplete.",
    database_code: "42P01",
    required_migration: "20261106_learning_assessment_and_papers.sql",
    migration_status: "NOT_APPLIED",
  });
  assert.deepEqual(mapLearningFailure({ code: "PGRST205" }), {
    status: 503,
    code: "LEARNING_SCHEMA_UNAVAILABLE",
    error: "Mock Test schema is unavailable. The learning assessment migration is not applied or its required schema is incomplete.",
    database_code: "PGRST205",
    required_migration: "20261106_learning_assessment_and_papers.sql",
    migration_status: "NOT_APPLIED",
  });
  assert.equal(mapLearningFailure({ code: "42703" }).code, "LEARNING_SCHEMA_UNAVAILABLE");
  assert.equal(mapLearningFailure({ code: "PGRST200" }).code, "LEARNING_SCHEMA_UNAVAILABLE");
  assert.equal(mapLearningFailure({ code: "42501" }).code, "LEARNING_DATABASE_PERMISSION_DENIED");
});

test("Mock Tests client reports endpoint status and sanitized Supabase diagnostics", () => {
  assert.deepEqual(parseLearningResponse(200, true, JSON.stringify({ data: [{ id: "test" }] })), [{ id: "test" }]);
  assert.throws(() => parseLearningResponse(404, false, "<html>not found</html>"), /invalid response \(HTTP 404\)/);
  assert.throws(() => parseLearningResponse(503, false, JSON.stringify({
    code: "LEARNING_SCHEMA_UNAVAILABLE", database_code: "42P01", error: "Mock Test tables are unavailable.",
  })), /Supabase 42P01; HTTP 503/);
  assert.throws(() => parseLearningResponse(503, false, JSON.stringify({
    code: "LEARNING_SCHEMA_UNAVAILABLE", database_code: "PGRST205",
    error: "Mock Test schema is unavailable.", required_migration: "20261106_learning_assessment_and_papers.sql",
    migration_status: "NOT_APPLIED",
  })), /20261106_learning_assessment_and_papers\.sql \(NOT_APPLIED\)/);
});

test("published test scope matches student branch, semester, cycle and year", () => {
  const profile = { branch_id: "branch-a", semester: 3, academic_cycle_id: "cycle-a", year_level: 2 };
  const courses = [
    { id: "mapped", semester: 3, academic_cycle_id: "cycle-a", year_level: 2 },
    { id: "wrong-semester", semester: 4, academic_cycle_id: "cycle-a", year_level: 2 },
    { id: "wrong-cycle", semester: 3, academic_cycle_id: "cycle-b", year_level: 2 },
    { id: "wrong-branch", semester: 3, academic_cycle_id: "cycle-a", year_level: 2, branch_id: "branch-b" },
  ];
  assert.deepEqual(getStudentCourseIds(profile, courses, [{ course_id: "mapped", branch_id: "branch-a" }], "student-a"), ["mapped"]);
  assert.throws(() => getStudentCourseIds(null, courses, [], "student-a"), /Complete your academic profile/);
});

test("practice test generation removes duplicate prompts before counting and selection", () => {
  const deduplicated = uniquePracticeQuestions([
    { id: "1", prompt: "What is abstraction?" },
    { id: "2", prompt: "  WHAT   IS abstraction?  " },
    { id: "3", prompt: "What is encapsulation?" },
  ]);
  assert.deepEqual(deduplicated.map((question) => question.id), ["1", "3"]);
});

test("mock question validation requires exactly four usable choices and a valid answer", () => {
  const valid = { prompt: "Which topic is this?", options: ["A", "B", "C", "D"], correct_index: 1, difficulty: "medium", explanation: "Because the source topic says so." };
  assert.deepEqual(validateQuestion(valid), { ...valid, prompt: valid.prompt, options: valid.options, correct_index: 1, explanation: valid.explanation });
  assert.throws(() => validateQuestion({ ...valid, options: ["A", "B", "C"] }), /four non-empty options/);
  assert.throws(() => validateQuestion({ ...valid, correct_index: 4 }), /correct answer/);
  assert.throws(() => validateQuestion({ ...valid, difficulty: "official-pyq" }), /difficulty/);
});

test("attempt evaluation reports correct, wrong, unattempted and rejects foreign or invalid answers", () => {
  const questions = [
    { id: "q1", prompt: "One?", options: ["a", "b", "c", "d"], correct_index: 2, explanation: "explain" },
    { id: "q2", prompt: "Two?", options: ["a", "b", "c", "d"], correct_index: 0, explanation: "" },
    { id: "q3", prompt: "Three?", options: ["a", "b", "c", "d"], correct_index: 3, explanation: "" },
  ];
  const result = evaluateAttempt(questions, { q1: 2, q2: 1 });
  assert.deepEqual([result.correct, result.wrong, result.unanswered, result.score, result.percentage], [1, 1, 1, 1, 33]);
  assert.equal(result.review[2].picked, null);
  assert.equal(result.review[0].correct_index, 2);
  assert.throws(() => evaluateAttempt(questions, { q4: 0 }), /invalid question/);
  assert.throws(() => evaluateAttempt(questions, { q1: 7 }), /invalid question/);
});

test("practice marks are weighted from the stored correct answer and migration updates the scoring RPC", () => {
  const questions = [
    { id: "q1", prompt: "One?", options: ["a", "b", "c", "d"], correct_index: 2 },
    { id: "q2", prompt: "Two?", options: ["a", "b", "c", "d"], correct_index: 0 },
  ];
  const result = evaluateAttempt(questions, { q1: 2 }, 3);
  assert.deepEqual([result.score, result.total, result.percentage, result.unanswered], [3, 6, 50, 1]);
  assert.match(learningMigration, /add column if not exists marks_per_question/);
  assert.match(learningMigration, /score = correct_total \* saved_attempt\.marks_per_question/);
  assert.match(learningMigration, /alter table public\.mock_test_attempts[\s\S]+?add column if not exists marks_per_question/);
  assert.match(learningMigration, /from public\.mock_test_questions/);
});

test("timer calculation reaches zero at and after the server deadline", () => {
  assert.equal(remainingSeconds("2030-01-01T00:00:10.000Z", Date.parse("2030-01-01T00:00:00.000Z")), 10);
  assert.equal(remainingSeconds("2030-01-01T00:00:00.000Z", Date.parse("2030-01-01T00:00:00.001Z")), 0);
  assert.equal(remainingSeconds("not-a-date"), 0);
});

test("private PYQ uploads accept only bounded PDF metadata", () => {
  assert.equal(validatePdfFile({ name: "paper.pdf", type: "application/pdf", size: 100 }), true);
  assert.equal(validatePdfFile({ name: "paper.pdf", type: "application/pdf", size: 26 * 1024 * 1024 }), false);
  assert.equal(validatePdfFile({ name: "paper.pdf", type: "text/html", size: 100 }), false);
  assert.equal(validatePdfFile({ name: "paper.html", type: "application/pdf", size: 100 }), false);
});

test("contact form validation and keyed message rate identifier support", () => {
  assert.deepEqual(validateContact({ name: "Alex Student", email: "ALEX@example.com", subject: "Help please", message: "I have a question about my account." }), {
    name: "Alex Student", email: "alex@example.com", subject: "Help please", message: "I have a question about my account.",
  });
  assert.throws(() => validateContact({ name: "A", email: "bad", subject: "??", message: "short" }), /name between/);
  assert.equal(sha256Hex("127.0.0.1", createHash), createHash("sha256").update("127.0.0.1").digest("hex"));
});
