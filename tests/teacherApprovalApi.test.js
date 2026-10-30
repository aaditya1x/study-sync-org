import test from "node:test";
import assert from "node:assert/strict";
import {
  callAuthenticatedRpc,
  coordinateStudentSuspension,
  validateTeacherBranchInput,
  verifyActiveSuperAdmin,
} from "../server/teacherApprovalApi.js";

const targetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const branchId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const token = "verified-user-access-token";

function fakeAdminReads({ role = "super_admin", status = null, failure = null } = {}) {
  return {
    from(table) {
      let userId;
      const query = {
        select() { return query; },
        eq(_column, value) { userId = value; return query; },
        async maybeSingle() {
          if (failure) return { data: null, error: failure };
          assert.equal(userId, actorId);
          return { data: table === "academic_staff" ? (role ? { role } : null) : status, error: null };
        },
      };
      return query;
    },
  };
}

test("authorization requires a verified bearer user with active Super Admin role and no suspension", async () => {
  const authClient = { auth: { getUser: async (accessToken) => {
    assert.equal(accessToken, token);
    return { data: { user: { id: actorId } }, error: null };
  } } };
  const user = await verifyActiveSuperAdmin({ authClient, adminClient: fakeAdminReads(), accessToken: token });
  assert.equal(user.id, actorId);
  await assert.rejects(verifyActiveSuperAdmin({ authClient, adminClient: fakeAdminReads({ role: "teacher" }), accessToken: token }), { status: 403, code: "SUPER_ADMIN_REQUIRED" });
  await assert.rejects(verifyActiveSuperAdmin({ authClient, adminClient: fakeAdminReads({ status: { user_id: actorId } }), accessToken: token }), { status: 403, code: "ACCOUNT_SUSPENDED" });
  await assert.rejects(verifyActiveSuperAdmin({ authClient, adminClient: fakeAdminReads(), accessToken: "" }), { status: 401, code: "AUTH_REQUIRED" });

  const bannedAuth = { auth: { getUser: async () => ({ data: { user: { id: actorId, banned_until: "2999-01-01T00:00:00.000Z" } }, error: null }) } };
  await assert.rejects(verifyActiveSuperAdmin({ authClient: bannedAuth, adminClient: fakeAdminReads(), accessToken: token }), { status: 403, code: "AUTH_BANNED" });
  const invalidAuth = { auth: { getUser: async () => ({ data: { user: null }, error: new Error("invalid") }) } };
  await assert.rejects(verifyActiveSuperAdmin({ authClient: invalidAuth, adminClient: fakeAdminReads(), accessToken: token }), { status: 401, code: "INVALID_SESSION" });
});

test("branch mutation input rejects malformed, empty, oversized, and self targets", () => {
  assert.throws(() => validateTeacherBranchInput("bad-id", [branchId], actorId), { status: 400 });
  assert.throws(() => validateTeacherBranchInput(targetId, [], actorId), { code: "INVALID_BRANCHES" });
  assert.throws(() => validateTeacherBranchInput(targetId, ["bad-branch"], actorId), { code: "INVALID_BRANCHES" });
  assert.throws(() => validateTeacherBranchInput(actorId, [branchId], actorId), { code: "SELF_TARGET" });
  assert.throws(() => validateTeacherBranchInput(targetId, Array(101).fill(branchId), actorId), { code: "INVALID_BRANCHES" });
  assert.deepEqual(validateTeacherBranchInput(targetId, [branchId, branchId], actorId), [branchId]);
});

test("authenticated RPC uses the verified bearer token and never accepts a frontend actor ID", async () => {
  let clientArgs;
  let rpcArgs;
  const data = await callAuthenticatedRpc({
    createClient: (...args) => {
      clientArgs = args;
      return { rpc: async (name, args) => { rpcArgs = { name, args }; return { data: { ok: true }, error: null }; } };
    },
    url: "https://staging.example.invalid",
    publishableKey: "public-key",
    accessToken: token,
    functionName: "approve_teacher_with_branches",
    args: { p_target_id: targetId, p_branch_ids: [branchId] },
  });

  assert.deepEqual(data, { ok: true });
  assert.equal(clientArgs[2].global.headers.Authorization, `Bearer ${token}`);
  assert.equal(rpcArgs.name, "approve_teacher_with_branches");
  assert.deepEqual(rpcArgs.args, { p_target_id: targetId, p_branch_ids: [branchId] });
  assert.equal(Object.hasOwn(rpcArgs.args, "p_actor_id"), false);
  await assert.rejects(callAuthenticatedRpc({
    createClient: () => assert.fail("client must not be created"),
    url: "url", publishableKey: "key", accessToken: token,
    functionName: "set_teacher_branches", args: { p_actor_id: actorId },
  }), { code: "ACTOR_ARGUMENT_FORBIDDEN" });
});

