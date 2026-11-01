// Keep browser requests limited to the fields accepted by the AI API. In
// particular, chat UI messages may also contain display-only source metadata.
export function buildAIRequest({ mode, text, messages, pageContext, storagePaths, language, webResearch } = {}) {
  const body = { mode };
  if (typeof text === "string") body.text = text;
  if (typeof language === "string") body.language = language;
  if (typeof webResearch === "boolean") body.web_research = webResearch;
  if (Array.isArray(messages)) {
    body.messages = messages.map((message) => ({
      role: message?.role,
      content: message?.content,
    }));
  }
  if (pageContext && typeof pageContext === "object") {
    body.page_context = {
      label: typeof pageContext.label === "string" ? pageContext.label : "",
      summary: typeof pageContext.summary === "string" ? pageContext.summary : "",
    };
  }
  if (Array.isArray(storagePaths) && storagePaths.length) {
    body.storage_paths = storagePaths.filter((path) => typeof path === "string");
  }
  return body;
}

export function serializeAIRequest(input) {
  let serialized;
  try { serialized = JSON.stringify(buildAIRequest(input)); }
  catch { throw new Error("The AI request contains data that cannot be sent. Please retry your question."); }
  if (typeof serialized !== "string") {
    throw new Error("The AI request could not be serialized. Please retry your question.");
  }
  return serialized;
}

export function parseAIRequestBody(value) {
  let body = value;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 }); }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Request body must be a JSON object."), { status: 400 });
  }
  return body;
}
