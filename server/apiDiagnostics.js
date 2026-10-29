export function readServerEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function missingServerEnv(required) {
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

export function logApiFailure(event, error, details = {}) {
  // Never log request headers, tokens, environment values, prompts, or file text.
  console.error(JSON.stringify({
    scope: "study-sync-api",
    event,
    ...details,
    errorName: error?.name || undefined,
    errorCode: error?.code || undefined,
    errorStatus: error?.status || undefined,
  }));
}

export function reportMissingServerEnv(res, service, missing) {
  console.error(JSON.stringify({
    scope: "study-sync-api",
    event: "missing_server_configuration",
    service,
    missing,
  }));
  return res.status(500).json({
    code: "SERVER_CONFIGURATION_MISSING",
    error: `${service} is not configured. Missing server environment variables: ${missing.join(", ")}. Add them in Vercel, then redeploy.`,
    missing,
  });
}
