import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { branchIdsForCourse, courseVisibleToBranch, visibleCoursesForWorkspace, visibleMaterialsForWorkspace } from "../src/lib/courseVisibility.js";

const cse = "branch-cse";
const aiml = "branch-cse-aiml";
const other = "branch-mech";
const fiveExistingSubjects = [
  "Computer Organization and Architecture",
  "Data Structures",
  "Database Management System",
  "Digital System Design",
  "OOP using Java",
].map((name, index) => ({
  id: `existing-${index}`,
  name,
  branch_id: cse,
  course_branch_visibility: [{ branch_id: cse }, { branch_id: aiml }],
}));

test("CSE and CSE AIML students see the same five existing mapped subject rows", () => {
  for (const branchId of [cse, aiml]) {
    const visible = visibleCoursesForWorkspace(fiveExistingSubjects, { role: "student", branchId });
    assert.equal(visible.length, 5);
    assert.deepEqual(visible.map((course) => course.id), fiveExistingSubjects.map((course) => course.id));
  }
});

test("unmapped branches do not see centrally mapped subjects", () => {
  assert.equal(fiveExistingSubjects.some((course) => courseVisibleToBranch(course, other)), false);
  assert.deepEqual(visibleCoursesForWorkspace(fiveExistingSubjects, { role: "student", branchId: other }), []);
});

test("mapped subject rows are deduplicated and visibility does not depend on semester", () => {
  const duplicate = { ...fiveExistingSubjects[0], semester: 99 };
  const visible = visibleCoursesForWorkspace([duplicate, duplicate], { role: "student", branchId: aiml });
  assert.equal(visible.length, 1);
  assert.deepEqual(branchIdsForCourse(duplicate), [cse, aiml]);
});

test("personal subjects remain owner-visible only, and Super Admin sees all rows", () => {
  const personal = { id: "personal", owner_id: "student-1", branch_id: null, course_branch_visibility: [] };
  assert.deepEqual(visibleCoursesForWorkspace([personal], { role: "student", userId: "student-1", branchId: other }), [personal]);
  assert.deepEqual(visibleCoursesForWorkspace([personal], { role: "student", userId: "student-2", branchId: other }), []);
  assert.deepEqual(visibleCoursesForWorkspace([personal, ...fiveExistingSubjects], { role: "super_admin" }).map((course) => course.id), ["personal", ...fiveExistingSubjects.map((course) => course.id)]);
});

test("shared materials follow mapped subject visibility and private materials stay owner-only", () => {
  const shared = { id: "shared-file", userId: "student-2", courseId: fiveExistingSubjects[0].id, isShared: true };
  const privateFile = { id: "private-file", userId: "student-2", courseId: fiveExistingSubjects[0].id, isShared: false };
  const ownPrivate = { id: "own-private", userId: "student-1", courseId: fiveExistingSubjects[0].id, isShared: false };
  assert.deepEqual(visibleMaterialsForWorkspace([shared, privateFile, ownPrivate], fiveExistingSubjects, { role: "student", userId: "student-1", branchId: aiml }).map((item) => item.id), ["shared-file", "own-private"]);
  assert.deepEqual(visibleMaterialsForWorkspace([shared], fiveExistingSubjects, { role: "student", userId: "student-1", branchId: other }), []);
});

test("migration contract keeps mapping writes Super Admin-only and PYQ allocation checks intact", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const migration = await readFile(resolve(here, "../supabase-migrations/20261108_shared_subject_branch_visibility.sql"), "utf8");
  assert.match(migration, /course branch visibility super admin manage[\s\S]+?using \(public\.is_super_admin\(\)\) with check \(public\.is_super_admin\(\)\)/i);
  assert.match(migration, /course branch visibility active guard[\s\S]+?public\.is_current_user_active\(\)/i);
  assert.match(migration, /published verified papers read[\s\S]+?is_published and verified[\s\S]+?profile\.semester=previous_year_papers\.semester[\s\S]+?course\.semester=previous_year_papers\.semester/i);
  assert.match(migration, /pyq object select access guard[\s\S]+?public\.is_super_admin\(\)[\s\S]+?paper\.is_published and paper\.verified/i);
  assert.match(migration, /course_branch_visibility[\s\S]+?unique \(course_id, branch_id\)/i);
});
