import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { EmptyState } from "../EmptyState/index.js";
import styles from "./ChapterTracker.module.css";

function percent(completed, total) {
  if (!total) return 0;
  return completed === total ? 100 : Math.round((completed / total) * 100);
}

export default function ChapterTracker({ chapters, loading, error, onCreateChapter, onUpdateChapter, onDeleteChapter, onCreateTopic, onUpdateTopic, onDeleteTopic, onToggleTopic }) {
  const [chapterTitle, setChapterTitle] = useState("");
  const [topicDrafts, setTopicDrafts] = useState({});
  const [editing, setEditing] = useState(null);
  const [collapsed, setCollapsed] = useState({});

  async function addChapter(event) {
    event.preventDefault();
    const title = chapterTitle.trim();
    if (!title) return;
    await onCreateChapter(title);
    setChapterTitle("");
  }
  async function addTopic(event, chapterId) {
    event.preventDefault();
    const title = (topicDrafts[chapterId] || "").trim();
    if (!title) return;
    await onCreateTopic(chapterId, title);
    setTopicDrafts((current) => ({ ...current, [chapterId]: "" }));
  }
  async function saveEdit() {
    const title = editing?.title?.trim();
    if (!title) return;
    if (editing.kind === "chapter") await onUpdateChapter(editing.id, title);
    else await onUpdateTopic(editing.id, title);
    setEditing(null);
  }

  const totals = chapters.reduce((summary, chapter) => {
    summary.total += chapter.topics.length;
    summary.completed += chapter.topics.filter((topic) => topic.is_completed).length;
    return summary;
  }, { total: 0, completed: 0 });
  const overall = percent(totals.completed, totals.total);

  return <section className={styles.tracker} aria-labelledby="chapter-tracker-heading">
    <div className={styles.heading}><div><p>PERSONAL STUDY PLAN</p><h3 id="chapter-tracker-heading">Chapter progress</h3><span>{totals.total ? `${totals.completed} of ${totals.total} topics complete` : "Add chapters and topics to start tracking."}</span></div><strong>{overall}%</strong></div>
    <div className={styles.overallTrack} role="progressbar" aria-label="Overall chapter progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={overall}><span style={{ width: `${overall}%` }} /></div>
    <form className={styles.addChapter} onSubmit={addChapter}><input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} placeholder="Add a chapter, e.g. Unit 1: Foundations" maxLength={160} aria-label="New chapter title"/><button type="submit" disabled={loading || !chapterTitle.trim()}><Plus size={15}/> Add chapter</button></form>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading && <p className={styles.loading} role="status">Saving your chapter progress…</p>}
    {!loading && !chapters.length && <EmptyState icon={Check} title="No chapters yet" description="Create chapters and add the topics you want to complete for this course." />}
    <div className={styles.chapterList}>{chapters.map((chapter) => {
      const completed = chapter.topics.filter((topic) => topic.is_completed).length;
      const chapterPercent = percent(completed, chapter.topics.length);
      const isCollapsed = collapsed[chapter.id];
      return <article className={styles.chapter} key={chapter.id}>
        <div className={styles.chapterTop}><button type="button" className={styles.collapse} onClick={() => setCollapsed((current) => ({ ...current, [chapter.id]: !current[chapter.id] }))} aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${chapter.title}`}>{isCollapsed ? <ChevronRight size={17}/> : <ChevronDown size={17}/>}</button><div className={styles.chapterTitle}><strong>{chapter.title}</strong><span>{completed}/{chapter.topics.length} topics · {chapterPercent}%</span></div><div className={styles.iconActions}><button type="button" onClick={() => setEditing({ kind: "chapter", id: chapter.id, title: chapter.title })} aria-label={`Edit ${chapter.title}`}><Pencil size={14}/></button><button type="button" onClick={() => onDeleteChapter(chapter)} aria-label={`Delete ${chapter.title}`}><Trash2 size={14}/></button></div></div>
        <div className={styles.chapterTrack}><span style={{ width: `${chapterPercent}%` }}/></div>
        {!isCollapsed && <div className={styles.topicArea}>{chapter.topics.map((topic) => <div className={styles.topic} key={topic.id}><button type="button" className={`${styles.toggle} ${topic.is_completed ? styles.done : ""}`} onClick={() => onToggleTopic(topic)} aria-label={`${topic.is_completed ? "Mark incomplete" : "Mark complete"}: ${topic.title}`}>{topic.is_completed && <Check size={13}/>}</button><span className={topic.is_completed ? styles.topicDone : ""}>{topic.title}</span><div className={styles.iconActions}><button type="button" onClick={() => setEditing({ kind: "topic", id: topic.id, title: topic.title })} aria-label={`Edit ${topic.title}`}><Pencil size={13}/></button><button type="button" onClick={() => onDeleteTopic(topic)} aria-label={`Delete ${topic.title}`}><Trash2 size={13}/></button></div></div>)}<form className={styles.addTopic} onSubmit={(event) => addTopic(event, chapter.id)}><input value={topicDrafts[chapter.id] || ""} onChange={(event) => setTopicDrafts((current) => ({ ...current, [chapter.id]: event.target.value }))} placeholder="Add a topic" maxLength={200} aria-label={`New topic for ${chapter.title}`}/><button type="submit" disabled={loading || !(topicDrafts[chapter.id] || "").trim()}><Plus size={14}/> Add</button></form></div>}
      </article>;
    })}</div>
    {editing && <div className={styles.editOverlay} role="dialog" aria-modal="true" aria-labelledby="edit-progress-title"><form className={styles.editDialog} onSubmit={(event) => { event.preventDefault(); saveEdit(); }}><div><h4 id="edit-progress-title">Edit {editing.kind}</h4><button type="button" onClick={() => setEditing(null)} aria-label="Close edit dialog"><X size={16}/></button></div><input autoFocus value={editing.title} onChange={(event) => setEditing((current) => ({ ...current, title: event.target.value }))} maxLength={editing.kind === "chapter" ? 160 : 200}/><div className={styles.editActions}><button type="submit" disabled={loading || !editing.title.trim()}>Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div></form></div>}
  </section>;
}
