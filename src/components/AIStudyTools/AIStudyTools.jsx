import { Suspense, lazy, useEffect, useState } from "react";
import {
  Copy,
  Sparkles,
  BookOpen,
  Brain,
  ListChecks,
  LoaderCircle,
} from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { getIndexedPdfDocuments } from "../../lib/indexedPdfDocuments.js";
import { serializeAIRequest } from "../../lib/aiRequest.js";
import IndexedDocumentPicker from "./IndexedDocumentPicker.jsx";
import styles from "./AIStudyTools.module.css";

const AIResponseMarkdown = lazy(() => import("./AIResponseMarkdown.jsx"));

const modes = [
  { id: "summarize", label: "Summarize", icon: BookOpen, description: "Turn your notes into a concise revision guide." },
  { id: "explain", label: "Explain", icon: Brain, description: "Understand a difficult concept in simple language." },
  { id: "quiz", label: "Quiz", icon: ListChecks, description: "Create practice questions to test your understanding." },
];

export default function AIStudyTools({ materials = [], notify = () => {}, onOpenMaterials, pageContext }) {
  const [mode, setMode] = useState("summarize");
  const [selectedBooks, setSelectedBooks] = useState([]);
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [sources, setSources] = useState([]);
  const [sourceDetails, setSourceDetails] = useState(null);
  const [bookName, setBookName] = useState("");
  const [language, setLanguage] = useState("auto");
  // Ordinary Gemini answers work by default; web grounding is explicitly opt-in
  // because this deployment must be operator-confirmed as billing-disabled.
  const [webResearch, setWebResearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedPaths = selectedBooks;

  useEffect(() => {
    const available = new Set(getIndexedPdfDocuments(materials).map((document) => document.path));
    setSelectedBooks((current) => current.filter((path) => available.has(path)));
  }, [materials]);

  function clearAnswer() {
    setError("");
    setResult("");
    setSources([]);
    setSourceDetails(null);
    setBookName("");
  }

  async function generate() {
    const prompt = text.trim();
    if (prompt.length < 5) {
      const message = "Enter a question, notes, or topic first.";
      setError(message);
      notify(message);
      return;
    }
    if (!selectedPaths.length && prompt.length > 30000) {
      setError("Notes must be 30,000 characters or fewer.");
      return;
    }
    if (selectedPaths.length && prompt.length > 5000) {
      setError("Questions must be 5,000 characters or fewer when using PDFs.");
      return;
    }

    setBusy(true);
    clearAnswer();

    try {
      const endpoint = selectedPaths.length ? "/api/ask-book" : "/api/ai";
      const headers = { "Content-Type": "application/json" };
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) {
        throw new Error("Your session expired. Please sign in again.");
      }
      headers.Authorization = `Bearer ${sessionData.session.access_token}`;

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: serializeAIRequest({
          mode,
          text: prompt,
          pageContext,
          storagePaths: selectedPaths,
          language,
          webResearch,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      if (!data.result || typeof data.result !== "string") {
        throw new Error("The AI returned an empty response. Try again.");
      }

      setResult(data.result);
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setSourceDetails(data.source_details && typeof data.source_details === "object" ? data.source_details : null);
      setBookName(data.book_name || "");
    } catch (err) {
      const message = err.message === "Failed to fetch"
        ? "The AI server could not be reached. Check your deployment and try again."
        : err.message || "Something went wrong. Please try again.";
      setError(message);
      notify(message);
    } finally {
      setBusy(false);
    }
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(result);
      notify("AI result copied.");
    } catch {
      notify("Copy failed. Please select and copy the result manually.");
    }
  }

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <div>
          <h2>AI Study Tools</h2>
          <p>Use general knowledge, your notes, or selected indexed PDFs as study context.</p>
          <small className={styles.pageContext}>Current page context · {pageContext?.label || "unavailable"}</small>
        </div>
        <Sparkles size={24} />
      </div>

      <div className={styles.modes}>
        {modes.map(({ id, label, icon: Icon, description }) => (
          <button
            key={id}
            type="button"
            className={`${styles.modeCard} ${mode === id ? styles.activeMode : ""}`}
            onClick={() => { setMode(id); clearAnswer(); }}
            aria-pressed={mode === id}
            disabled={busy}
          >
            <Icon size={20} />
            <strong>{label}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>

      <div className={styles.inputPanel}>
        <IndexedDocumentPicker materials={materials} selectedPaths={selectedBooks} onChange={(paths) => { setSelectedBooks(paths); clearAnswer(); }} disabled={busy} onOpenMaterials={onOpenMaterials} />

        <div className={styles.researchControls}>
          <label htmlFor="study-response-language">Response language</label>
          <select id="study-response-language" value={language} onChange={(event) => setLanguage(event.target.value)} disabled={busy}>
            <option value="auto">Auto Detect</option>
            <option value="english">English</option>
            <option value="hindi">Hindi</option>
            <option value="hinglish">Hinglish</option>
          </select>
          <label className={styles.researchToggle}>
            <input type="checkbox" checked={webResearch} onChange={(event) => setWebResearch(event.target.checked)} disabled={busy} />
            <span><strong>Research open textbooks and the internet</strong><small>Optional Gemini Search grounding; deployment must be confirmed billing-free. No paid fallback.</small></span>
          </label>
        </div>

        <label htmlFor="study-notes">
          {selectedPaths.length ? "Your question or request" : "Your question, notes, or topic"}
        </label>
        <textarea
          id="study-notes"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={selectedPaths.length
            ? "Ask a question about the selected documents..."
            : "Ask a general question or paste your notes / topic..."}
          maxLength={selectedPaths.length ? 5000 : 30000}
          rows={9}
          disabled={busy}
        />
        <div className={styles.inputFooter}>
          <small>{text.length.toLocaleString()} / {selectedPaths.length ? "5,000" : "30,000"} characters</small>
          <button
            type="button"
            onClick={generate}
            disabled={busy || !text.trim()}
            className={styles.generateButton}
          >
            {busy ? (
              <><LoaderCircle size={18} className={styles.spinner} /> Searching and generating...</>
            ) : (
              <>
                <Sparkles size={18} />
                {selectedPaths.length ? "Use selected PDFs" : `Generate ${mode === "quiz" ? "Quiz" : mode === "explain" ? "Explanation" : "Summary"}`}
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          <strong>Could not generate a result</strong>
          <p>{error}</p>
        </div>
      )}

      {result && (
        <div className={styles.result}>
          <div className={styles.resultHead}>
            <div>
              <small>AI STUDY OUTPUT</small>
              <h3>{mode === "quiz" ? "PRACTICE QUIZ" : mode === "explain" ? "STUDY ANSWER" : "STUDY SUMMARY"}</h3>
            </div>
            <button type="button" onClick={copyResult} title="Copy result">
              <Copy size={16} /> Copy
            </button>
          </div>
          <Suspense fallback={<p className={styles.rendering}>Formatting answer…</p>}>
            <AIResponseMarkdown content={result} className={styles.resultText} />
          </Suspense>
          {sourceDetails && Object.values(sourceDetails).some((items) => Array.isArray(items) && items.length > 0) ? (
            <section className={styles.sourceCategories} aria-label="Sources used">
              <strong>Source usage</strong>
              {[
                ["uploaded_pdf", "Uploaded PDF"],
                ["reference_books", "Reference Books and Open Educational Resources"],
                ["internet", "Internet Sources"],
              ].map(([key, label]) => sourceDetails[key]?.length > 0 && <div className={styles.sourceGroup} key={key}>
                <h4>{label}</h4>
                <ul>{sourceDetails[key].map((source, index) => <li key={`${source.title}-${source.reference || source.url || index}`}>
                  {source.url
                    ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                    : <span>{source.title}{source.reference ? ` · ${source.reference}` : ""}</span>}
                </li>)}</ul>
              </div>)}
            </section>
          ) : sources.length > 0 && (
            <small className={styles.sourceNote}>
              Based on {bookName || "selected PDFs"} · {sources.join(" · ")}
            </small>
          )}
          <small className={styles.liveNote}>Generated by the AI service.</small>
        </div>
      )}
    </section>
  );
}
