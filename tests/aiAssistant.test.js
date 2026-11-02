import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  loadAuthorizedIndexedDocuments,
  listAuthorizedIndexedPdfDocuments,
  mapGeminiFailure,
  readGeminiJsonResponse,
  aiLanguageInstruction,
  buildAIStudyInstruction,
  buildGroundedSearchRequest,
  buildSourceDetails,
  collectGroundedSources,
  requestGroundedAcademicResearch,
  validateAIResponseOptions,
  validateAIPageContext,
  validateChatMessages,
  validateDocumentPaths,
} from "../server/aiAssistant.js";
import { buildAIPageContext } from "../src/lib/aiPageContext.js";
import { getIndexedPdfDocuments, toggleIndexedPdfSelection } from "../src/lib/indexedPdfDocuments.js";
import { buildAIRequest, parseAIRequestBody, serializeAIRequest } from "../src/lib/aiRequest.js";
import { isAllowedAINavigation, suggestedAISection } from "../src/lib/aiNavigation.js";
import { findRelevantDocumentChunks, selectRelevantDocuments } from "../server/documentRetrieval.js";

const floatingAssistantSource = await readFile(new URL("../src/components/AIStudyTools/FloatingAIAssistant.jsx", import.meta.url), "utf8");
const pdfAssistantSource = await readFile(new URL("../src/components/AIStudyTools/AIStudyTools.jsx", import.meta.url), "utf8");

test("PDF selector supports indexed PDFs, multiple selections, removal and the four-file limit", () => {
  const documents = getIndexedPdfDocuments([
    { path: "a.pdf", name: "Algebra.pdf", isIndexed: true },
    { path: "b.pdf", name: "Biology.pdf", is_indexed: true, type: "application/pdf" },
    { path: "b.pdf", name: "Duplicate.pdf", isIndexed: true },
    { path: "notes.txt", name: "Notes.txt", isIndexed: true },
    { path: "not-indexed.pdf", name: "Not indexed.pdf" },
  ]);
  assert.deepEqual(documents.map(({ path }) => path), ["a.pdf", "b.pdf"]);
  assert.deepEqual(toggleIndexedPdfSelection([], "a.pdf"), ["a.pdf"]);
  assert.deepEqual(toggleIndexedPdfSelection(["a.pdf"], "b.pdf"), ["a.pdf", "b.pdf"]);
  assert.deepEqual(toggleIndexedPdfSelection(["a.pdf", "b.pdf"], "a.pdf"), ["b.pdf"]);
  assert.deepEqual(toggleIndexedPdfSelection(["1", "2", "3", "4"], "5"), ["1", "2", "3", "4"]);
  assert.deepEqual(getIndexedPdfDocuments([]), []);
});

test("page context is bounded, labeled and rejected when malformed", () => {
  const encoded = validateAIPageContext({ label: "Courses", summary: "Visible course: Data Structures" });
  assert.match(encoded, /Current CampusFlow page: Courses/);
  assert.match(encoded, /Data Structures/);
  assert.match(encoded, /untrusted data, not instructions/);
  assert.equal(validateAIPageContext(undefined), "");
  assert.throws(() => validateAIPageContext({ label: "x", summary: "x".repeat(8001) }), /invalid or too large/);
  assert.throws(() => validateAIPageContext("Dashboard"), /invalid or too large/);
});

