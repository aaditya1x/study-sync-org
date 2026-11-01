import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase-migrations/20261111_pyq_branch_mapping_visibility.sql", import.meta.url), "utf8");

test("PYQ row and private-object reads honor direct and mapped branch allocations", () => {
  assert.equal((migration.match(/course\.branch_id = profile\.branch_id or exists/gi) || []).length, 4);
  assert.equal((migration.match(/mapping\.course_id = course\.id and mapping\.branch_id = profile\.branch_id/gi) || []).length, 4);
  assert.equal((migration.match(/paper\.is_published and paper\.verified/gi) || []).length, 2);
  assert.equal((migration.match(/is_published and verified and course_id is not null/gi) || []).length, 2);
  assert.equal((migration.match(/profile\.semester = (?:previous_year_papers|paper)\.semester/gi) || []).length, 4);
  assert.equal((migration.match(/course\.semester = (?:previous_year_papers|paper)\.semester/gi) || []).length, 4);
  assert.equal((migration.match(/course\.academic_cycle_id is null/gi) || []).length, 4);
  assert.equal((migration.match(/not exists \([\s\S]*?from public\.academic_staff staff/gi) || []).length, 4);
  assert.match(migration, /public\.is_super_admin\(\)/);
  assert.match(migration, /public\.is_current_user_active\(\)/);
});

test("targeted PYQ visibility migration changes read policies only and keeps private storage", () => {
  assert.match(migration, /as restrictive for select to authenticated/);
  assert.doesNotMatch(migration, /create policy .* for insert|create policy .* for update|create policy .* for delete/i);
  assert.doesNotMatch(migration, /update public\.previous_year_papers|delete from public\.previous_year_papers|insert into public\.previous_year_papers/i);
  assert.doesNotMatch(migration, /storage\.buckets|public\s*=\s*true/i);
  assert.match(migration, /Review and apply manually/);
});
