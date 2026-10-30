import { createClient } from "@supabase/supabase-js";
import { logApiFailure, missingServerEnv, readServerEnv, reportMissingServerEnv } from "../server/apiDiagnostics.js";

const url = readServerEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const publishableKey = readServerEnv("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY");
const secretKey = readServerEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const authClient = url && publishableKey ? createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const admin = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const allowedTables = {
  degrees: { table: "academic_degrees", fields: ["name", "archived_at"], select: "id, name, archived_at, created_at" },
  branches: { table: "academic_branches", fields: ["degree_id", "name", "archived_at"], select: "id, degree_id, name, archived_at, created_at" },
  cycles: { table: "academic_cycles", fields: ["label", "starts_on", "ends_on", "archived_at"], select: "id, label, starts_on, ends_on, archived_at, created_at" },
  courses: { table: "courses", fields: ["name", "title", "code", "course_code", "description", "semester", "branch_id", "academic_cycle_id", "year_level", "archived_at"], select: "id, owner_id, name, code, description, semester, branch_id, academic_cycle_id, year_level, archived_at, created_at" },
  materials: { table: "study_materials", fields: ["is_shared", "archived_at"], select: "id, user_id, name, subject, course_id, is_shared, archived_at, size, type, created_at" },
  units: { table: "academic_units", fields: ["course_id", "title", "position", "archived_at"], select: "id, course_id, title, position, archived_at, created_at" },
  chapters: { table: "academic_chapters", fields: ["unit_id", "title", "position", "archived_at"], select: "id, unit_id, title, position, archived_at, created_at" },
  topics: { table: "academic_topics", fields: ["chapter_id", "title", "position", "archived_at"], select: "id, chapter_id, title, position, archived_at, created_at" },
  assignments: { table: "academic_assignments", fields: ["course_id", "title", "description", "due_at", "archived_at"], select: "id, course_id, title, description, due_at, archived_at, created_at" },
  announcements: { table: "academic_announcements", fields: ["title", "body", "audience", "published_at", "archived_at"], select: "id, title, body, audience, published_at, archived_at, created_at" },
  settings: { table: "platform_settings", fields: ["setting_key", "setting_value"], select: "setting_key, setting_value, updated_at, updated_by" },
};

function responseError(res, status, message) {
  return res.status(status).json({ error: message });
}

function validUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function pickAllowed(input, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(input || {}, field)).map((field) => [field, input[field]]));
}

async function writeAudit(actorId, action, entityType, entityId, metadata = {}) {
  const { error } = await admin.from("platform_audit_logs").insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId ? String(entityId) : null,
    metadata,
  });
  if (error) throw error;
}