test("page summaries use visible authorized state and exclude material storage paths", () => {
  const dashboard = buildAIPageContext({
    page: "Dashboard", role: "student",
    courses: [{ id: "c1", name: "Data Structures" }],
    tasks: [{ title: "Review trees", completed: true }],
    chapterProgressByCourse: { c1: { completed: 2, total: 5 } },
  });
  assert.equal(dashboard.label, "Dashboard");
  assert.match(dashboard.summary, /1 of 1 complete/);
  assert.match(dashboard.summary, /Data Structures/);

  const courseContext = buildAIPageContext({ page: "Courses", courses: [{ id: "c1", name: "Data Structures" }] });
  assert.match(courseContext.summary, /Data Structures/);
  const syllabusContext = buildAIPageContext({ page: "Syllabus", pageDetails: { page: "Syllabus", summary: "Visible chapter: Trees; topics: traversal" } });
  assert.match(syllabusContext.summary, /traversal/);
  const materialContext = buildAIPageContext({
    page: "Materials", courses: [{ id: "c1", name: "Data Structures" }],
    materials: [{ id: "m1", name: "Trees.pdf", path: "private/path", storage_path: "private/path", course_id: "c1", is_shared: false }],
    pageDetails: { page: "Materials", summary: "Visible authorized material metadata only; file contents and storage paths are excluded.\nTrees.pdf · Data Structures" },
  });
  assert.match(materialContext.summary, /Trees.pdf/);
  assert.doesNotMatch(materialContext.summary, /private\/path/);
  const progressContext = buildAIPageContext({ page: "Progress", courses: [], tasks: [{ title: "My task", completed: false }] });
  assert.match(progressContext.summary, /Current user's tasks: 0 of 1 complete/);
  const papersContext = buildAIPageContext({ page: "Previous Year Questions", pageDetails: { page: "Previous Year Questions", summary: "Accessible paper: Calculus 2024" } });
  assert.match(papersContext.summary, /Calculus 2024/);
  const adminContext = buildAIPageContext({ page: "Admin", role: "super_admin", pageDetails: { page: "Admin", summary: "student emails" } });
  assert.doesNotMatch(adminContext.summary, /student emails/);
});

test("floating Ask AI has a PDF-free route and receives course, progress, curriculum and assignment summaries", () => {
  assert.match(floatingAssistantSource, /fetch\("\/api\/ai"/);
  assert.doesNotMatch(floatingAssistantSource, /ask-book|IndexedDocumentPicker|selectedPaths|storage_paths/);
  const context = buildAIPageContext({
    page: "Progress", role: "student",
    courses: [{ id: "course-1", name: "Data Structures", semester: 3 }],
    tasks: [{ title: "Review trees", courseId: "course-1", completed: true }],
    chapterProgressByCourse: { "course-1": { completed: 2, total: 4 } },
    pageDetails: [
      { page: "Syllabus", summary: "Verified topic: balanced search trees." },
      { page: "Assignments", summary: "Authorized assignment: Tree worksheet; due Friday." },
      { page: "Mock Tests", summary: "Published test: Tree practice; 10 verified questions." },
      { page: "Previous Year Questions", summary: "Accessible published paper: Algorithms 2025." },
    ],
  });
  assert.match(context.summary, /Data Structures/);
  assert.match(context.summary, /2\/4 personal topics/);
  assert.match(context.summary, /Verified topic: balanced search trees/);
  assert.match(context.summary, /Tree worksheet/);
  assert.match(context.summary, /Tree practice/);
  assert.match(context.summary, /Algorithms 2025/);
});

test("PDF Study Tools retain PDF selection, search, multi-document payloads and a no-PDF general path", () => {
  assert.match(pdfAssistantSource, /IndexedDocumentPicker/);
  assert.match(pdfAssistantSource, /selectedPaths/);
  assert.match(pdfAssistantSource, /serializeAIRequest/);
  assert.match(pdfAssistantSource, /study-response-language/);
  assert.match(pdfAssistantSource, /Research open textbooks and the internet/);
  assert.match(pdfAssistantSource, /sourceDetails\[key\]/);
  const noPdf = JSON.parse(serializeAIRequest({ mode: "explain", text: "Explain trees." }));
  assert.equal(Object.hasOwn(noPdf, "storage_paths"), false);
  const onePdf = JSON.parse(serializeAIRequest({ mode: "explain", text: "Explain this chapter.", storagePaths: ["user/chapter.pdf"] }));
  const severalPdfs = JSON.parse(serializeAIRequest({ mode: "quiz", text: "Quiz me on these units.", storagePaths: ["user/unit-1.pdf", "user/unit-2.pdf"] }));
  assert.deepEqual(onePdf.storage_paths, ["user/chapter.pdf"]);
  assert.deepEqual(severalPdfs.storage_paths, ["user/unit-1.pdf", "user/unit-2.pdf"]);
});

test("AI Study Tools validate language choice and require an explicit free-tier-only search gate", () => {
  assert.equal(aiLanguageInstruction("auto").includes("Never default to English"), true);
  assert.match(aiLanguageInstruction("hindi"), /Devanagari/);
  assert.match(aiLanguageInstruction("hinglish"), /Latin script/);
  assert.deepEqual(validateAIResponseOptions("english", false), { language: "english", webResearch: false });
  assert.throws(() => validateAIResponseOptions("french", false), /Auto Detect, English, Hindi, or Hinglish/);
  assert.throws(() => validateAIResponseOptions("auto", true), {
    code: "GEMINI_FREE_TIER_SEARCH_NOT_ENABLED",
    status: 503,
    message: /GEMINI_WEB_GROUNDING_FREE_TIER_ONLY=true.*billing disabled.*normal Gemini answers/,
  });
  assert.deepEqual(validateAIResponseOptions("hindi", true, { freeTierSearchEnabled: true }), { language: "hindi", webResearch: true });
  assert.match(buildAIStudyInstruction({ language: "hinglish", mode: "explain", hasPdf: true, hasWebResearch: true }), /selected uploaded PDF excerpts as the primary source/);
  assert.deepEqual(validateAIResponseOptions("english", false), { language: "english", webResearch: false }, "normal Gemini requests remain valid when grounding is disabled");
});

test("Gemini configuration uses GEMINI_API_KEY and leaves web research opt-in by default", async () => {
  const aiApi = await readFile(new URL("../api/ai.js", import.meta.url), "utf8");
  const pdfApi = await readFile(new URL("../api/ask-book.js", import.meta.url), "utf8");
  assert.match(aiApi, /readServerEnv\("GEMINI_API_KEY"\)/);
  assert.match(pdfApi, /readServerEnv\("GEMINI_API_KEY"\)/);
  assert.doesNotMatch(aiApi + pdfApi, /readServerEnv\("GEMINI_API_KEYS"\)/);
  assert.match(pdfAssistantSource, /const \[webResearch, setWebResearch\] = useState\(false\)/);
  assert.match(aiApi, /v1beta\/models\/gemini-3\.5-flash-lite:generateContent/);
  assert.match(pdfApi, /v1beta\/models\/gemini-3\.5-flash-lite:generateContent/);
});

test("Gemini grounded-search API errors explain project/model access and quota without paid fallback", () => {
  assert.equal(mapGeminiFailure(400, { webSearch: true }).code, "GEMINI_WEB_SEARCH_UNAVAILABLE");
  assert.match(mapGeminiFailure(400, { webSearch: true }).error, /Google Search grounding is unavailable/);
  assert.equal(mapGeminiFailure(429, { webSearch: true }).code, "GEMINI_WEB_SEARCH_QUOTA_EXCEEDED");
  assert.match(mapGeminiFailure(429, { webSearch: true }).error, /No paid fallback/);
  assert.equal(mapGeminiFailure(403, { webSearch: true }).code, "GEMINI_CREDENTIALS_REJECTED");
});

test("Gemini grounded search receives only the question and returns actually supported sources", async () => {
  const candidates = [{ content: { parts: [{ text: "OER and university explanations." }] }, groundingMetadata: {
    groundingChunks: [
      { web: { uri: "https://vertexaisearch.google.com/grounding-api-redirect/openstax", title: "OpenStax Biology 2e" } },
      { web: { uri: "https://university.example.edu/trees", title: "University tree notes" } },
      { web: { uri: "https://pirate.example/book", title: "Uncited result" } },
    ],
    groundingSupports: [{ groundingChunkIndices: [0] }, { groundingChunkIndices: [1] }],
    webSearchQueries: ["tree traversal OER"],
  } }];
  let call;
  const research = await requestGroundedAcademicResearch({
    apiKey: "server-only-test-key",
    question: "Explain tree traversal",
    language: "english",
    fetchImpl: async (url, options) => {
      call = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200, text: async () => JSON.stringify({ candidates }) };
    },
  });
  assert.match(call.url, /gemini-2\.5-flash-lite:generateContent/);
  assert.deepEqual(call.body.contents, [{ role: "user", parts: [{ text: "Explain tree traversal" }] }]);
  assert.doesNotMatch(call.options.body, /private PDF|storage_path|other student/);
  assert.deepEqual(research.sources.map((source) => source.category), ["reference_books", "internet"]);
  assert.equal(research.sources.length, 2);
});

test("PDF-only, textbook-plus-PDF, web-plus-PDF and combined sources are categorized accurately", () => {
  const pdf = [{ title: "Trees.pdf", reference: "page 4" }];
  const book = { title: "OpenStax Biology", url: "https://openstax.org/books/biology-2e", category: "reference_books" };
  const web = { title: "University notes", url: "https://university.example.edu/trees", category: "internet" };
  assert.deepEqual(buildSourceDetails(pdf, []), { uploaded_pdf: pdf, reference_books: [], internet: [] });
  assert.equal(buildSourceDetails(pdf, [book]).reference_books.length, 1);
  assert.equal(buildSourceDetails(pdf, [web]).internet.length, 1);
  assert.deepEqual(Object.values(buildSourceDetails(pdf, [book, web])).map((items) => items.length), [1, 1, 1]);
  assert.equal(collectGroundedSources({ groundingMetadata: { groundingChunks: [{ web: { uri: "javascript:alert(1)", title: "unsafe" } }], groundingSupports: [{ groundingChunkIndices: [0] }] } }).length, 0);
});

test("AI navigation only offers known workspace sections", () => {
  assert.deepEqual(suggestedAISection("Review the syllabus topic on recursion"), { id: "Syllabus", label: "Curriculum", pattern: /syllabus|curriculum|chapter|unit|topic|subtopic/i });
  assert.equal(suggestedAISection("Your progress is 60 percent complete")?.id, "Progress");
  assert.equal(isAllowedAINavigation("Admin"), false);
  assert.equal(isAllowedAINavigation("Courses"), true);
});

test("document selection accepts unique safe paths up to the request limit", () => {
  assert.deepEqual(validateDocumentPaths(["u/a.pdf", "u/b.pdf"]), ["u/a.pdf", "u/b.pdf"]);
  assert.throws(() => validateDocumentPaths(["u/a.pdf", "u/a.pdf"]), /once/);
  assert.throws(() => validateDocumentPaths(["../private.pdf"]), /valid indexed PDFs/);
  assert.throws(() => validateDocumentPaths(["student\\private.pdf"]), /valid indexed PDFs/);
  assert.throws(() => validateDocumentPaths(Array.from({ length: 5 }, (_, i) => `u/${i}.pdf`)), /up to 4/);
  assert.throws(() => validateDocumentPaths("u/private.pdf"), /must be a list/);
});

test("general chat history is bounded and must end with the user's message", () => {
  assert.deepEqual(validateChatMessages([
    { role: "user", content: "Explain recursion." },
    { role: "assistant", content: "A function calling itself." },
    { role: "user", content: "Can you give an example?" },
  ]), [
    { role: "user", content: "Explain recursion." },
    { role: "model", content: "A function calling itself." },
    { role: "user", content: "Can you give an example?" },
  ]);
  assert.throws(() => validateChatMessages([{ role: "assistant", content: "Orphaned answer" }]), /begin with a user message/);
  assert.throws(() => validateChatMessages([{ role: "user", content: "x".repeat(4001) }]), /invalid message/);
});

test("AI request payloads serialize general questions and one or multiple selected PDFs", () => {
  const general = { mode: "chat", messages: [{ role: "user", content: "What is recursion?" }] };
  assert.deepEqual(JSON.parse(serializeAIRequest(general)), {
    mode: "chat", messages: [{ role: "user", content: "What is recursion?" }],
  });

  const single = serializeAIRequest({ mode: "chat", messages: [{ role: "user", content: "What is inside this PDF?" }], storagePaths: ["user/a.pdf"] });
  const multiple = serializeAIRequest({ mode: "chat", messages: [{ role: "user", content: "Compare these PDFs" }], storagePaths: ["user/a.pdf", "user/b.pdf"] });
  assert.deepEqual(JSON.parse(single).storage_paths, ["user/a.pdf"]);
  assert.deepEqual(JSON.parse(multiple).storage_paths, ["user/a.pdf", "user/b.pdf"]);

  const displayOnly = { role: "assistant", content: "Previous answer", sources: ["a.pdf · page 2"] };
  displayOnly.circularReference = displayOnly;
  const history = serializeAIRequest({ mode: "chat", messages: [displayOnly, { role: "user", content: "Explain more.\nUse an example: λ" }], pageContext: { label: "Courses", summary: "Visible course context." } });
  assert.deepEqual(JSON.parse(history), {
    mode: "chat",
    messages: [
      { role: "assistant", content: "Previous answer" },
      { role: "user", content: "Explain more.\nUse an example: λ" },
    ],
    page_context: { label: "Courses", summary: "Visible course context." },
  });
});

test("empty questions, invalid document IDs, and malformed JSON are rejected", () => {
  assert.throws(() => validateChatMessages([{ role: "user", content: "  " }]), /invalid message/);
  assert.throws(() => validateDocumentPaths([null]), /valid indexed PDFs/);
  assert.throws(() => validateDocumentPaths(["../private.pdf"]), /valid indexed PDFs/);
  assert.throws(() => parseAIRequestBody("{broken"), /Request body must be valid JSON/);
  assert.throws(() => parseAIRequestBody("[]"), /JSON object/);
  assert.throws(() => parseAIRequestBody(""), /Request body must be valid JSON/);
});

test("missing or inaccessible indexed PDFs fail closed, and Gemini failures remain useful", async () => {
  const inaccessibleClient = {
    from() { return this; }, select() { return this; }, in() { return this; }, eq() { return this; },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
  };
  await assert.rejects(loadAuthorizedIndexedDocuments(inaccessibleClient, ["other-user/private.pdf"]), /unavailable to this account/);
  assert.deepEqual(mapGeminiFailure(429), {
    status: 503,
    code: "GEMINI_TEMPORARILY_UNAVAILABLE",
    error: "Gemini is busy or the request limit was reached. Wait a little and try again.",
  });
  assert.equal(mapGeminiFailure(429, { pdf: true }).status, 503);
  assert.equal(mapGeminiFailure(403).code, "GEMINI_CREDENTIALS_REJECTED");
  assert.equal(mapGeminiFailure(500, { pdf: true }).status, 502);
});

test("non-JSON Gemini/proxy responses are distinct from malformed client request JSON", async () => {
  const malformedUpstream = await readGeminiJsonResponse({ text: async () => "upstream gateway error" });
  assert.deepEqual(malformedUpstream, { valid: false, data: null });
  const validUpstream = await readGeminiJsonResponse({ text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "Answer" }] } }] }) });
  assert.equal(validUpstream.valid, true);
  assert.equal(validUpstream.data.candidates[0].content.parts[0].text, "Answer");
  assert.throws(() => parseAIRequestBody("{broken"), /Request body must be valid JSON/);
});

