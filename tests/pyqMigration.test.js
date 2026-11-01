import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase-migrations/20261107_previous_year_papers_allocation_scope.sql", import.meta.url), "utf8");

test("PYQ paper reads require a verified publication and the student's allocation", () => {
  assert.match(migration, /is_published\s+and verified and course_id is not null/);
  assert.match(migration, /profile\.user_id = auth\.uid\(\)/);
  assert.match(migration, /course\.branch_id = profile\.branch_id/);
  assert.match(migration, /not exists \([\s\S]*?from public\.academic_staff staff where staff\.user_id = auth\.uid\(\)/);
  assert.match(migration, /course\.academic_cycle_id is null\s+or course\.academic_cycle_id = profile\.academic_cycle_id/);
  assert.match(migration, /profile\.semester = previous_year_papers\.semester/);
  assert.match(migration, /course\.semester = previous_year_papers\.semester/);
  assert.match(migration, /public\.is_super_admin\(\)/);
});

test("only Super Admins can write paper metadata and private bucket objects", () => {
  assert.match(migration, /create policy "super admins manage papers"[\s\S]*?for all to authenticated[\s\S]*?using \(public\.is_super_admin\(\)\)[\s\S]*?with check \(public\.is_super_admin\(\)\)/);
  assert.match(migration, /create policy "super admins upload pyq objects"[\s\S]*?public\.is_super_admin\(\)/);
  assert.match(migration, /create policy "super admins delete pyq objects"[\s\S]*?public\.is_super_admin\(\)/);
  assert.match(migration, /pyq object insert access guard[\s\S]*?as restrictive/);
  assert.match(migration, /pyq object update access guard[\s\S]*?as restrictive/);
  assert.match(migration, /pyq object delete access guard[\s\S]*?as restrictive/);
  assert.match(migration, /paper insert admin guard[\s\S]*?for insert to authenticated with check \(public\.is_super_admin\(\)\)/);
  assert.match(migration, /paper update admin guard[\s\S]*?using \(public\.is_super_admin\(\)\) with check \(public\.is_super_admin\(\)\)/);
  assert.match(migration, /paper delete admin guard[\s\S]*?for delete to authenticated using \(public\.is_super_admin\(\)\)/);
  assert.match(migration, /paper active account guard[\s\S]*?as restrictive[\s\S]*?public\.is_current_user_active\(\)/);
  assert.match(migration, /pyq object active account guard[\s\S]*?as restrictive[\s\S]*?public\.is_current_user_active\(\)/);
});

test("missing schema prerequisites fail before the migration creates PYQ objects", () => {
  for (const prerequisite of [
    "('courses', 'branch_id')",
    "('courses', 'academic_cycle_id')",
    "('courses', 'semester')",
    "('academic_profiles', 'branch_id')",
    "('academic_profiles', 'academic_cycle_id')",
    "('academic_profiles', 'semester')",
    "public.academic_units",
    "log_academic_admin_change",
  ]) assert.ok(migration.includes(prerequisite), `missing prerequisite check: ${prerequisite}`);
  assert.match(migration, /raise exception 'PYQ migration prerequisites missing columns/);
  assert.match(migration, /raise exception 'PYQ migration prerequisite missing: public\.academic_units/);
  assert.match(migration, /raise exception 'PYQ migration prerequisite missing: public\.log_academic_admin_change/);
  assert.ok(migration.indexOf("PYQ migration prerequisites missing columns") < migration.indexOf("create table if not exists public.previous_year_papers"));
});

test("an existing papers table is checked for compatible columns and keys", () => {
  assert.match(migration, /Existing public\.previous_year_papers has missing or incompatible columns/);
  assert.match(migration, /is missing expected integrity checks/);
  assert.match(migration, /must have PRIMARY KEY \(id\)/);
  assert.match(migration, /must uniquely index storage_path/);
  assert.match(migration, /is missing its course_id or unit_id foreign key/);
  assert.match(migration, /is missing its uploaded_by or published_by auth\.users foreign key/);
});

test("bucket validation fails closed for null or non-exact settings without changing existing config", () => {
  assert.match(migration, /public is false\s+and file_size_limit = 26214400\s+and allowed_mime_types = array\['application\/pdf'\]::text\[\]/);
  assert.doesNotMatch(migration, /file_size_limit is null|allowed_mime_types is null/);
  assert.match(migration, /Existing settings were not changed/);
  assert.match(migration, /on conflict \(id\) do nothing/);
});

test("storage remains private, generated questions stay separate, and no object update policy is added", async () => {
  assert.match(migration, /values \('previous-year-papers', 'previous-year-papers', false/);
  assert.match(migration, /content_type text not null check \(content_type = 'application\/pdf'\)/);
  assert.match(migration, /create table if not exists public\.previous_year_papers/);
  assert.doesNotMatch(migration, /drop table|truncate table|delete from public\./i);
  assert.doesNotMatch(migration, /create policy "super admins update pyq objects"/i);
  const component = await readFile(new URL("../src/components/PreviousYearQuestions/PreviousYearQuestions.jsx", import.meta.url), "utf8");
  assert.match(component, /storage\.from\(BUCKET\)\.upload/);
  assert.match(component, /storage\.from\(BUCKET\)\.remove/);
  assert.match(component, /storage\.from\(BUCKET\)\.createSignedUrl/);
  assert.doesNotMatch(component, /storage\.from\(BUCKET\)\.update/);
});
