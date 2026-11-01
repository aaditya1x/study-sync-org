import { createClient } from "@supabase/supabase-js";
import { getAuthCallbackUrl } from "./authRedirect.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;

// Development follows the current Vite origin. Production uses the configured
// canonical URL, or the deployed host, and never redirects back to localhost.
// Every resulting URL must also be listed in Supabase Auth > URL Configuration.
export function getAuthRedirectUrl() {
  return getAuthCallbackUrl({
    configuredSiteUrl: import.meta.env.VITE_SITE_URL,
    currentOrigin: typeof window === "undefined" ? "" : window.location.origin,
    production: import.meta.env.PROD,
  });
}

// This module is intentionally not imported by the app until Supabase credentials are configured.
export const isSupabaseConfigured = Boolean(url && key && !url.includes("YOUR_PROJECT_ID") && !key.includes("YOUR_SUPABASE"));

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const STORAGE_BUCKETS = Object.freeze({
  materials: "study-materials",
  profiles: "profile-photos",
});
