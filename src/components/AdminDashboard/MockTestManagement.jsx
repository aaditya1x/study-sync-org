import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Plus, RefreshCw, Trash2, Sparkles, CheckCheck, Pencil } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { learningRequest } from "../../lib/learningApi.js";
import styles from "./MockTestManagement.module.css";

const blankConfig = { title: "", course_id: "", scope: "subject", unit_id: "", topic_id: "", difficulty: "any", question_count: 10, marks_per_question: 1, duration_minutes: 20, is_published: false };
const blankQuestion = { course_id: "", unit_id: "", topic_id: "", prompt: "", options: ["", "", "", ""], correct_index: 0, explanation: "", difficulty: "easy", source_verified: false, is_active: false };
const blankGenerator = { course_id: "", unit_id: "", topic_id: "", difficulty: "any", question_count: 10 };

export default function MockTestManagement() {
  const [configs, setConfigs] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [results, setResults] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [courses, setCourses] = useState([]);
  const [units, setUnits] = useState([]);
  const [topics, setTopics] = useState([]);
  const [config, setConfig] = useState(blankConfig);
  const [question, setQuestion] = useState(blankQuestion);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generator, setGenerator] = useState(blankGenerator);
  const [selectedDrafts, setSelectedDrafts] = useState([]);
  const [academicDegrees, setAcademicDegrees] = useState([]);
  const [academicBranches, setAcademicBranches] = useState([]);
  const [academicCycles, setAcademicCycles] = useState([]);
  const [courseBranchMappings, setCourseBranchMappings] = useState([]);
  const [allocation, setAllocation] = useState({ degree_id: "", branch_id: "", academic_cycle_id: "", semester: "" });

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [available, bank, attempts, insight, courseResult, unitResult, topicResult, degreeResult, branchResult, cycleResult, mappingResult] = await Promise.all([
        learningRequest("admin-list"), learningRequest("admin-questions"), learningRequest("admin-results"), learningRequest("admin-analytics"),
        supabase.from("courses").select("id,name,title,code,course_code,branch_id,academic_cycle_id,year_level,semester").order("name"),
        supabase.from("academic_units").select("id,course_id,title,position").is("archived_at", null).order("position"),
        supabase.from("academic_topics").select("id,chapter_id,title,position").is("archived_at", null).order("position"),
        supabase.from("academic_degrees").select("id,name").order("name"),
        supabase.from("academic_branches").select("id,degree_id,name").order("name"),
        supabase.from("academic_cycles").select("id,label").order("label"),
        supabase.from("course_branch_visibility").select("course_id,branch_id"),
      ]);
      for (const result of [courseResult, unitResult, topicResult, degreeResult, branchResult, cycleResult]) if (result.error) throw result.error;
      if (mappingResult.error && !["42P01", "PGRST205"].includes(mappingResult.error.code)) throw mappingResult.error;
      setConfigs(available || []); setQuestions(bank || []); setResults(attempts || []);
      setAnalytics(insight || null);
      setCourses(courseResult.data || []); setUnits(unitResult.data || []); setTopics(topicResult.data || []);
      setAcademicDegrees(degreeResult.data || []); setAcademicBranches(branchResult.data || []); setAcademicCycles(cycleResult.data || []);
      setCourseBranchMappings(mappingResult.error ? [] : mappingResult.data || []);
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
  const allocationCourses = courses.filter((course) => {
    const mappedToBranch = courseBranchMappings.some((mapping) => mapping.course_id === course.id && mapping.branch_id === allocation.branch_id);
    const allocatedBranchId = allocation.branch_id && mappedToBranch ? allocation.branch_id : course.branch_id;
    return (!allocation.degree_id || academicBranches.find((branch) => branch.id === allocatedBranchId)?.degree_id === allocation.degree_id)
    && (!allocation.branch_id || course.branch_id === allocation.branch_id || mappedToBranch)
    && (!allocation.academic_cycle_id || course.academic_cycle_id === allocation.academic_cycle_id)
    && (!allocation.semester || Number(course.semester) === Number(allocation.semester));
  });

  async function submitConfig(event) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try { await learningRequest("save-config", config); setConfig(blankConfig); setNotice("Mock test configuration saved."); await refresh(); }
    catch (failure) { setError(failure.message || "Test configuration could not be saved."); }
    finally { setSaving(false); }
  }
  async function submitQuestion(event) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try { await learningRequest("save-question", { ...question, confirm_source_review: question.source_verified === true }); setQuestion(blankQuestion); setNotice("Practice Question saved to the bank."); await refresh(); }
    catch (failure) { setError(failure.message || "Practice Question could not be saved."); }
    finally { setSaving(false); }
  }
  async function generateQuestions(event) {
    event.preventDefault(); setSaving(true); setError(""); setNotice("");
    try {
      const result = await learningRequest("generate-questions", { ...generator, degree_id: allocation.degree_id, branch_id: allocation.branch_id, academic_cycle_id: allocation.academic_cycle_id, semester: allocation.semester });
      setNotice(`${result?.questions?.length || 0} AI-generated questions saved as drafts from ${result?.source || "the verified syllabus"}.`);
      setSelectedDrafts([]); await refresh();
    } catch (failure) { setError(failure.message || "Question generation could not be completed."); }
    finally { setSaving(false); }
  }
  async function approveSelected() {
    if (!selectedDrafts.length || !window.confirm("Confirm that you manually checked each selected question, answer key, explanation, and cited source before approval?")) return;
    setSaving(true); setError("");
    try { const result = await learningRequest("approve-questions", { ids: selectedDrafts, confirm_source_review: true }); setNotice(`${result.approved} questions approved and made available to students.`); setSelectedDrafts([]); await refresh(); }
    catch (failure) { setError(failure.message || "Questions could not be approved."); }
    finally { setSaving(false); }
  }
  function editQuestion(row) {
    setQuestion({ ...row, options: Array.isArray(row.options) ? row.options : ["", "", "", ""] });
    const editor = document.getElementById("mock-question-editor");
    if (editor) { editor.open = true; editor.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }
  async function toggleConfig(row) {
    setSaving(true); setError("");
    try { await learningRequest("save-config", { ...row, id: row.id, is_published: !row.is_published }); await refresh(); }
    catch (failure) { setError(failure.message || "Test availability could not be changed."); }
    finally { setSaving(false); }
  }
  async function toggleQuestion(row) {
    setSaving(true); setError("");
    try { await learningRequest("save-question", { ...row, is_active: !row.is_active, source_verified: row.source_verified, confirm_source_review: row.source_verified === true }); await refresh(); }
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
      <section className={styles.panel}><h4>Academic allocation</h4><div className={styles.filters}>
        <label>Degree<select value={allocation.degree_id} onChange={(event) => setAllocation({ degree_id: event.target.value, branch_id: "", academic_cycle_id: allocation.academic_cycle_id, semester: allocation.semester })}><option value="">All degrees</option>{academicDegrees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Branch<select value={allocation.branch_id} onChange={(event) => setAllocation((old) => ({ ...old, branch_id: event.target.value }))}><option value="">All branches</option>{academicBranches.filter((item) => !allocation.degree_id || item.degree_id === allocation.degree_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Academic cycle<select value={allocation.academic_cycle_id} onChange={(event) => setAllocation((old) => ({ ...old, academic_cycle_id: event.target.value }))}><option value="">All cycles</option>{academicCycles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Semester<select value={allocation.semester} onChange={(event) => setAllocation((old) => ({ ...old, semester: event.target.value }))}><option value="">All semesters</option>{Array.from({ length: 12 }, (_, i) => i + 1).map((semester) => <option key={semester}>{semester}</option>)}</select></label>
      </div></section>

      <details className={styles.panel} open><summary><ClipboardCheck size={16}/> Create a practice test</summary><form onSubmit={submitConfig}>
        <label>Test title<input value={config.title} onChange={(event) => setConfig((old) => ({ ...old, title: event.target.value }))} minLength={3} maxLength={160} required placeholder="e.g. Unit 1 practice"/></label>
        <label>Subject<select value={config.course_id} onChange={(event) => setConfig((old) => ({ ...old, course_id: event.target.value }))} required><option value="">Select subject</option>{allocationCourses.map((course) => <option key={course.id} value={course.id}>{course.code || course.course_code} · {course.name || course.title}</option>)}</select></label>
        <label>Scope<select value={config.scope} onChange={(event) => setConfig((old) => ({ ...old, scope: event.target.value, unit_id: "", topic_id: "" }))}>{[["subject","Subject-wise"],["unit","Unit-wise"],["topic","Topic-wise"],["full","Full syllabus"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {["unit","topic"].includes(config.scope) && <label>Unit<select value={config.unit_id} onChange={(event) => setConfig((old) => ({ ...old, unit_id: event.target.value, topic_id: "" }))} required><option value="">Select unit</option>{configUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>}
        {config.scope === "topic" && <label>Topic<select value={config.topic_id} onChange={(event) => setConfig((old) => ({ ...old, topic_id: event.target.value }))} required><option value="">Select topic</option>{topicOptions.filter(({ unit }) => unit.id === config.unit_id).map(({ topic }) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>}
        <label>Difficulty<select value={config.difficulty} onChange={(event) => setConfig((old) => ({ ...old, difficulty: event.target.value }))}>{[["any","Any difficulty"],["easy","Easy"],["medium","Medium"],["hard","Hard"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Question count<select value={config.question_count} onChange={(event) => setConfig((old) => ({ ...old, question_count: Number(event.target.value) }))}>{[10,20,30].map((count) => <option key={count}>{count}</option>)}</select></label>
        <label>Marks per question<select value={config.marks_per_question} onChange={(event) => setConfig((old) => ({ ...old, marks_per_question: Number(event.target.value) }))}>{[1,2,3,4,5].map((marks) => <option key={marks} value={marks}>{marks} {marks === 1 ? "mark" : "marks"}</option>)}</select></label>
        <label>Duration (minutes)<input type="number" min="5" max="180" value={config.duration_minutes} onChange={(event) => setConfig((old) => ({ ...old, duration_minutes: Number(event.target.value) }))}/></label>
        <button disabled={saving}><Plus size={14}/> Save as draft</button>
      </form></details>

      <details className={styles.panel} open><summary><Sparkles size={16}/> AI Question Generator</summary><form onSubmit={generateQuestions}>
        <label>Subject<select value={generator.course_id} onChange={(event) => setGenerator((old) => ({ ...old, course_id: event.target.value, unit_id: "", topic_id: "" }))} required><option value="">Select subject</option>{allocationCourses.map((course) => <option key={course.id} value={course.id}>{course.code || course.course_code} · {course.name || course.title}</option>)}</select></label>
        <label>Unit<select value={generator.unit_id} onChange={(event) => setGenerator((old) => ({ ...old, unit_id: event.target.value, topic_id: "" }))} required><option value="">Select unit</option>{units.filter((unit) => unit.course_id === generator.course_id).map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
        <label>Topic<select value={generator.topic_id} onChange={(event) => setGenerator((old) => ({ ...old, topic_id: event.target.value }))} required><option value="">Select topic</option>{topicOptions.filter(({ unit }) => unit.id === generator.unit_id).map(({ topic }) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
        <label>Difficulty<select value={generator.difficulty} onChange={(event) => setGenerator((old) => ({ ...old, difficulty: event.target.value }))}>{[["any","Mixed (30% Easy / 50% Medium / 20% Hard)"],["easy","Easy"],["medium","Medium"],["hard","Hard"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Number of questions<select value={generator.question_count} onChange={(event) => setGenerator((old) => ({ ...old, question_count: Number(event.target.value) }))}>{[10,20,30].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
        <p className={styles.help}>Uses only a private, verified syllabus PDF linked to the selected topic. Questions are saved as unverified drafts. A Super Admin must inspect the answer and source before approval. Source references are recorded in the explanation because the existing question schema has no source-reference column.</p>
        <button disabled={saving}><Sparkles size={14}/> Generate draft questions</button>
      </form></details>

      <details className={styles.panel} id="mock-question-editor"><summary><Plus size={16}/> {question.id ? "Edit Practice Question" : "Add a syllabus-linked Practice Question"}</summary><form onSubmit={submitQuestion}>
        <label>Subject<select value={question.course_id} onChange={(event) => setQuestion((old) => ({ ...old, course_id: event.target.value, unit_id: "", topic_id: "" }))} required><option value="">Select subject</option>{allocationCourses.map((course) => <option key={course.id} value={course.id}>{course.code || course.course_code} · {course.name || course.title}</option>)}</select></label>
        <label>Unit<select value={question.unit_id} onChange={(event) => setQuestion((old) => ({ ...old, unit_id: event.target.value, topic_id: "" }))} required><option value="">Select unit</option>{questionUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
        <label>Verified syllabus topic<select value={question.topic_id} onChange={(event) => setQuestion((old) => ({ ...old, topic_id: event.target.value }))} required><option value="">Select topic</option>{topicOptions.filter(({ unit }) => unit.id === question.unit_id).map(({ topic }) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label>
        <label>Difficulty<select value={question.difficulty} onChange={(event) => setQuestion((old) => ({ ...old, difficulty: event.target.value }))}>{["easy","medium","hard"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className={styles.wide}>Question<textarea value={question.prompt} onChange={(event) => setQuestion((old) => ({ ...old, prompt: event.target.value }))} rows={3} maxLength={4000} required/></label>
        {question.options.map((option, index) => <label key={index}>Option {String.fromCharCode(65 + index)}<input value={option} onChange={(event) => setQuestion((old) => ({ ...old, options: old.options.map((value, i) => i === index ? event.target.value : value) }))} maxLength={1000} required/></label>)}
        <label>Correct option<select value={question.correct_index} onChange={(event) => setQuestion((old) => ({ ...old, correct_index: Number(event.target.value) }))}>{question.options.map((option, index) => <option key={index} value={index}>{String.fromCharCode(65 + index)}</option>)}</select></label>
        <label className={styles.wide}>Explanation<textarea value={question.explanation} onChange={(event) => setQuestion((old) => ({ ...old, explanation: event.target.value }))} rows={2} maxLength={4000}/></label>
        <label className={styles.check}><input type="checkbox" checked={question.source_verified} onChange={(event) => setQuestion((old) => ({ ...old, source_verified: event.target.checked, is_active: false }))}/> I manually checked this question and answer against its cited source.</label>
        <label className={styles.check}><input type="checkbox" checked={question.is_active} disabled={!question.source_verified} onChange={(event) => setQuestion((old) => ({ ...old, is_active: event.target.checked }))}/> Make available to students as a Practice Question.</label>
        <p className={styles.help}>Include a “Source reference:” in the explanation. This does not make a question an official previous-year question.</p>
        <button disabled={saving}><Plus size={14}/> {question.id ? "Update Practice Question" : "Save Practice Question"}</button>{question.id && <button type="button" onClick={() => setQuestion(blankQuestion)}>Cancel edit</button>}
      </form></details>

      <section className={styles.panel}><h4>Published and draft tests</h4>{configs.length ? <div className={styles.rows}>{configs.map((row) => <article key={row.id}><div><strong>{row.title}</strong><small>{row.courses?.code || row.courses?.course_code} · {row.scope} · {row.difficulty} · {row.available_questions} verified active questions</small><small>{row.question_count} questions · {row.question_count * (row.marks_per_question || 1)} marks · {row.duration_minutes} min</small></div><span className={row.is_published ? styles.active : styles.draft}>{row.is_published ? "Published" : "Draft"}</span><button type="button" onClick={() => toggleConfig(row)} disabled={saving || (!row.is_published && row.available_questions < row.question_count)}>{row.is_published ? "Unpublish" : "Publish"}</button><button type="button" className={styles.danger} onClick={() => removeConfig(row)} disabled={saving}><Trash2 size={14}/></button></article>)}</div> : <p className={styles.empty}>No mock test configurations yet.</p>}</section>

      <section className={styles.panel}><div className={styles.queueHeader}><h4>Review &amp; approval queue</h4><button type="button" onClick={approveSelected} disabled={saving || !selectedDrafts.length}><CheckCheck size={14}/> Approve selected after source review ({selectedDrafts.length})</button></div>{questions.filter((row) => !row.source_verified && !row.is_active).length ? <div className={styles.rows}>{questions.filter((row) => !row.source_verified && !row.is_active).map((row) => <article key={row.id}><input aria-label={`Select ${row.prompt}`} type="checkbox" checked={selectedDrafts.includes(row.id)} onChange={(event) => setSelectedDrafts((old) => event.target.checked ? [...old,row.id] : old.filter((id) => id !== row.id))}/><div><strong>{row.prompt}</strong><small>{row.explanation}</small><small>{courses.find((course) => course.id === row.course_id)?.code || "Subject"} · {topics.find((topic) => topic.id === row.topic_id)?.title || "Topic"} · {row.difficulty} · Correct: {String.fromCharCode(65 + row.correct_index)}</small></div><span className={styles.draft}>Needs review</span><button type="button" onClick={() => editQuestion(row)} disabled={saving}><Pencil size={14}/> Edit</button><button type="button" className={styles.danger} onClick={() => removeQuestion(row)} disabled={saving}><Trash2 size={14}/></button></article>)}</div> : <p className={styles.empty}>No questions are waiting for review.</p>}</section>
      <section className={styles.panel}><h4>Approved question bank</h4>{questions.filter((row) => row.source_verified || row.is_active).length ? <div className={styles.rows}>{questions.filter((row) => row.source_verified || row.is_active).map((row) => <article key={row.id}><div><strong>{row.prompt}</strong><small>{courses.find((course) => course.id === row.course_id)?.code || "Subject"} · {topics.find((topic) => topic.id === row.topic_id)?.title || "Topic"} · {row.difficulty} · Correct: {String.fromCharCode(65 + row.correct_index)}</small><small>{row.source_verified ? "Reviewed against source" : "Not source verified"}</small></div><span className={row.is_active ? styles.active : styles.draft}>{row.is_active ? "Available" : "Inactive"}</span><button type="button" onClick={() => editQuestion(row)} disabled={saving}><Pencil size={14}/> Edit</button><button type="button" onClick={() => toggleQuestion(row)} disabled={saving || (!row.is_active && !row.source_verified)}>{row.is_active ? "Deactivate" : "Activate"}</button><button type="button" className={styles.danger} onClick={() => removeQuestion(row)} disabled={saving}><Trash2 size={14}/></button></article>)}</div> : <p className={styles.empty}>No approved practice questions yet.</p>}</section>

      <section className={styles.panel}><h4>Student results &amp; analytics</h4><div className={styles.analytics}><article><strong>{analytics?.total_attempts ?? 0}</strong><small>Submitted attempts (latest 500)</small></article><article><strong>{analytics?.average_percentage == null ? "—" : `${analytics.average_percentage}%`}</strong><small>Average score</small></article><article><strong>{questions.filter((row) => row.source_verified && row.is_active).length}</strong><small>Approved active questions</small></article></div><div className={styles.analysisGrid}><div><h5>Course performance</h5>{(analytics?.by_course || []).map((row) => <p key={row.course}>{row.course}: {row.average_percentage}% average ({row.attempts} attempts)</p>)}</div><div><h5>Difficulty performance</h5>{Object.entries(analytics?.by_difficulty || {}).map(([level,row]) => <p key={level}>{level}: {row.answered ? `${Math.round(row.correct / row.answered * 100)}%` : "—"} correct of {row.answered} answered ({row.questions} presented)</p>)}</div><div><h5>Score trend</h5>{(analytics?.by_day || []).slice(-14).map((row) => <p key={row.date}>{row.date}: {row.average_percentage}% average ({row.attempts} attempts)</p>)}</div></div>{results.length ? <div className={styles.rows}>{results.map((row) => <article key={row.id}><div><strong>{configs.find((item) => item.id === row.test_config_id)?.title || "Practice test"}</strong><small>Student account ID · {row.student_id}</small><small>{row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "In progress"}</small></div><span>{row.submitted_at ? `${row.score}/${row.question_ids.length * (row.marks_per_question || 1)} marks` : "In progress"}</span><small>{row.correct_count ?? 0} correct · {row.wrong_count ?? 0} wrong · {row.unanswered_count ?? 0} unanswered</small></article>)}</div> : <p className={styles.empty}>No submitted practice results are available.</p>}</section>
    </>}
  </section>;
}