async function countRows(table, filter) {
  let query = admin.from(table).select("id", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function authUsers(page, perPage) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
  if (error) throw error;
  return data.users || [];
}

async function authUserCount() {
  let page = 1;
  let total = 0;
  while (page <= 1000) {
    const users = await authUsers(page, 1000);
    total += users.length;
    if (users.length < 1000) break;
    page += 1;
  }
  return total;
}

async function listUsers(page = 1) {
  const users = await authUsers(page, 100);
  const ids = users.map((user) => user.id);
  if (!ids.length) return [];
  const [staff, profiles] = await Promise.all([
    admin.from("academic_staff").select("user_id, role").in("user_id", ids),
    admin.from("academic_profiles").select("user_id, degree_id, branch_id, academic_cycle_id, year_level, semester").in("user_id", ids),
  ]);
  const statuses = await admin.from("platform_user_status").select("user_id, suspended_at, reason").in("user_id", ids);
  if (staff.error) throw staff.error;
  if (profiles.error) throw profiles.error;
  if (statuses.error) throw statuses.error;
  const roles = new Map((staff.data || []).map((row) => [row.user_id, row.role]));
  const allocations = new Map((profiles.data || []).map((row) => [row.user_id, row]));
  const suspensions = new Map((statuses.data || []).map((row) => [row.user_id, row]));
  return users.map((user) => ({
    id: user.id,
    email: user.email || "",
    name: user.user_metadata?.full_name || user.user_metadata?.name || "",
    role: roles.get(user.id) || "student",
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    banned_until: user.banned_until || null,
    is_suspended: Boolean(user.banned_until && new Date(user.banned_until) > new Date()) || suspensions.has(user.id),
    suspension: suspensions.get(user.id) || null,
    email_confirmed_at: user.email_confirmed_at || null,
    academic_profile: allocations.get(user.id) || null,
  }));
}

async function dashboardOverview() {
  const [users, courses, archivedCourses, materials, sharedMaterials, topics, units, assignments, teacherRows, taskCount] = await Promise.all([
    authUserCount(),
    countRows("courses", (q) => q.is("archived_at", null)),
    countRows("courses", (q) => q.not("archived_at", "is", null)),
    countRows("study_materials", (q) => q.is("archived_at", null)),
    countRows("study_materials", (q) => q.eq("is_shared", true).is("archived_at", null)),
    countRows("academic_topics", (q) => q.is("archived_at", null)),
    countRows("academic_units", (q) => q.is("archived_at", null)),
    countRows("academic_assignments", (q) => q.is("archived_at", null)),
    admin.from("academic_staff").select("user_id, role"),
    admin.rpc("admin_task_count"),
  ]);
  if (teacherRows.error) throw teacherRows.error;
  if (taskCount.error) throw taskCount.error;
  return {
    users,
    courses,
    archivedCourses,
    materials,
    sharedMaterials,
    units,
    topics,
    assignments,
    tasks: Number(taskCount.data) || 0,
    teachers: (teacherRows.data || []).filter((row) => row.role === "teacher").length,
    superAdmins: (teacherRows.data || []).filter((row) => row.role === "super_admin").length,
  };
}

async function listEntity(entity, includeArchived = false) {
  const config = allowedTables[entity];
  if (!config) throw Object.assign(new Error("Unknown management section."), { status: 400 });
  const sortColumn = entity === "settings" ? "updated_at" : "created_at";
  let query = admin.from(config.table).select(config.select).order(sortColumn, { ascending: false }).limit(250);
  if (entity === "materials") query = query.eq("is_shared", true);
  if (!includeArchived && config.fields.includes("archived_at")) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return responseError(res, 405, "Only POST requests are allowed.");
  }

  const missing = missingServerEnv({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SECRET_KEY: secretKey });
  if (missing.length || !authClient || !admin) return reportMissingServerEnv(res, "Super Admin", missing);

  const token = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return responseError(res, 401, "Sign in to continue.");
  let user;
  try {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return responseError(res, 401, "Your session is invalid or expired.");
    user = data.user;
  } catch (error) {
    logApiFailure("admin_auth_verify_failed", error, { route: "/api/admin" });
    return responseError(res, 503, "Authentication is temporarily unavailable.");
  }

  try {
    const { data: staff, error: staffError } = await admin.from("academic_staff").select("role").eq("user_id", user.id).maybeSingle();
    if (staffError) throw staffError;
    if (staff?.role !== "super_admin") return responseError(res, 403, "Super Admin access is required.");
    const { data: callerStatus, error: callerStatusError } = await admin.from("platform_user_status").select("user_id").eq("user_id", user.id).maybeSingle();
    if (callerStatusError) throw callerStatusError;
    if (callerStatus) return responseError(res, 403, "This account is suspended.");

    const body = req.body || {};
    switch (body.action) {
      case "overview":
        return res.status(200).json({ data: await dashboardOverview() });
      case "users":
        return res.status(200).json({ data: await listUsers(Math.max(1, Math.min(10000, Number(body.page) || 1))) });
      case "list":
        if (body.entity === "audit") {
          const { data, error } = await admin.from("platform_audit_logs").select("id, actor_id, action, entity_type, entity_id, metadata, created_at").order("created_at", { ascending: false }).limit(250);
          if (error) throw error;
          return res.status(200).json({ data: data || [] });
        }
        if (body.entity === "teachers") {
          const { data: teachers, error } = await admin.from("academic_staff").select("user_id, role, created_at").in("role", ["teacher", "super_admin"]);
          if (error) throw error;
          const branchRows = await admin.from("academic_staff_branches").select("user_id, branch_id, created_at");
          if (branchRows.error) throw branchRows.error;
          const ids = (teachers || []).map((row) => row.user_id);
          const userResults = await Promise.all(ids.map((id) => admin.auth.admin.getUserById(id)));
          const users = userResults.map((result) => result.data?.user).filter(Boolean);
          const branches = await admin.from("academic_branches").select("id, name, degree_id");
          if (branches.error) throw branches.error;
          return res.status(200).json({ data: teachers.map((row) => ({ ...row, user: users.find((candidate) => candidate.id === row.user_id), branches: branchRows.data.filter((assignment) => assignment.user_id === row.user_id).map((assignment) => branches.data.find((branch) => branch.id === assignment.branch_id)).filter(Boolean) })) });
        }
        return res.status(200).json({ data: await listEntity(body.entity, Boolean(body.includeArchived)) });
      case "set_role": {
        if (!validUuid(body.userId) || !["student", "teacher", "super_admin"].includes(body.role)) return responseError(res, 400, "Choose a valid user and role.");
        if (body.userId === user.id) return responseError(res, 400, "You cannot change your own role.");
        const { data: target, error: authError } = await admin.auth.admin.getUserById(body.userId);
        if (authError || !target?.user) return responseError(res, 404, "User was not found.");
        const { data: targetStatus, error: targetStatusError } = await admin.from("platform_user_status").select("user_id").eq("user_id", body.userId).maybeSingle();
        if (targetStatusError) throw targetStatusError;
        if (targetStatus) return responseError(res, 409, "Restore the suspended account before changing its role.");
        const { error: roleChangeError } = await admin.rpc("set_platform_user_role", {
          p_actor_id: user.id,
          p_target_id: body.userId,
          p_role: body.role,
        });
        if (roleChangeError) throw roleChangeError;
        return res.status(200).json({ data: { userId: body.userId, role: body.role } });
      }
      case "suspend_student":
      case "restore_student": {
        if (!validUuid(body.userId) || body.userId === user.id) return responseError(res, 400, "Choose a valid student account.");
        const { data: targetRole, error: roleError } = await admin.from("academic_staff").select("role").eq("user_id", body.userId).maybeSingle();
        if (roleError) throw roleError;
        if (targetRole) return responseError(res, 403, "Only student accounts can be suspended or restored here.");
        const { data: authTarget, error: lookupError } = await admin.auth.admin.getUserById(body.userId);
        if (lookupError || !authTarget?.user) return responseError(res, 404, "User was not found.");
        let data;
        if (body.action === "suspend_student") {
          const { error: statusError } = await admin.from("platform_user_status").upsert({ user_id: body.userId, suspended_by: user.id, reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : "" }, { onConflict: "user_id" });
          if (statusError) throw statusError;
          const result = await admin.auth.admin.updateUserById(body.userId, { ban_duration: "876000h" });
          data = result.data;
          if (result.error) {
            await writeAudit(user.id, "suspension_applied_database_guard", "user", body.userId, {});
            throw result.error;
          }
        } else {
          const result = await admin.auth.admin.updateUserById(body.userId, { ban_duration: "none" });
          data = result.data;
          if (result.error) throw result.error;
          const { error: clearError } = await admin.from("platform_user_status").delete().eq("user_id", body.userId);
          if (clearError) throw clearError;
        }
        await writeAudit(user.id, body.action, "user", body.userId, {});
        return res.status(200).json({ data: { userId: body.userId, banned_until: data.user?.banned_until || null } });
      }
      case "save": {
        const config = allowedTables[body.entity];
        if (!config) return responseError(res, 400, "This section cannot be changed.");
        let payload = pickAllowed(body.values, config.fields);
        if (body.entity === "settings") {
          if (!payload.setting_key || !Object.hasOwn(payload, "setting_value")) return responseError(res, 400, "A setting key and JSON value are required.");
          payload.updated_by = user.id;
        } else if (body.entity === "announcements") {
          payload.created_by = user.id;
          payload.updated_at = new Date().toISOString();
        } else if (["units", "chapters", "topics", "assignments"].includes(body.entity)) {
          payload.created_by = user.id;
          payload.updated_at = new Date().toISOString();
        }
        if (!Object.keys(payload).length) return responseError(res, 400, "No valid fields were provided.");
        const table = config.table;
        if (body.entity === "materials") {
          if (!validUuid(body.id)) return responseError(res, 400, "Choose a shared resource.");
          const { data: material, error: materialError } = await admin.from("study_materials").select("id").eq("id", body.id).eq("is_shared", true).maybeSingle();
          if (materialError) throw materialError;
          if (!material) return responseError(res, 404, "Only already shared resources can be administered here.");
        }
        if (body.entity === "courses") {
          const subjectName = payload.name || payload.title;
          const subjectCode = payload.code || payload.course_code;
          if (subjectName) {
            payload.name = subjectName;
            payload.title = subjectName;
          }
          if (subjectCode) {
            payload.code = subjectCode;
            payload.course_code = subjectCode;
          }
          if (!body.id) payload.owner_id = validUuid(body.values?.owner_id) ? body.values.owner_id : user.id;
        }
        const query = body.entity === "settings"
          ? admin.from(config.table).upsert(payload, { onConflict: "setting_key" }).select(config.select).single()
          : body.id
          ? admin.from(table).update(payload).eq("id", body.id).select(config.select).single()
          : admin.from(table).insert(payload).select(config.select).single();
        const { data, error } = await query;
        if (error) throw error;
        await writeAudit(user.id, body.id ? "updated" : "created", body.entity, data.id || data.setting_key, { fields: Object.keys(payload).filter((key) => !["body", "description", "setting_value"].includes(key)) });
        return res.status(200).json({ data });
      }
      case "archive": {
        const config = allowedTables[body.entity];
        if (!config?.fields.includes("archived_at") || !validUuid(body.id)) return responseError(res, 400, "This item cannot be archived.");
        const archivedAt = body.archived ? new Date().toISOString() : null;
        if (body.entity === "materials") {
          const { data: material, error: materialError } = await admin.from("study_materials").select("id").eq("id", body.id).eq("is_shared", true).maybeSingle();
          if (materialError) throw materialError;
          if (!material) return responseError(res, 404, "Only shared resources can be archived here.");
        }
        const { data, error } = await admin.from(config.table).update({ archived_at: archivedAt }).eq("id", body.id).select(config.select).single();
        if (error) throw error;
        await writeAudit(user.id, body.archived ? "archived" : "restored", body.entity, body.id, {});
        return res.status(200).json({ data });
      }
      case "teacher_branch": {
        if (!validUuid(body.userId) || !validUuid(body.branchId)) return responseError(res, 400, "Choose a valid teacher and branch.");
        if (body.assigned) {
          const { data: teacher, error } = await admin.from("academic_staff").select("role").eq("user_id", body.userId).maybeSingle();
          if (error) throw error;
          if (teacher?.role !== "teacher") return responseError(res, 400, "Assign branches only to teacher accounts.");
          const { error: assignError } = await admin.from("academic_staff_branches").upsert({ user_id: body.userId, branch_id: body.branchId, assigned_by: user.id }, { onConflict: "user_id,branch_id" });
          if (assignError) throw assignError;
        } else {
          const { error: removeError } = await admin.from("academic_staff_branches").delete().eq("user_id", body.userId).eq("branch_id", body.branchId);
          if (removeError) throw removeError;
        }
        await writeAudit(user.id, body.assigned ? "branch_assigned" : "branch_unassigned", "teacher", body.userId, { branch_id: body.branchId });
        return res.status(200).json({ data: { userId: body.userId, branchId: body.branchId, assigned: Boolean(body.assigned) } });
      }
      default:
        return responseError(res, 400, "Unknown admin action.");
    }
  } catch (error) {
    logApiFailure("admin_operation_failed", error, { route: "/api/admin", action: req.body?.action || "unknown" });
    return responseError(res, error.status || 500, error.status ? error.message : "The admin operation could not be completed.");
  }
}
