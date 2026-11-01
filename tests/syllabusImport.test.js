import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseSyllabusText, syllabusExtractionIssue, syllabusSourceKey } from "../server/syllabusPdf.js";
import { sourceMatchesSelectedCourse, syllabusSourcesForCourse } from "../src/lib/syllabusImport.js";

test("syllabus parser extracts only explicit unit and topic lines and matches subject evidence", () => {
  const outline = parseSyllabusText([
    "DATA STRUCTURES",
    "UNIT I: Linear Data Structures",
    "Arrays and linked lists",
    "  1.1 Singly linked list operations",
    "Stacks; Queues",
    "UNIT II - Trees",
    "Binary search trees",
  ].join("\n"), { name: "Data Structures", code: "PCCSE201" });
  assert.equal(outline.subject_found_in_pdf, true);
  assert.deepEqual(outline.units.map((unit) => [unit.number, unit.title]), [[1, "Linear Data Structures"], [2, "Trees"]]);
  assert.deepEqual(outline.units[0].topics[0], { title: "Arrays and linked lists", subtopics: ["Singly linked list operations"] });
  assert.deepEqual(outline.units[0].topics.slice(1).map((topic) => topic.title), ["Stacks", "Queues"]);
  assert.deepEqual(outline.units[1].topics.map((topic) => topic.title), ["Binary search trees"]);
});

test("parser reports no usable syllabus outline for unreadable or non-outline text", () => {
  assert.deepEqual(parseSyllabusText("", { name: "Data Structures" }).units, []);
  assert.deepEqual(parseSyllabusText("This document has readable text but no explicit unit headings.", { name: "Data Structures" }).units, []);
  assert.equal(parseSyllabusText("UNIT I: Linear Data Structures\nArrays", { name: "Chemistry" }).subject_found_in_pdf, false);
});

test("undefined PDF text and course metadata fail safely with a useful empty-content error", () => {
  const outline = parseSyllabusText(undefined, undefined);
  assert.equal(outline.subject_found_in_pdf, false);
  assert.deepEqual(outline.units, []);
  assert.match(syllabusExtractionIssue(outline, { selectedCourseId: "course-a" }), /does not match the selected subject/);
  assert.match(syllabusExtractionIssue(undefined, { selectedCourseId: "course-a" }), /did not produce readable syllabus content/);
  assert.throws(() => syllabusSourceKey(undefined), { status: 422, message: /missing or invalid topic title/ });
});

test("PDF parser failures are rejected instead of becoming pending syllabus previews", () => {
  assert.match(syllabusExtractionIssue(undefined, { selectedCourseId: "course-a", extractionFailed: true }), /text extraction failed/);
  const validOutline = { subject_found_in_pdf: true, units: [{ number: 1, title: "Unit 1", topics: [{ title: "Topic" }] }] };
  assert.equal(syllabusExtractionIssue(validOutline, { selectedCourseId: "course-a" }), null);
  assert.match(syllabusExtractionIssue({ ...validOutline, units: [{ number: 1, title: "Unit 1", topics: [{ title: undefined }] }] }, { selectedCourseId: "course-a" }), /missing or invalid topic metadata/);
  assert.match(syllabusExtractionIssue({ ...validOutline, units: [{ number: 1, title: "Unit 1", topics: [{ title: "Topic", subtopics: [undefined] }] }] }, { selectedCourseId: "course-a" }), /missing or invalid topic metadata/);
});

test("a syllabus with another subject name is rejected before review or publish", () => {
  const extracted = parseSyllabusText("COMPUTER ORGANIZATION AND ARCHITECTURE\nUNIT I: Processor Design\nInstruction cycles", {
    name: "Digital System Design", code: "ESECE201D",
  });
  assert.equal(extracted.subject_found_in_pdf, false);
  assert.match(syllabusExtractionIssue(extracted, { selectedCourseId: "digital-design" }), /does not match the selected subject/);
  assert.match(syllabusExtractionIssue(extracted, { selectedCourseId: "digital-design", sourceCourseId: "computer-architecture" }), /not associated with the selected subject/);
});

