import { supabase } from "./supabase.js";
import { parseLearningResponse } from "./learningResponse.js";

export async function learningRequest(action, values = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to continue.");
  const response = await fetch("/api/learning", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...values }),
  });
  const raw = await response.text();
  return parseLearningResponse(response.status, response.ok, raw);
}

export async function sendContactMessage(values) {
  const response = await fetch("/api/contact", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The message could not be sent.");
  return result;
}
