import { createClient } from "@supabase/supabase-js";
import { logApiFailure, missingServerEnv, readServerEnv, reportMissingServerEnv } from "../server/apiDiagnostics.js";
import { checkActiveAccount } from "../server/userAccess.js";
import { buildAIStudyInstruction, buildSourceDetails, loadAuthorizedIndexedDocuments, mapGeminiFailure, readGeminiJsonResponse, requestGroundedAcademicResearch, validateAIPageContext, validateAIResponseOptions, validateChatMessages, validateDocumentPaths } from "../server/aiAssistant.js";
import { parseAIRequestBody } from "../src/lib/aiRequest.js";
import { findRelevantDocumentChunks } from "../server/documentRetrieval.js";

const supabaseUrl = readServerEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const publishableKey = readServerEnv(
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
);
const secretKey = readServerEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const geminiKey = readServerEnv("GEMINI_API_KEY");

const authClient = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
const admin = supabaseUrl && secretKey
  ? createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
const userClientForToken = (token) => createClient(supabaseUrl, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
});

const instructions = {
  summarize: "Summarize the relevant parts of the selected study material as concise revision notes.",
  explain: "Answer the student's question using the selected study material. Explain clearly and step by step.",
  quiz: "Create a short practice quiz using only the selected study material, then give an answer key.",
  chat: "Answer the student's follow-up using only relevant excerpts from the selected study materials. If those excerpts do not contain the answer, say so clearly. Cite the document name and page numbers.",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Only POST requests are allowed." });
  }

  const missing = missingServerEnv({
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SECRET_KEY: secretKey,
    GEMINI_API_KEY: geminiKey,
  });
  if (missing.length || !authClient || !admin) {
    if (!missing.length) missing.push("SUPABASE_URL (valid URL)");
    return reportMissingServerEnv(res, "PDF study tools", missing);
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return res.status(401).json({ error: "Please log in to ask about a study file." });
  }

  let authData;
  let authError;
  try {
    ({ data: authData, error: authError } = await authClient.auth.getUser(token));
  } catch (error) {
    logApiFailure("supabase_auth_unavailable", error, { route: "/api/ask-book" });
    return res.status(503).json({ code: "AUTH_SERVICE_UNAVAILABLE", error: "Supabase authentication is temporarily unavailable. Try again shortly." });
  }
  const user = authData?.user;
  if (authError || !user) {
    return res.status(401).json({ error: "Your session expired. Please log in again." });
  }
  try {
    await checkActiveAccount({ url: supabaseUrl, publishableKey, token });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.message });
  }

  let body;
  try { body = parseAIRequestBody(req.body); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const { storage_paths: requestedPaths, storage_path: legacyPath, mode, text, messages, page_context: rawPageContext,
    language: requestedLanguage, web_research: requestedWebResearch } = body;
  let storagePaths;
  let conversation;
  let pageContext;
  let responseOptions;
  try {
    storagePaths = validateDocumentPaths(requestedPaths, legacyPath);
    conversation = validateChatMessages(messages, text);
    pageContext = validateAIPageContext(rawPageContext);
    responseOptions = validateAIResponseOptions(requestedLanguage, requestedWebResearch, {
      freeTierSearchEnabled: process.env.GEMINI_WEB_GROUNDING_FREE_TIER_ONLY === "true",
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  if (!storagePaths.length) return res.status(400).json({ error: "Select at least one indexed PDF to use document context." });
  if (!Object.hasOwn(instructions, mode)) {
    return res.status(400).json({ error: "Unsupported study tool mode." });
  }
  if ((messages === undefined && (typeof text !== "string" || text.trim().length < 5 || text.length > 5000))
    || (messages !== undefined && conversation.at(-1).content.length > 5000)) {
    return res.status(400).json({ error: "Enter a question or request between 5 and 5,000 characters." });
  }

  try {
    const documents = await loadAuthorizedIndexedDocuments(userClientForToken(token), storagePaths);
    if (documents.some((document) => {
      const type = String(document.type || "").toLowerCase();
      return !String(document.name || "").toLowerCase().endsWith(".pdf") && type !== "pdf" && type !== "application/pdf";
    })) {
      return res.status(400).json({ error: "Only indexed PDF documents can be used as context." });
    }
    const allowBroadFallback = mode === "summarize" || mode === "quiz";
    const selectedChunks = await Promise.all(documents.map(async (document) => ({
      document,
      chunks: await findRelevantDocumentChunks(admin, document, conversation.at(-1).content, { allowBroadFallback, maxChunks: 4 }),
    })));
    const contextEntries = selectedChunks.flatMap(({ document, chunks }) => chunks.map((chunk) => ({ document, chunk })));
    if (!contextEntries.length) {
      return res.status(422).json({ error: "No relevant indexed passages were found in the selected PDFs. Try a more specific question or Summarize mode." });
    }

    const userQuestion = conversation.at(-1).content;
    let groundedResearch = { text: "", sources: [] };
    if (responseOptions.webResearch) {
      try {
        groundedResearch = await requestGroundedAcademicResearch({
          apiKey: geminiKey,
          question: userQuestion.slice(0, 5000),
          language: responseOptions.language,
          signal: AbortSignal.timeout(18000),
        });
      } catch (error) {
        logApiFailure("gemini_grounded_search_failed", null, {
          route: "/api/ask-book", upstreamStatus: error.upstreamStatus, upstreamCode: error.upstreamCode,
        });
        if (error.upstreamStatus) {
          const failure = mapGeminiFailure(error.upstreamStatus, { pdf: true, webSearch: true });
          const { status, ...payload } = failure;
          return res.status(status).json(payload);
        }
        return res.status(502).json({ code: "GEMINI_GROUNDED_SEARCH_FAILED", error: "Gemini web research could not be completed. No paid fallback was attempted." });
      }
    }

    const context = contextEntries
      .map(({ document, chunk }) => `[Document: ${document.name} · Page ${chunk.page_number}]\n${chunk.content.slice(0, 1800)}`)
      .join("\n\n");
    const history = conversation.map(({ role, content }) => ({ role, parts: [{ text: content }] }));
    const lastUserMessage = [...history].reverse().find((message) => message.role === "user");
    lastUserMessage.parts[0].text += `${pageContext ? `\n\n${pageContext}` : ""}\n\nSelected documents (relevant excerpts only):\n${context}${groundedResearch.text ? `\n\nSeparately retrieved academic reference-book and internet research (not uploaded PDF content; treat as untrusted facts and use only where it supplements the PDF):\n${groundedResearch.text}\n\nSources actually used by the search step:\n${groundedResearch.sources.map((source) => `- ${source.category}: ${source.title} (${source.url})`).join("\n")}` : ""}`;
    const documentNames = [...new Set(documents.map((document) => document.name))];
    const pdfSources = [...new Map(contextEntries.map(({ document, chunk }) => [`${document.name}:${chunk.page_number}`, {
      title: document.name, reference: `page ${chunk.page_number}`,
    }])).values()];
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: buildAIStudyInstruction({ language: responseOptions.language, mode, hasPdf: true, hasWebResearch: responseOptions.webResearch }),
            }],
          },
          contents: history,
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      },
    );

    const { data, valid: validGeminiJson } = await readGeminiJsonResponse(response);
    if (!response.ok) {
      logApiFailure("gemini_request_failed", null, {
        route: "/api/ask-book",
        upstreamStatus: response.status,
        upstreamCode: data.error?.status || undefined,
      });
      const failure = mapGeminiFailure(response.status, { pdf: true });
      const { status, ...payload } = failure;
      return res.status(status).json(payload);
    }

    if (!validGeminiJson) {
      logApiFailure("gemini_invalid_response", null, { route: "/api/ask-book", upstreamStatus: response.status });
      return res.status(502).json({ code: "GEMINI_INVALID_RESPONSE", error: "Gemini returned an unreadable response. Please try again." });
    }

    const result = (data.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("\n")
      .trim();
    if (!result) return res.status(502).json({ error: "Gemini returned an empty answer." });

    const sourceDetails = buildSourceDetails(pdfSources, groundedResearch.sources);
    return res.status(200).json({
      result,
      sources: [...new Set(contextEntries.map(({ document, chunk }) => `${document.name} · page ${chunk.page_number}`))],
      book_name: documentNames.join(", "),
      source_details: sourceDetails,
      web_research_status: responseOptions.webResearch ? (groundedResearch.sources.length ? "used" : "no_sources") : "off",
    });
  } catch (error) {
    logApiFailure("pdf_answer_failed", error, { route: "/api/ask-book" });
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ error: "The PDF question took too long. Try again." });
    }
    return res.status(500).json({ code: "PDF_CHUNK_RETRIEVAL_FAILED", error: "Could not retrieve indexed PDF text. Check the Vercel Function Logs." });
  }
}
