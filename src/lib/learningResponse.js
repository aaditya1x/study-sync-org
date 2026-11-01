export function parseLearningResponse(status, ok, raw) {
  let result;
  try { result = raw ? JSON.parse(raw) : {}; }
  catch {
    throw new Error(`The learning API returned an invalid response (HTTP ${status}). Check the local /api/learning route or deployment function.`);
  }
  if (!ok) {
    const detail = result.database_code ? ` (Supabase ${result.database_code}; HTTP ${status})` : ` (HTTP ${status})`;
    const migration = result.required_migration
      ? ` Required migration: ${result.required_migration}${result.migration_status ? ` (${result.migration_status})` : ""}.`
      : "";
    const failure = new Error(`${result.error || "The learning request failed."}${detail}${migration}`);
    failure.status = status;
    failure.code = result.code || "LEARNING_REQUEST_FAILED";
    throw failure;
  }
  if (!Object.hasOwn(result, "data")) throw new Error("The learning API response was incomplete. Retry the request.");
  return result.data;
}
