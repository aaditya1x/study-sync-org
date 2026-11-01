import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseSyllabusText } from "../server/syllabusPdf.js";

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
