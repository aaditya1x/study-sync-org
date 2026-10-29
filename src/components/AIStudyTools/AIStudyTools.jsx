import { useEffect, useState } from "react";
import {
  Copy,
  Sparkles,
  BookOpen,
  Brain,
  ListChecks,
  LoaderCircle,
  FileText,
} from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import styles from "./AIStudyTools.module.css";

const modes = [
  { id: "summarize", label: "Summarize", icon: BookOpen, description: "Turn your notes into a concise revision guide." },
  { id: "explain", label: "Explain", icon: Brain, description: "Understand a difficult concept in simple language." },
  { id: "quiz", label: "Quiz", icon: ListChecks, description: "Create practice questions to test your understanding." },
];

export default function AIStudyTools({ materials = [], notify = () => {}, onOpenMaterials }) {
  const [mode, setMode] = useState("summarize");
  const [source, setSource] = useState("notes");
  const [selectedBook, setSelectedBook] = useState("");
  const [sharedBooks, setSharedBooks] = useState([]);
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [sources, setSources] = useState([]);
  const [bookName, setBookName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ownIndexedBooks = materials.filter((material) =>
    material.isIndexed &&
    (material.type?.toLowerCase() === "pdf" || material.name?.toLowerCase().endsWith(".pdf"))
  );
  const indexedBooks = [...new Map([...ownIndexedBooks, ...sharedBooks]
    .map((book) => [book.path, book])).values()];

  useEffect(() => {
    let active = true;
    async function loadSharedBooks() {
      if (!supabase) return;
      try {
        const { data, error } = await supabase.from("study_materials")
          .select("name, subject, type, storage_path, is_indexed, is_shared")
          .eq("is_shared", true)
          .eq("is_indexed", true)
          .order("created_at", { ascending: false });
        if (error) throw error;
        if (!active) return;
        setSharedBooks((data || []).map((book) => ({
          id: book.storage_path,
          path: book.storage_path,
          name: book.name,
          subject: book.subject || "",
          type: book.type || "PDF",
          isIndexed: Boolean(book.is_indexed),
          isShared: true,
        })));
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Could not load shared study PDFs:", error);
        if (active) setSharedBooks([]);
      }
    }
    loadSharedBooks();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const nextBook = indexedBooks.some((book) => book.path === selectedBook)
      ? selectedBook
      : indexedBooks[0]?.path || "";
    if (selectedBook !== nextBook) setSelectedBook(nextBook);
  }, [indexedBooks, selectedBook]);

  function clearAnswer() {
    setError("");
    setResult("");
    setSources([]);
    setBookName("");
  }

  async function generate() {
    const prompt = text.trim();
    if (prompt.length < 5) {
      const message = source === "pdf"
        ? "Enter a question or request about the PDF."
        : "Please paste your notes or topic first.";
      setError(message);
      notify(message);
      return;
    }
    if (source === "notes" && prompt.length > 30000) {
      setError("Notes must be 30,000 characters or fewer.");
      return;
    }
    if (source === "pdf" && prompt.length > 5000) {
      setError("Questions must be 5,000 characters or fewer.");
      return;
    }
    if (source === "pdf" && !selectedBook) {
      setError("Choose an indexed PDF first.");
      return;
    }

    setBusy(true);
    clearAnswer();

    try {
      const endpoint = source === "pdf" ? "/api/ask-book" : "/api/ai";
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
        body: JSON.stringify({
          mode,
          text: prompt,
          ...(source === "pdf" ? { storage_path: selectedBook } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      if (!data.result || typeof data.result !== "string") {
        throw new Error("The AI returned an empty response. Try again.");
      }

      setResult(data.result);
      setSources(Array.isArray(data.sources) ? data.sources : []);
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
          <p>Turn your notes or uploaded PDFs into useful revision material.</p>
        </div>
        <Sparkles size={24} />
      </div>

      <div className={styles.sourceModes} role="group" aria-label="Choose study source">
        <button
          type="button"
          className={source === "notes" ? styles.sourceActive : ""}
          aria-pressed={source === "notes"}
          onClick={() => { setSource("notes"); setText(""); clearAnswer(); }}
          disabled={busy}
        >
          Paste notes
        </button>
        <button
          type="button"
          className={source === "pdf" ? styles.sourceActive : ""}
          aria-pressed={source === "pdf"}
          onClick={() => { setSource("pdf"); setMode("explain"); setText(""); clearAnswer(); }}
          disabled={busy}
        >
          <FileText size={16} /> Ask my PDF
        </button>
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
        {source === "pdf" && (
          <div className={styles.bookPicker}>
            <label htmlFor="study-book">Choose an indexed PDF</label>
            {indexedBooks.length ? (
              <select
                id="study-book"
                value={selectedBook}
                onChange={(event) => { setSelectedBook(event.target.value); clearAnswer(); }}
                disabled={busy}
              >
                {indexedBooks.map((book) => (
                  <option key={book.path} value={book.path}>
                    {book.name} · {book.isShared ? "Shared text" : book.subject || "My library"}
                  </option>
                ))}
              </select>
            ) : (
              <div className={styles.bookNotice}>
                <p>No indexed PDFs are ready yet. Upload a text-based PDF in Study Materials first.</p>
                <button type="button" onClick={onOpenMaterials}>Open Study Materials</button>
              </div>
            )}
          </div>
        )}

        <label htmlFor="study-notes">
          {source === "pdf" ? "Your question or request" : "Your notes or topic"}
        </label>
        <textarea
          id="study-notes"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={source === "pdf"
            ? "Ask a question about the selected PDF..."
            : "Paste your syllabus, class notes, or a topic here..."}
          maxLength={source === "pdf" ? 5000 : 30000}
          rows={9}
          disabled={busy}
        />
        <div className={styles.inputFooter}>
          <small>{text.length.toLocaleString()} / {source === "pdf" ? "5,000" : "30,000"} characters</small>
          <button
            type="button"
            onClick={generate}
            disabled={busy || !text.trim() || (source === "pdf" && !selectedBook)}
            className={styles.generateButton}
          >
            {busy ? (
              <><LoaderCircle size={18} className={styles.spinner} /> Searching and generating...</>
            ) : (
              <>
                <Sparkles size={18} />
                {source === "pdf" ? "Ask PDF" : `Generate ${mode === "quiz" ? "Quiz" : mode === "explain" ? "Explanation" : "Summary"}`}
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
          <pre className={styles.resultText}>{result}</pre>
          {source === "pdf" && sources.length > 0 && (
            <small className={styles.sourceNote}>
              Based on {bookName || "your PDF"} · pages {sources.join(", ")}
            </small>
          )}
          <small className={styles.liveNote}>Generated by the AI service.</small>
        </div>
      )}
    </section>
  );
}