test("two-page Puran Murti COA extraction matches PCCSE207 and keeps Units I-IV", () => {
  const extractedPageText = [
    [
      "Puran Murti Vidyapeeth", "Course Code: PCCSE207", "Computer Organization and Architecture",
      "UNIT - I: Basic Structure of Computers", "Functional units and operational concepts",
      "UNIT - II: Machine Instructions", "Instruction formats and addressing modes",
      "UNIT - III: Arithmetic Operations", "Addition, subtraction and multiplication",
    ].join("\n"),
    ["UNIT IV: Memory Organization", "Cache memory and virtual memory"].join("\n"),
  ].join("\n----------------Page (0) Break----------------\n");
  const outline = parseSyllabusText(extractedPageText, { name: "Computer Organization and Architecture", code: "PCCSE207" });
  assert.equal(outline.subject_found_in_pdf, true);
  assert.deepEqual(outline.units.map(({ number, title, topics }) => [number, title, topics.map((topic) => topic.title)]), [
    [1, "Basic Structure of Computers", ["Functional units and operational concepts"]],
    [2, "Machine Instructions", ["Instruction formats and addressing modes"]],
    [3, "Arithmetic Operations", ["Addition, subtraction and multiplication"]],
    [4, "Memory Organization", ["Cache memory and virtual memory"]],
  ]);
  assert.equal(syllabusExtractionIssue(outline, { selectedCourseId: "coa", sourceCourseId: "coa" }), null);
  const digitalDesign = parseSyllabusText("Course Code: PCCSE207\nUNIT - I: Logic Design\nBoolean algebra", {
    name: "Digital System Design", code: "ESECE201D",
  });
  assert.equal(digitalDesign.subject_found_in_pdf, false);
});

test("syllabus previews are scoped to the currently selected course", () => {
  const sources = [
    { id: "source-a", course_id: "course-a" },
    { id: "source-b", course_id: "course-b" },
  ];
  assert.deepEqual(syllabusSourcesForCourse(sources, "course-a"), [sources[0]]);
  assert.deepEqual(syllabusSourcesForCourse(sources, "course-c"), []);
  assert.equal(sourceMatchesSelectedCourse(sources[0], "course-b"), false);
  assert.equal(sourceMatchesSelectedCourse(sources[0], "course-a"), true);
});

test("syllabus API guards source keys and records the exact course before a preview can be returned", async () => {
  const apiSource = await readFile(new URL("../api/syllabus-import.js", import.meta.url), "utf8");
  assert.match(apiSource, /syllabusSourceKey\(topicTitle\)/);
  assert.match(apiSource, /syllabusSourceKey\(subTitle\)/);
  assert.match(apiSource, /selectedCourseId: courseId,[\s\S]*sourceCourseId: course\.id/);
  assert.match(apiSource, /select\("id,course_id,status,extracted_outline,processing_error"\)/);
  assert.match(apiSource, /selectedCourseId: source\.course_id, sourceCourseId: source\.course_id/);
});

test("migration keeps source documents private and requires active Super Admin policies", async () => {
  const sql = await readFile(new URL("../supabase-migrations/20261109_academic_syllabus_import.sql", import.meta.url), "utf8");
  assert.match(sql, /values \('academic-syllabi', 'academic-syllabi', false, 26214400, array\['application\/pdf'\]\)/i);
  assert.match(sql, /public\.is_current_user_active\(\)\s+and public\.is_super_admin\(\)/i);
  assert.match(sql, /status text not null default 'pending_review'/i);
  assert.match(sql, /parent_topic_id uuid references public\.academic_topics\(id\)/i);
  assert.match(sql, /create policy "pending syllabus topics hidden" on public\.academic_topics as restrictive/i);
  assert.match(sql, /public\.syllabus_source_is_verified\(syllabus_source_id\)/i);
  assert.doesNotMatch(sql, /create policy[^;]+for update[^;]+on storage\.objects/is);
});
