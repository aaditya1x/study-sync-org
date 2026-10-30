const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function httpError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

export async function verifyActiveSuperAdmin({ authClient, adminClient, accessToken }) {
  if (typeof accessToken !== "string" || !accessToken.trim()) throw httpError("Sign in to continue.", 401, "AUTH_REQUIRED");
  let user;
  try {
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (error || !data?.user) throw httpError("Your session is invalid or expired.", 401, "INVALID_SESSION");
    user = data.user;
  } catch (error) {
    if (error?.status) throw error;
    throw httpError("Authentication is temporarily unavailable.", 503, "AUTH_UNAVAILABLE");
  }
  if (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) {
    throw httpError("This account is Auth-banned.", 403, "AUTH_BANNED");
  }
  const { data: staff, error: staffError } = await adminClient.from("academic_staff").select("role").eq("user_id", user.id).maybeSingle();
  if (staffError) throw staffError;
  if (staff?.role !== "super_admin") throw httpError("Super Admin access is required.", 403, "SUPER_ADMIN_REQUIRED");
  const { data: status, error: statusError } = await adminClient.from("platform_user_status").select("user_id").eq("user_id", user.id).maybeSingle();
  if (statusError) throw statusError;
  if (status) throw httpError("This account is suspended.", 403, "ACCOUNT_SUSPENDED");
  return user;
}

export function validateTeacherBranchInput(userId, branchIds, actorId) {
  if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    throw Object.assign(new Error("Choose a valid target account."), { status: 400, code: "INVALID_TARGET" });
  }
  if (actorId && userId === actorId) {
    throw Object.assign(new Error("You cannot perform this action on your own account."), { status: 400, code: "SELF_TARGET" });
  }
  if (!Array.isArray(branchIds) || branchIds.length === 0 || branchIds.length > 100
      || branchIds.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
    throw Object.assign(new Error("Select between 1 and 100 valid branches."), { status: 400, code: "INVALID_BRANCHES" });
  }
  return [...new Set(branchIds)];
}

export function createUserRpcClient(createClient, url, publishableKey, accessToken) {
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw Object.assign(new Error("Sign in to continue."), { status: 401, code: "AUTH_REQUIRED" });
  }
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function rpcFailure(error, operation) {
  const code = error?.code || "RPC_UNAVAILABLE";
  const statusByCode = {
    "22023": 400,
    "23503": 404,
    "23514": 409,
    "42501": 403,
    "P0002": 404,
    "PGRST202": 503,
    "42883": 503,
  };
  const status = statusByCode[code] || (error?.status >= 500 ? 503 : 503);
  const publicMessage = status === 403
    ? "Active Super Admin access is required for this operation."
    : status === 404
      ? "The target account or selected record was not found."
      : status === 400
        ? "The request contains invalid values."
        : status === 409
          ? "The account or branch state does not allow this change."
          : `The secure ${operation} operation is unavailable. No fallback write was attempted.`;
  return Object.assign(new Error(publicMessage), { status, code, knownRpcFailure: Boolean(error?.code) });
}

export async function callAuthenticatedRpc({ createClient, url, publishableKey, accessToken, functionName, args }) {
  if (Object.hasOwn(args || {}, "p_actor_id")) {
    throw Object.assign(new Error("Actor identity must come from the authenticated JWT."), { status: 400, code: "ACTOR_ARGUMENT_FORBIDDEN" });
  }
  const client = createUserRpcClient(createClient, url, publishableKey, accessToken);
  try {
    const { data, error } = await client.rpc(functionName, args);
    if (error) throw rpcFailure(error, functionName);
    return data;
  } catch (error) {
    if (error?.status) throw error;
    throw rpcFailure(error, functionName);
  }
}

function partialFailure(message, state, retryAction, cause) {
  return Object.assign(new Error(message), {
    status: 502,
    code: "SUSPENSION_PARTIAL_COMPLETION",
    partial: true,
    state,
    retry_action: retryAction,
    cause,
  });
}

function isCurrentlyBanned(user) {
  return Boolean(user?.banned_until && new Date(user.banned_until).getTime() > Date.now());
}

async function reconcileAuthBan(authAdmin, userId, desiredBanned) {
  try {
    const { data, error } = await authAdmin.getUserById(userId);
    if (error || !data?.user) return { known: false, banned: null };
    const banned = isCurrentlyBanned(data.user);
    return { known: true, banned, matches: banned === desiredBanned };
  } catch {
    return { known: false, banned: null };
  }
}

async function changeAuthBan(authAdmin, userId, suspended) {
  try {
    const { data, error } = await authAdmin.updateUserById(userId, {
      ban_duration: suspended ? "876000h" : "none",
    });
    if (!error) return { user: data?.user || null, reconciled: false };
    const state = await reconcileAuthBan(authAdmin, userId, suspended);
    if (state.matches) return { user: null, reconciled: true };
    throw Object.assign(new Error("Auth ban state could not be changed or confirmed."), { cause: error, reconciledState: state });
  } catch (error) {
    if (error?.reconciledState) throw error;
    const state = await reconcileAuthBan(authAdmin, userId, suspended);
    if (state.matches) return { user: null, reconciled: true };
    throw Object.assign(new Error("Auth ban state could not be changed or confirmed."), { cause: error, reconciledState: state });
  }
}

export async function coordinateStudentSuspension({ userId, suspended, reason, callRpc, authAdmin, readSuspension }) {
  if (suspended) {
    try {
      await callRpc("set_platform_user_suspension", {
        p_target_id: userId,
        p_suspended: true,
        p_reason: typeof reason === "string" ? reason.slice(0, 500) : "",
      });
    } catch (error) {
      if (error?.knownRpcFailure) throw error;
      let current;
      try { current = await readSuspension(userId); }
      catch { throw partialFailure("The database suspension result is uncertain. Check its status before retrying the Auth ban.", { database_suspended: null, auth_banned: false, suspended: true }, "suspend_student", error); }
      if (!current) throw error;
    }

    try {
      const auth = await changeAuthBan(authAdmin, userId, true);
      return { user_id: userId, suspended: true, database_suspended: true, auth_banned: true, reconciled: auth.reconciled };
    } catch (error) {
      throw partialFailure("Database access is blocked, but the Auth ban is not confirmed. Retry suspension after checking Auth state.", { database_suspended: true, auth_banned: error.reconciledState?.banned ?? false, suspended: true }, "suspend_student", error);
    }
  }

  try {
    await changeAuthBan(authAdmin, userId, false);
  } catch (error) {
    throw partialFailure("The Auth unban is not confirmed. Database suspension remains in place; retry restoration after checking Auth state.", { database_suspended: true, auth_banned: error.reconciledState?.banned ?? null, suspended: true }, "restore_student", error);
  }

  try {
    await callRpc("set_platform_user_suspension", {
      p_target_id: userId,
      p_suspended: false,
      p_reason: "",
    });
    return { user_id: userId, suspended: false, database_suspended: false, auth_banned: false, reconciled: false };
  } catch (error) {
    if (!error?.knownRpcFailure) {
      try {
        const current = await readSuspension(userId);
        if (!current) return { user_id: userId, suspended: false, database_suspended: false, auth_banned: false, reconciled: true };
      } catch { /* report partial state when reconciliation is unavailable */ }
    }
    throw partialFailure("Auth is unbanned, but the database suspension remains or could not be confirmed. Retry restoration.", { database_suspended: true, auth_banned: false, suspended: true }, "restore_student", error);
  }
}
