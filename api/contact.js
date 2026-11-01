import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { logApiFailure, missingServerEnv, readServerEnv, reportMissingServerEnv } from "../server/apiDiagnostics.js";
import { sha256Hex, validateContact } from "../server/learningTools.js";

const url = readServerEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const publishableKey = readServerEnv("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY");
const secretKey = readServerEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const admin = url && secretKey ? createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Only POST requests are allowed." }); }
  const missing = missingServerEnv({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: secretKey });
  if (missing.length || !admin) return reportMissingServerEnv(res, "Contact form", missing);
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    // Silently accept but do not store honeypot submissions.
    if (typeof body.website === "string" && body.website.trim()) return res.status(200).json({ success: true });
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 6000) return res.status(400).json({ error: "The contact form is too large." });
    const message = validateContact(body);
    const forwarded = req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "unknown";
    const ip = (Array.isArray(forwarded) ? forwarded : String(forwarded).split(",")).map((value) => String(value).trim()).filter(Boolean).at(-1) || "unknown";
    const rateKey = sha256Hex(ip, createHash);
    const { error } = await admin.rpc("submit_contact_message", {
      p_name: message.name, p_email: message.email, p_subject: message.subject,
      p_message: message.message, p_rate_key: rateKey,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return res.status(200).json({ success: true });
  } catch (error) {
    logApiFailure("contact_submission_failed", error, { route: "/api/contact" });
    const status = error.code === "P0001" ? 429 : error.code === "22023" ? 400 : 500;
    return res.status(status).json({ error: status === 500 ? "The message could not be sent right now. Please try again later." : error.message });
  }
}