test("indexed document lookup uses the authenticated RLS client and rejects inaccessible paths", async () => {
  const requested = ["student-1/own.pdf", "student-2/shared.pdf"];
  const calls = [];
  const userClient = {
    from(table) { calls.push(["from", table]); return this; },
    select(columns) { calls.push(["select", columns]); return this; },
    in(column, paths) { calls.push(["in", column, paths]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    then(resolve) {
      return Promise.resolve({ data: [
        { storage_path: requested[0], name: "own.pdf", user_id: "student-1", is_indexed: true },
        { storage_path: requested[1], name: "shared.pdf", user_id: "student-2", is_indexed: true, is_shared: true },
      ], error: null }).then(resolve);
    },
  };
  const documents = await loadAuthorizedIndexedDocuments(userClient, requested);
  assert.equal(documents.length, 2);
  assert.deepEqual(calls[0], ["from", "study_materials"]);
  assert.deepEqual(calls.find(([kind]) => kind === "in"), ["in", "storage_path", requested]);
  assert.deepEqual(calls.find(([kind]) => kind === "eq"), ["eq", "is_indexed", true]);

  const rlsClient = {
    from() { return this; }, select() { return this; }, in() { return this; }, eq() { return this; },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
  };
  await assert.rejects(loadAuthorizedIndexedDocuments(rlsClient, requested), /unavailable to this account/);
});

test("floating assistant document discovery uses the authenticated RLS client and retrieves only authorized owner/path chunks", async () => {
  const calls = [];
  const userClient = {
    from(table) { calls.push(["from", table]); return this; },
    select(columns) { calls.push(["select", columns]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    order(column, value) { calls.push(["order", column, value]); return this; },
    limit(value) { calls.push(["limit", value]); return this; },
    then(resolve) { return Promise.resolve({ data: [
      { name: "Trees.pdf", subject: "Data Structures", type: "application/pdf", is_indexed: true, user_id: "student-1", storage_path: "student-1/trees.pdf" },
      { name: "Notes.txt", type: "text/plain", is_indexed: true, user_id: "student-1", storage_path: "student-1/notes.txt" },
    ], error: null }).then(resolve); },
  };
  const documents = await listAuthorizedIndexedPdfDocuments(userClient);
  assert.equal(documents.length, 1);
  assert.deepEqual(calls.find(([kind]) => kind === "eq"), ["eq", "is_indexed", true]);
  assert.equal(selectRelevantDocuments([
    { name: "Trees.pdf", subject: "Algorithms" },
    { name: "Physics.pdf", subject: "Mechanics" },
  ], "Explain tree traversal", 1)[0].name, "Trees.pdf");

  const chunkCalls = [];
  const adminClient = {
    from(table) { chunkCalls.push(["from", table]); return this; },
    select(columns) { chunkCalls.push(["select", columns]); return this; },
    eq(column, value) { chunkCalls.push(["eq", column, value]); return this; },
    ilike(column, value) { chunkCalls.push(["ilike", column, value]); return this; },
    limit() { return this; },
    then(resolve) { return Promise.resolve({ data: [{ page_number: 3, content: "Tree traversal uses a stack." }], error: null }).then(resolve); },
  };
  const chunks = await findRelevantDocumentChunks(adminClient, documents[0], "Explain tree traversal");
  assert.equal(chunks[0].page_number, 3);
  const scopedChunkFilters = [...new Map(chunkCalls.filter(([kind]) => kind === "eq").map((call) => [call.join("|"), call])).values()];
  assert.deepEqual(scopedChunkFilters, [
    ["eq", "user_id", "student-1"], ["eq", "storage_path", "student-1/trees.pdf"],
  ]);
});
