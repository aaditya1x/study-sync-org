function parseOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isLocalHost(hostname = "") {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "::1"
    || host === "0.0.0.0" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function productionOrigin(value) {
  const url = parseOrigin(value);
  return url && url.protocol === "https:" && !isLocalHost(url.hostname) ? url.origin : null;
}

/**
 * Development always follows the origin actually serving the app (for example
 * Vite's localhost:5173). Production uses the configured canonical app origin,
 * falling back to the deployed host. Localhost can never be a production target.
 */
export function getAuthCallbackUrl({ configuredSiteUrl = "", currentOrigin = "", production = false } = {}) {
  let origin;
  if (!production) {
    origin = parseOrigin(currentOrigin)?.origin;
  } else {
    origin = productionOrigin(configuredSiteUrl) || productionOrigin(currentOrigin);
  }
  if (!origin) {
    throw new Error(production
      ? "Authentication redirects need the deployed HTTPS app URL. Set VITE_SITE_URL to the production domain."
      : "Could not determine the current application URL for authentication.");
  }
  return new URL("/auth/callback", origin).toString();
}
