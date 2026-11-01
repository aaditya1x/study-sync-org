import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Plus, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { learningRequest } from "../../lib/learningApi.js";
import styles from "./MockTestManagement.module.css";

const blankConfig = { title: "", course_id: "", scope: "subject", unit_id: "", topic_id: "", difficulty: "any", question_count: 10, duration_minutes: 20, is_published: false };
const blankQuestion = { course_id: "", unit_id: "", topic_id: "", prompt: "", options: ["", "", "", ""], correct_index: 0, explanation: "", difficulty: "easy", source_verified: false, is_active: false };

export default function MockTestManagement() {
  const [configs, setConfigs] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [results, setResults] = useState([]);
  const [courses, setCourses] = useState([]);
  const [units, setUnits] = useState([]);
  const [topics, setTopics] = useState([]);
  const [config, setConfig] = useState(blankConfig);
  const [question, setQuestion] = useState(blankQuestion);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [available, bank, attempts, courseResult, unitResult, topicResult] = await Promise.all([
        learningRequest("admin-list"), learningRequest("admin-questions"), learningRequest("admin-results"),
        supabase.from("courses").select("id,name,title,code,course_code,semester").order("name"),
        supabase.from("academic_units").select("id,course_id,title,position").is("archived_at", null).order("position"),
        supabase.from("academic_topics").select("id,chapter_id,title,position").is("archived_at", null).order("position"),
      ]);
      for (const result of [courseResult, unitResult, topicResult]) if (result.error) throw result.error;
      setConfigs(available || []); setQuestions(bank || []); setResults(attempts || []);
      setCourses(courseResult.data || []); setUnits(unitResult.data || []); setTopics(topicResult.data || []);
    } catch (failure) { setError(failure.message || "Learning management data could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const [chapters, setChapters] = useState([]);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("academic_chapters").select("id,unit_id,title,position").is("archived_at", null).order("position")
      .then(({ data }) => setChapters(data || []));
  }, []);
  const questionUnits = units.filter((unit) => unit.course_id === question.course_id);
  const configUnits = units.filter((unit) => unit.course_id === config.course_id);
  const topicOptions = topics.map((topic) => {
    const chapter = chapters.find((item) => item.id === topic.chapter_id);
    const unit = units.find((item) => item.id === chapter?.unit_id);
    const course = courses.find((item) => item.id === unit?.course_id);
    return { topic, chapter, unit, course };
  }).filter((item) => item.unit && item.chapter);

  async function submitConfig(event) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try { await learningRequest("save-config", config); setConfig(blankConfig); setNotice("Mock test configuration saved."); await refresh(); }
    catch (failure) { setError(failure.message || "Test configuration could not be saved."); }
    finally { setSaving(false); }
  }
  async function submitQuestion(event) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try { await learningRequest("save-question", question); setQuestion(blankQuestion); setNotice("Practice Question saved to the bank."); await refresh(); }
    catch (failure) { setError(failure.message || "Practice Question could not be saved."); }
    finally { setSaving(false); }
  }
  async function toggleConfig(row) {
    setSaving(true); setError("");
    try { await learningRequest("save-config", { ...row, id: row.id, is_published: !row.is_published }); await refresh(); }
    catch (failure) { setError(failure.message || "Test availability could not be changed."); }
    finally { setSaving(false); }
  }
  async function toggleQuestion(row) {
    setSaving(true); setError("");
    try { await learningRequest("save-question", { ...row, is_active: !row.is_active, source_verified: row.source_verified }); await refresh(); }
    catch (failure) { setError(failure.message || "Question status could not be changed."); }
    finally { setSaving(false); }
  }
  async function removeQuestion(row) {
    if (!window.confirm("Delete this Practice Question? Existing submitted results may refer to it.")) return;
    setSaving(true); setError("");
    try { await learningRequest("delete-question", { id: row.id }); await refresh(); }
    catch (failure) { setError(failure.message || "Question could not be deleted."); }
    finally { setSaving(false); }
  }
  async function removeConfig(row) {
    if (!window.confirm("Delete this test configuration? Existing results are retained and may prevent deletion.")) return;
    setSaving(true); setError("");
    try { await learningRequest("delete-config", { id: row.id }); await refresh(); }
    catch (failure) { setError(failure.message || "Test configuration could not be deleted."); }
    finally { setSaving(false); }
  }

  return <section className={styles.page}>
    <header><div><p>QUESTION BANK · TEST AVAILABILITY · RESULTS</p><h3>Mock Test Management</h3><small>Published sets use only active questions explicitly reviewed against syllabus topics. No official PYQ labels are used here.</small></div><button type="button" onClick={refresh} disabled={loading}><RefreshCw size={14}/> Refresh</button></header>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    {loading ? <p className={styles.empty}>Loading learning tools…</p> : <>
      <details className={styles.panel} open><summary><ClipboardCheck size={16}/> Create a practice test</summary><form onSubmit={submitConfig}>
        <label>Test title<input value={config.title} onChange={(event) => setConfig((old) => ({ ...old, title: event.target.value }))} minLength={3} maxLength={160} required placeholder="e.g. Unit 1 practice"/></label>
        <label>Subject<select value={config.course_id} onChange={(event) => setConfig((old) => ({ ...old, course_id: event.target.value }))} required><option value="">Select subject</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code || course.course_code} · {course.name || course.title}</option>)}</select></label>
        <label>Scope<select value={config.scope} onChange={(event) => setConfig((old) => ({ ...old, scope: event.target.value, unit_id: "", topic_id: "" }))}>{[["subject","Subject-wise"],["unit","Unit-wise"],["topic","Topic-wise"],["full","Full syllabus"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {["unit","topic"].includes(config.scope) && <label>Unit<select value={config.unit_id} onChange={(event) => setConfig((old) => ({ ...old, unit_id: event.target.value, topic_id: "" }))} required><option value="">Select unit</option>{configUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>}
        {config.scope === "topic" && <label>Topic<select value={config.topic_id} onChange={(event) => setConfig((old) => ({ ...old, topic_id: event.target.value }))} required><option value="">Select topic</option>{topicOptions.filter(({ unit }) => unit.id === config.unit_id).map(({ topic }) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>}
        <label>Difficulty<select value={config.difficulty} onChange={(event) => setConfig((old) => ({ ...old, difficulty: event.target.value }))}>{[["any","Any difficulty"],["easy","Easy"],["medium","Medium"],["hard","Hard"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Question count<select value={config.question_count} onChange={(event) => setConfig((old) => ({ ...old, question_count: Number(event.target.value) }))}>{[10,20,30].map((count) => <option key={count}>{count}</option>)}</select></label>
        <label>Duration (minutes)<input type="number" min="5" max="180" value={config.duration_minutes} onChange={(event) => setConfig((old) => ({ ...old, duration_minutes: Number(event.target.value) }))}/></label>
        <button disabled={saving}><Plus size={14}/> Save as draft</button>
      </form></details>

      <details className={styles.panel}><summary><Plus size={16}/> Add a syllabus-linked Practice Question</summary><form onSubmit={submitQuestion}>
        <label>Subject<select value={question.course_id} onChange={(event) => setQuestion((old) => ({ ...old, course_id: event.target.value, unit_id: "", topic_id: "" }))} required><option value="">Select subject</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code || course.course_code} · {course.name || course.title}</option>)}</select></label>
        <label>Unit<select value={question.unit_id} onChange={(event) => setQuestion((old) => ({ ...old, unit_id: event.target.value, topic_id: "" }))} required><option value="">Select unit</option>{questionUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
        <label>Verified syllabus topic<select value={question.topic_id} onChange={(event) => setQuestion((old) => ({ ...old, topic_id: event.target.value }))} required><option value="">Select topic</option>{topicOptions.filter(({ unit }) => unit.id === question.unit_id).map(({ topic }) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
        <label>Difficulty<select value={question.difficulty} onChange={(event) => setQuestion((old) => ({ ...old, difficulty: event.target.value }))}>{["easy","medium","hard"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className={styles.wide}>Question<textarea value={question.prompt} onChange={(event) => setQuestion((old) => ({ ...old, prompt: event.target.value }))} rows={3} maxLength={4000} required/></label>
        {question.options.map((option, index) => <label key={index}>Option {String.fromCharCode(65 + index)}<input value={option} onChange={(event) => setQuestion((old) => ({ ...old, options: old.options.map((value, i) => i === index ? event.target.value : value) }))} maxLength={1000} required/></label>)}
        <label>Correct option<select value={question.correct_index} onChange={(event) => setQuestion((old) => ({ ...old, correct_index: Number(event.target.value) }))}>{question.options.map((option, index) => <option key={index} value={index}>{String.fromCharCode(65 + index)}</option>)}</select></label>
        <label className={styles.wide}>Explanation<textarea value={question.explanation} onChange={(event) => setQuestion((old) => ({ ...old, explanation: event.target.value }))} rows={2} maxLength={4000}/></label>
        <label className={styles.check}><input type="checkbox" checked={question.source_verified} onChange={(event) => setQuestion((old) => ({ ...old, source_verified: event.target.checked, is_active: false }))}/> I reviewed this question against the verified syllabus PDF.</label>
        <label className={styles.check}><input type="checkbox" checked={question.is_active} disabled={!question.source_verified} onChange={(event) => setQuestion((old) => ({ ...old, is_active: event.target.checked }))}/> Make available to students as a Practice Question.</label>
        <p className={styles.help}>This does not make a question an official previous-year question. It must be linked to a topic in the reviewed curriculum and checked against the source PDF.</p>
        <button disabled={saving}><Plus size={14}/> Save Practice Question</button>
      </form></details>

      <section className={styles.panel}><h4>Published and draft tests</h4>{configs.length ? <div className={styles.rows}>{configs.map((row) => <article key={row.id}><div><strong>{row.title}</strong><small>{row.courses?.code || row.courses?.course_code} · {row.scope} · {row.difficulty} · {row.available_questions} verified active questions</small><small>{row.question_count} questions · {row.duration_minutes} min</small></div><span className={row.is_published ? styles.active : styles.draft}>{row.is_published ? "Published" : "Draft"}</span><button type="button" onClick={() => toggleConfig(row)} disabled={saving || (!row.is_published && row.available_questions < row.question_count)}>{row.is_published ? "Unpublish" : "Publish"}</button><button type="button" className={styles.danger} onClick={() => removeConfig(row)} disabled={saving}><Trash2 size={14}/></button></article>)}</div> : <p className={styles.empty}>No mock test configurations yet.</p>}</section>

      <section className={styles.panel}><h4>Practice question bank</h4>{questions.length ? <div className={styles.rows}>{questions.map((row) => <article key={row.id}><div><strong>{row.prompt}</strong><small>{courses.find((course) => course.id === row.course_id)?.code || "Subject"} · {topics.find((topic) => topic.id === row.topic_id)?.title || "Topic"} · {row.difficulty} · Correct: {String.fromCharCode(65 + row.correct_index)}</small><small>{row.source_verified ? "Reviewed against syllabus PDF" : "Not source verified"}</small></div><span className={row.is_active ? styles.active : styles.draft}>{row.is_active ? "Available" : "Draft"}</span><button type="button" onClick={() => toggleQuestion(row)} disabled={saving || (!row.is_active && !row.source_verified)}>{row.is_active ? "Deactivate" : "Activate"}</button><button type="button" className={styles.danger} onClick={() => removeQuestion(row)} disabled={saving}><Trash2 size={14}/></button></article>)}</div> : <p className={styles.empty}>No Practice Questions have been entered. Questions are never generated from placeholder content.</p>}</section>

      <section className={styles.panel}><h4>Submitted results (Super Admin review)</h4>{results.length ? <div className={styles.rows}>{results.map((row) => <article key={row.id}><div><strong>{configs.find((item) => item.id === row.test_config_id)?.title || "Practice test"}</strong><small>Student account ID · {row.student_id}</small><small>{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "In progress"}</small></div><span>{row.submitted_at ? `${row.score}/${row.question_ids.length}` : "In progress"}</span><small>{row.correct_count ?? 0} correct · {row.wrong_count ?? 0} wrong · {row.unanswered_count ?? 0} unanswered</small></article>)}</div> : <p className={styles.empty}>No submitted practice results are available.</p>}</section>
    </>}
  </section>;
}
