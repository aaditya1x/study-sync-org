import { createClient } from "@supabase/supabase-js";
import { logApiFailure, missingServerEnv, readServerEnv, reportMissingServerEnv } from "../server/apiDiagnostics.js";
import { verifyActiveSuperAdmin } from "../server/teacherApprovalApi.js";
import { extractSyllabusPdf, syllabusExtractionIssue, syllabusSourceKey } from "../server/syllabusPdf.js";

const url = readServerEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const publishableKey = readServerEnv("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY");
const secretKey = readServerEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const authClient = url && publishableKey ? createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const admin = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = "academic-syllabi";

function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }
function safeTitle(value, max = 200) {
  const title = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!title || title.length > max) throw httpError("The extracted syllabus contains an invalid title.");
  return title;
}
async function upsertOutlineNode(table, key, parentColumn, parentId, title, position, sourceId) {
  const { data: existing, error: lookupError } = await admin.from(table).select("id")
    .eq("syllabus_source_key", key).maybeSingle();
  if (lookupError) throw lookupError;
  const values = { [parentColumn]: parentId, title, position, archived_at: null, syllabus_source_id: sourceId, syllabus_source_key: key, updated_at: new Date().toISOString() };
  if (existing) {
    const { data, error } = await admin.from(table).update(values).eq("id", existing.id).select("id").single();
    if (error) throw error;
    return data.id;
  }
  // Reuse matching manually entered curriculum rather than create duplicates.
  let legacyQuery = admin.from(table).select("id").eq(parentColumn, parentId).eq("title", title).eq("position", position).is("syllabus_source_key", null).is("archived_at", null).limit(1);
  if (table === "academic_topics") legacyQuery = legacyQuery.is("parent_topic_id", null);
  const { data: legacy, error: legacyError } = await legacyQuery.maybeSingle();
  if (legacyError) throw legacyError;
  if (legacy) {
    const { data, error } = await admin.from(table).update({ ...values, syllabus_source_key: key }).eq("id", legacy.id).select("id").single();
    if (error) throw error;
    return data.id;
  }
  const { data, error } = await admin.from(table).insert(values).select("id").single();
  if (error) throw error;
  return data.id;
}

