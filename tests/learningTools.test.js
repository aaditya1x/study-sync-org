import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  authorizeLearningAction,
  evaluateAttempt,
  remainingSeconds,
  sha256Hex,
  validateContact,
  validatePdfFile,
  validateQuestion,
} from "../server/learningTools.js";

test("student, teacher, and Super Admin learning access is role-scoped", () => {
  assert.equal(authorizeLearningAction("student", "list-tests"), true);
  assert.equal(authorizeLearningAction("student", "view-result"), true);
  assert.throws(() => authorizeLearningAction("teacher", "start-test"), { status: 403 });
  assert.throws(() => authorizeLearningAction("teacher", "admin-list"), { status: 403 });
  assert.throws(() => authorizeLearningAction("student", "admin-contacts"), { status: 403 });
  assert.equal(authorizeLearningAction("super_admin", "admin-list"), true);
  assert.equal(authorizeLearningAction("super_admin", "admin-results"), true);
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
