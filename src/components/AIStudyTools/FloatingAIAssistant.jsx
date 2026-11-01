import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { serializeAIRequest } from "../../lib/aiRequest.js";
import styles from "./FloatingAIAssistant.module.css";
import { suggestedAISection } from "../../lib/aiNavigation.js";

const AIResponseMarkdown = lazy(() => import("./AIResponseMarkdown.jsx"));

const MAX_HISTORY = 12;

export default function FloatingAIAssistant({ userId, role, pageContext, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, open]);

  useEffect(() => () => { requestRef.current += 1; }, []);

  useEffect(() => {
    requestRef.current += 1;
    setMessages([]);
    setDraft("");
    setError("");
  }, [userId]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    if (content.length > 4000) { setError("Keep each message under 4,000 characters."); return; }
    setError("");
    setDraft("");
    const conversation = [...messages, { role: "user", content }].slice(-MAX_HISTORY);
    const requestId = ++requestRef.current;
    setMessages(conversation);
    setBusy(true);
    try {
      if (!supabase) throw new Error("AI chat is not configured.");
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (authError || !auth.session?.access_token) throw new Error("Your session expired. Sign in again to use AI chat.");
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.session.access_token}` },
        body: serializeAIRequest({
          mode: "chat", messages: conversation, pageContext,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `The assistant could not respond (${response.status}).`);
      if (!data.result || typeof data.result !== "string") throw new Error("The assistant returned an empty response. Try again.");
      if (requestId === requestRef.current) setMessages((current) => [...current, { role: "assistant", content: data.result, sources: data.sources || [] }]);
    } catch (failure) {
      if (requestId === requestRef.current) {
        setError(failure.message || "The assistant could not respond. Try again.");
        setMessages(messages);
        setDraft(content);
      }
    } finally {
      if (requestId === requestRef.current) setBusy(false);
    }
  }

  function startNewChat() {
    if (busy) return;
    setMessages([]);
    setError("");
    setDraft("");
  }

  const authorizedRole = ["student", "teacher", "super_admin"].includes(role);
  if (!authorizedRole) return null;

  return <>
    {open && <section className={styles.panel} role="dialog" aria-modal="false" aria-labelledby="campusflow-ai-title">
      <header className={styles.header}>
        <span className={styles.avatar}><Bot size={18}/></span>
        <div><strong id="campusflow-ai-title">Ask AI</strong><small>{pageContext?.label ? `Current page · ${pageContext.label}` : "Current page context unavailable"}</small></div>
        <button type="button" className={styles.newChat} onClick={startNewChat} disabled={busy}>New chat</button>
        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close AI assistant"><X size={18}/></button>
      </header>
      <div className={styles.messages} ref={listRef} aria-live="polite">
        {!messages.length && <div className={styles.welcome}><Sparkles size={22}/><strong>What would you like to learn?</strong><p>Ask general questions or ask about courses, curriculum, assignments, progress, and other information in your workspace.</p></div>}
        {messages.map((message, index) => <article className={message.role === "user" ? styles.userMessage : styles.assistantMessage} key={`${index}-${message.role}`}>
          <span>{message.role === "user" ? "You" : "Ask AI"}</span>
          {message.role === "assistant"
            ? <Suspense fallback={<p className={styles.rendering}>Formatting answer…</p>}><AIResponseMarkdown content={message.content} className={styles.responseMarkdown} /></Suspense>
            : <p>{message.content}</p>}
          {message.role === "assistant" && suggestedAISection(`${messages[index - 1]?.content || ""}\n${message.content}`) && <button type="button" className={styles.navigate} onClick={() => onNavigate?.(suggestedAISection(`${messages[index - 1]?.content || ""}\n${message.content}`).id)}>Open {suggestedAISection(`${messages[index - 1]?.content || ""}\n${message.content}`).label}</button>}
          {message.sources?.length > 0 && <small>Sources: {message.sources.join(" · ")}</small>}
        </article>)}
        {busy && <div className={styles.typing}><LoaderCircle size={15} className={styles.spinner}/> Searching and thinking…</div>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <form className={styles.composer} onSubmit={sendMessage}>
        <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask anything…" rows={2} maxLength={4000} disabled={busy} aria-label="Message the AI assistant" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message">{busy ? <LoaderCircle size={17} className={styles.spinner}/> : <Send size={17}/>}</button>
      </form>
      <small className={styles.securityNote}>Uses summaries of workspace data you can already access. Ask AI cannot change records.</small>
    </section>}
    <button type="button" className={`${styles.launcher} ${open ? styles.launcherOpen : ""}`} onClick={() => { setOpen((value) => !value); window.setTimeout(() => inputRef.current?.focus(), 50); }} aria-label={open ? "Close Ask AI" : "Open Ask AI"} aria-expanded={open}>
      {open ? <X size={21}/> : <><MessageCircle size={20}/><span>Ask AI</span></>}
    </button>
  </>;
}