async function publishSource(source) {
  const outline = source.extracted_outline;
  const outlineIssue = syllabusExtractionIssue(outline, { selectedCourseId: source.course_id, sourceCourseId: source.course_id });
  if (outlineIssue) throw httpError(outlineIssue, 422);
  const { data: course, error: courseError } = await admin.from("courses").select("id,name,title").eq("id", source.course_id).maybeSingle();
  if (courseError) throw courseError;
  if (!course) throw httpError("The selected subject no longer exists.", 404);
  const oldSources = await admin.from("academic_syllabus_sources").select("id").eq("course_id", source.course_id).eq("status", "verified").neq("id", source.id);
  if (oldSources.error) throw oldSources.error;

  for (let ui = 0; ui < outline.units.length; ui += 1) {
    const unit = outline.units[ui];
    const number = Number(unit.number);
    if (!Number.isInteger(number) || number < 1 || number > 24) throw httpError("An extracted unit number is invalid.");
    const unitTitle = safeTitle(unit.title, 160);
    const unitPosition = number;
    const unitKey = `${source.course_id}:unit:${number}`;
    const unitId = await upsertOutlineNode("academic_units", unitKey, "course_id", source.course_id, unitTitle, unitPosition, source.id);
    const chapterTitle = safeTitle(unit.chapter_title || unitTitle, 160);
    const chapterKey = `${unitKey}:chapter:1`;
    const chapterId = await upsertOutlineNode("academic_chapters", chapterKey, "unit_id", unitId, chapterTitle, 1, source.id);
    const topics = Array.isArray(unit.topics) ? unit.topics : [];
    for (let ti = 0; ti < topics.length; ti += 1) {
      const topicTitle = safeTitle(topics[ti].title);
      const topicKey = `${chapterKey}:topic:${syllabusSourceKey(topicTitle)}`;
      const topicId = await upsertOutlineNode("academic_topics", topicKey, "chapter_id", chapterId, topicTitle, ti + 1, source.id);
      const subtopics = Array.isArray(topics[ti].subtopics) ? topics[ti].subtopics : [];
      for (let si = 0; si < subtopics.length; si += 1) {
        const subTitle = safeTitle(subtopics[si]);
        const subKey = `${topicKey}:subtopic:${syllabusSourceKey(subTitle)}`;
        const { data: child, error: childError } = await admin.from("academic_topics").select("id").eq("syllabus_source_key", subKey).maybeSingle();
        if (childError) throw childError;
        const childValues = { chapter_id: chapterId, parent_topic_id: topicId, title: subTitle, position: si + 1, archived_at: null, syllabus_source_id: source.id, syllabus_source_key: subKey, updated_at: new Date().toISOString() };
        const result = child
          ? await admin.from("academic_topics").update(childValues).eq("id", child.id)
          : await admin.from("academic_topics").insert(childValues);
        if (result.error) throw result.error;
      }
    }
  }

  if (oldSources.data?.length) {
    const ids = oldSources.data.map((row) => row.id);
    for (const table of ["academic_units", "academic_chapters", "academic_topics"]) {
      const { error } = await admin.from(table).update({ archived_at: new Date().toISOString() }).in("syllabus_source_id", ids);
      if (error) throw error;
    }
  }
  const { error: verifyError } = await admin.from("academic_syllabus_sources").update({ status: "verified", verified_by: source.uploaded_by, processed_at: new Date().toISOString(), processing_error: null }).eq("id", source.id);
  if (verifyError) throw verifyError;
  return { published: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Only POST requests are allowed." }); }
  const missing = missingServerEnv({ SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publishableKey, SUPABASE_SECRET_KEY: secretKey });
  if (missing.length || !authClient || !admin) return reportMissingServerEnv(res, "Syllabus import", missing);
  const token = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  let user;
  try { user = await verifyActiveSuperAdmin({ authClient, adminClient: admin, accessToken: token }); }
  catch (error) {
    logApiFailure("syllabus_import_auth_failed", error, { route: "/api/syllabus-import" });
    return res.status(error.status || 503).json({ error: error.status ? error.message : "Authentication is temporarily unavailable." });
  }
  const { action, course_id: courseId, storage_path: storagePath, filename, file_size: fileSize, source_id: sourceId } = req.body || {};
  try {
    if (action === "process") {
      if (!UUID.test(courseId || "") || typeof storagePath !== "string") throw httpError("Choose a valid uploaded syllabus PDF.");
      const expectedPath = new RegExp(`^syllabus/${user.id}/${courseId}/[0-9a-f-]{36}\\.pdf$`, "i");
      if (!expectedPath.test(storagePath)) throw httpError("Choose a valid uploaded syllabus PDF.");
      if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > 25 * 1024 * 1024) throw httpError("Syllabus PDFs must be 25 MB or smaller.");
      const { data: course, error: courseError } = await admin.from("courses").select("id,name,title,code,course_code").eq("id", courseId).maybeSingle();
      if (courseError) throw courseError;
      if (!course) throw httpError("The selected subject could not be found.", 404);
      const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(storagePath);
      if (downloadError || !blob) throw httpError("The original syllabus PDF remains in private Storage, but could not be processed.", 502);
      if (blob.size !== fileSize || blob.size > 25 * 1024 * 1024) throw httpError("The uploaded file size could not be verified.", 400);
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (buffer.subarray(0, 5).toString() !== "%PDF-") throw httpError("The selected file is not a valid PDF.", 400);
      let outline;
      let extractionFailed = false;
      try { outline = await extractSyllabusPdf(buffer, course); }
      catch {
        extractionFailed = true;
        outline = { subject_name: course.name || course.title || "", subject_found_in_pdf: false, units: [] };
      }
      const processingError = syllabusExtractionIssue(outline, {
        selectedCourseId: courseId,
        sourceCourseId: course.id,
        extractionFailed,
      });
      const status = processingError ? "failed" : "pending_review";
      const { data: source, error: insertError } = await admin.from("academic_syllabus_sources").insert({
        course_id: courseId, storage_path: storagePath, original_filename: safeTitle(filename || "syllabus.pdf", 255),
        file_size: blob.size, status, extracted_outline: outline, uploaded_by: user.id,
        processing_error: processingError,
      }).select("id,course_id,status,extracted_outline,processing_error").single();
      if (insertError) throw insertError;
      if (processingError) return res.status(422).json({ error: processingError, source });
      return res.status(200).json({ source });
    }
    if (action === "list") {
      const query = admin.from("academic_syllabus_sources").select("id,course_id,storage_path,original_filename,file_size,status,extracted_outline,processing_error,created_at").order("created_at", { ascending: false }).limit(50);
      const { data, error } = courseId ? await query.eq("course_id", courseId) : await query;
      if (error) throw error;
      return res.status(200).json({ sources: data || [] });
    }
    if (action === "publish") {
      if (!UUID.test(sourceId || "")) throw httpError("Choose a valid pending syllabus import.");
      const { data: source, error } = await admin.from("academic_syllabus_sources").select("id,course_id,status,extracted_outline,uploaded_by").eq("id", sourceId).maybeSingle();
      if (error) throw error;
      if (!source || source.status !== "pending_review") throw httpError("This syllabus is not waiting for review.", 409);
      return res.status(200).json({ ...(await publishSource(source)) });
    }
    return res.status(400).json({ error: "Choose process, list or publish." });
  } catch (error) {
    logApiFailure("syllabus_import_failed", error, { route: "/api/syllabus-import", action: String(action || "") });
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Syllabus import failed. The original PDF is retained in private Storage; review the function logs." });
  }
}
