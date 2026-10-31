import test from "node:test";
import assert from "node:assert/strict";
import { fetchPlatformRole, getWorkspaceAccess } from "../src/lib/workspaceAccess.js";

const authenticated = { authenticated: true, authLoading: false, roleLoading: false };

test("role lookup uses the current authenticated UID and defaults only missing staff rows to student", async () => {
  let requestedUserId;
  const client = {
    from(table) {
      assert.equal(table, "academic_staff");
      return {
        select(columns) {
          assert.equal(columns, "role");
          return {
            eq(column, userId) {
              assert.equal(column, "user_id");
              requestedUserId = userId;
              return { maybeSingle: async () => ({ data: { role: "super_admin" }, error: null }) };
            },
          };
        },
      };
    },
  };

  assert.equal(await fetchPlatformRole(client, "authenticated-uid"), "super_admin");
  assert.equal(requestedUserId, "authenticated-uid");
  const noStaffRow = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  assert.equal(await fetchPlatformRole(noStaffRow, "student-uid"), "student");
});

test("role lookup surfaces database errors instead of silently treating the user as a student", async () => {
  const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("permission denied") }) }) }) }) };
  await assert.rejects(fetchPlatformRole(client, "user-uid"), /permission denied/);
});

test("role lookup requires a verified client and authenticated UID", async () => {
  await assert.rejects(fetchPlatformRole(null, "user-uid"), /signed-in user/);
  await assert.rejects(fetchPlatformRole({}, ""), /signed-in user/);
});

test("Super Admin reaches the workspace without an academic profile or catalog", () => {
  assert.equal(getWorkspaceAccess({ ...authenticated, role: "super_admin", profileLoading: false, profile: null }), "workspace");
  assert.equal(getWorkspaceAccess({ ...authenticated, role: "super_admin", profileLoading: false, profileError: "unavailable", profile: null }), "workspace");
});

test("student remains in onboarding until both degree and branch are saved", () => {
  const base = { ...authenticated, role: "student", profileLoading: false };
  assert.equal(getWorkspaceAccess({ ...base, profile: null }), "onboarding");
  assert.equal(getWorkspaceAccess({ ...base, profile: { degree_id: "degree" } }), "onboarding");
  assert.equal(getWorkspaceAccess({ ...base, profile: { degree_id: "degree", branch_id: "branch" } }), "workspace");
});

test("teachers retain the existing profile gate and enter the workspace after completion", () => {
  const base = { ...authenticated, role: "teacher", profileLoading: false };
  assert.equal(getWorkspaceAccess({ ...base, profile: null }), "onboarding");
  assert.equal(getWorkspaceAccess({ ...base, profile: { degree_id: "degree", branch_id: "branch" } }), "workspace");
});

test("route decisions wait for auth and role checks and expose role errors", () => {
  assert.equal(getWorkspaceAccess({ authLoading: true, authenticated: false }), "auth-loading");
  assert.equal(getWorkspaceAccess({ authenticated: true, authLoading: false, roleLoading: true }), "role-loading");
  assert.equal(getWorkspaceAccess({ ...authenticated, roleError: "network error" }), "role-error");
  assert.equal(getWorkspaceAccess({ ...authenticated, role: "student", profileLoading: true }), "profile-loading");
});