test("authenticated RPC errors map authorization, validation, conflict, and unavailable cases clearly", async () => {
  const callWithError = (code) => callAuthenticatedRpc({
    createClient: () => ({ rpc: async () => ({ data: null, error: { code } }) }),
    url: "url", publishableKey: "key", accessToken: token,
    functionName: "set_teacher_branches", args: { p_target_id: targetId, p_branch_ids: [branchId] },
  });
  await assert.rejects(callWithError("42501"), { status: 403, code: "42501" });
  await assert.rejects(callWithError("22023"), { status: 400, code: "22023" });
  await assert.rejects(callWithError("23514"), { status: 409, code: "23514" });
  await assert.rejects(callWithError("PGRST202"), { status: 503, code: "PGRST202" });
});

test("suspend preserves the database guard and reports Auth-ban failure with retry state", async () => {
  const events = [];
  await assert.rejects(coordinateStudentSuspension({
    userId: targetId,
    suspended: true,
    reason: "test",
    callRpc: async (name, args) => { events.push(["rpc", name, args]); return { changed: true }; },
    authAdmin: {
      updateUserById: async () => { events.push(["ban"]); return { data: null, error: new Error("Auth unavailable") }; },
      getUserById: async () => ({ data: { user: { id: targetId, banned_until: null } }, error: null }),
    },
    readSuspension: async () => true,
  }), (error) => {
    assert.equal(error.partial, true);
    assert.equal(error.retry_action, "suspend_student");
    assert.deepEqual(error.state, { database_suspended: true, auth_banned: false, suspended: true });
    return true;
  });
  assert.equal(events[0][0], "rpc");
  assert.equal(events[1][0], "ban");
  assert.equal(events.some(([kind]) => kind === "unban"), false);
});

test("restore unbans first and reports DB RPC failure without claiming access is restored", async () => {
  const events = [];
  await assert.rejects(coordinateStudentSuspension({
    userId: targetId,
    suspended: false,
    callRpc: async (name, args) => {
      events.push(["rpc", name, args]);
      throw Object.assign(new Error("database rejected restoration"), { status: 403, code: "42501", knownRpcFailure: true });
    },
    authAdmin: {
      updateUserById: async (_id, update) => { events.push(["auth", update.ban_duration]); return { data: { user: { id: targetId } }, error: null }; },
      getUserById: async () => assert.fail("successful unban needs no reconciliation"),
    },
    readSuspension: async () => true,
  }), (error) => {
    assert.equal(error.partial, true);
    assert.equal(error.retry_action, "restore_student");
    assert.deepEqual(error.state, { database_suspended: true, auth_banned: false, suspended: true });
    return true;
  });
  assert.deepEqual(events.map(([kind]) => kind), ["auth", "rpc"]);
  assert.equal(events[0][1], "none");
  assert.deepEqual(events[1][2], { p_target_id: targetId, p_suspended: false, p_reason: "" });
});

test("failed unban leaves the database suspension untouched and does not call the RPC", async () => {
  let rpcCalls = 0;
  await assert.rejects(coordinateStudentSuspension({
    userId: targetId,
    suspended: false,
    callRpc: async () => { rpcCalls += 1; },
    authAdmin: {
      updateUserById: async () => ({ data: null, error: new Error("Auth unavailable") }),
      getUserById: async () => ({ data: { user: { id: targetId, banned_until: "2999-01-01T00:00:00.000Z" } }, error: null }),
    },
    readSuspension: async () => true,
  }), (error) => {
    assert.equal(error.partial, true);
    assert.equal(error.retry_action, "restore_student");
    assert.equal(error.state.database_suspended, true);
    assert.equal(error.state.auth_banned, true);
    return true;
  });
  assert.equal(rpcCalls, 0);
});
