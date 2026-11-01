import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlarmClock, ArrowLeft, ArrowRight, CheckCircle2, Circle, ClipboardCheck, Flag, RotateCcw, Send } from "lucide-react";
import { learningRequest } from "../../lib/learningApi.js";
import { remainingSeconds } from "../../../server/learningTools.js";
import styles from "./MockTests.module.css";

function prettyTime(seconds) { return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; }

export default function MockTests({ role }) {
  const [tests, setTests] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [count, setCount] = useState(10);
  const [duration, setDuration] = useState(20);
  const [difficulty, setDifficulty] = useState("easy");
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [review, setReview] = useState({});
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resultError, setResultError] = useState("");
  const [answerSaveError, setAnswerSaveError] = useState("");
  const submitting = useRef(false);
  const autoSubmitted = useRef(false);
  const pendingAnswerSave = useRef(Promise.resolve());

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [available, previous] = await Promise.all([learningRequest("list-tests"), learningRequest("history")]);
      setTests(available || []); setHistory(previous || []);
      setSelectedId((old) => old || available?.[0]?.id || "");
      setResultError("");
    } catch (failure) { setError(failure.message || "Mock tests could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (role === "student") refresh(); }, [role, refresh]);
  const selected = tests.find((test) => test.id === selectedId) || null;
  const matchingCount = useMemo(() => {
    if (!selected) return 0;
    return selected.difficulty === "any" && difficulty !== "any"
      ? Number(selected.available_by_difficulty?.[difficulty] || 0)
      : Number(selected.available_questions || 0);
  }, [selected, difficulty]);
  const questions = attempt?.questions || [];
  const activeQuestion = questions[current];

  const submit = useCallback(async (auto = false) => {
    if (!attempt || submitting.current || result) return;
    if (!auto && !window.confirm("Submit this practice test now? You cannot change answers after submission.")) return;
    submitting.current = true; setBusy(true); setResultError("");
    try {
      await pendingAnswerSave.current.catch(() => {});
      const submitted = await learningRequest("submit-test", { attempt_id: attempt.attempt.id, answers });
      setResult(submitted); setAttempt(null);
      await refresh();
    } catch (failure) { setResultError(failure.message || "The test could not be submitted. Retry submission while the attempt remains available."); }
    finally { submitting.current = false; setBusy(false); }
  }, [attempt, result, answers, refresh]);

  useEffect(() => {
    if (!attempt || result) return undefined;
    const tick = () => {
      const seconds = remainingSeconds(attempt.attempt.ends_at);
      setRemaining(seconds);
      if (seconds <= 0 && !autoSubmitted.current) { autoSubmitted.current = true; void submit(true); }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [attempt, result, submit]);

  async function begin(test = selected) {
    if (!test) return;
    setBusy(true); setError(""); setResultError(""); setResult(null); setAnswers({}); setReview({}); setCurrent(0);
    autoSubmitted.current = false;
    pendingAnswerSave.current = Promise.resolve(); setAnswerSaveError("");
    try {
      const session = await learningRequest("start-test", { test_id: test.id, question_count: count, duration_minutes: duration, difficulty: test.difficulty === "any" ? difficulty : test.difficulty });
      setAttempt(session); setRemaining(remainingSeconds(session.attempt.ends_at));
    } catch (failure) { setError(failure.message || "The test could not be started."); }
    finally { setBusy(false); }
  }

  async function openHistory(item) {
    setBusy(true); setResultError(""); setResult(null); setAttempt(null);
    try { setResult(await learningRequest("view-result", { attempt_id: item.id })); }
    catch (failure) { setResultError(failure.message || "The result could not be loaded."); }
    finally { setBusy(false); }
  }

  function chooseAnswer(questionId, answerIndex) {
    setAnswers((old) => ({ ...old, [questionId]: answerIndex }));
    pendingAnswerSave.current = pendingAnswerSave.current.catch(() => {}).then(async () => {
      try {
        await learningRequest("save-answer", { attempt_id: attempt.attempt.id, question_id: questionId, answer_index: answerIndex });
        setAnswerSaveError("");
      } catch (failure) {
        setAnswerSaveError(failure.message || "This answer could not be saved yet.");
        throw failure;
      }
    });
  }

  if (role !== "student") return <section className={styles.page}><header><span><ClipboardCheck size={22}/></span><div><p>STUDENT PRACTICE</p><h1>Mock Tests</h1></div></header><div className={styles.empty} role="status">Mock tests are available to student accounts. Super Admins can configure practice tests in the Super Admin dashboard.</div></section>;

  return <section className={styles.page}>
    <header><span><ClipboardCheck size={22}/></span><div><p>PRACTICE QUESTIONS · NOT OFFICIAL EXAM PAPERS</p><h1>Mock Tests</h1><small>Practice Questions are drawn from the reviewed bank and are never presented as official previous-year questions.</small></div></header>
    {error && <div className={styles.error} role="alert">{error}<button type="button" onClick={refresh}>Retry</button></div>}
    {resultError && <div className={styles.error} role="alert">{resultError}<button type="button" onClick={() => attempt && submit(true)}>Retry submission</button></div>}
    {loading ? <p className={styles.status} role="status">Loading available practice tests…</p> : !attempt && !result && <>
      <div className={styles.configure}>
        <div><p>PRACTICE QUESTIONS · MOCK TEST</p><h2>Choose a practice set</h2><small>Test length and duration are checked against the published bank before a test begins.</small></div>
        {tests.length ? <>
          <label>Subject and test<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{tests.map((test) => <option key={test.id} value={test.id}>{test.courses?.code || test.courses?.course_code || "Subject"} · {test.title}</option>)}</select></label>
          <div className={styles.controlRow}>
            <label>Questions<select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[10,20,30].map((n) => <option key={n} value={n}>{n} questions</option>)}</select></label>
            <label>Duration<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{[10,20,30,45,60].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></label>
            <label>Difficulty<select value={selected?.difficulty === "any" ? difficulty : selected?.difficulty || difficulty} disabled={selected?.difficulty !== "any"} onChange={(event) => setDifficulty(event.target.value)}>{["easy","medium","hard"].map((level) => <option key={level} value={level}>{level[0].toUpperCase()+level.slice(1)}</option>)}</select></label>
          </div>
          <p className={styles.bankNote}>{selected?.scope === "full" ? "Full syllabus" : selected?.scope === "unit" ? "Unit-wise" : selected?.scope === "topic" ? "Topic-wise" : "Subject-wise"} · {matchingCount} verified active questions match this selection</p>
          <button className={styles.primary} type="button" onClick={() => begin()} disabled={busy || !selected || count > matchingCount}>{busy ? "Preparing…" : "Start practice test"}<ArrowRight size={16}/></button>
        </> : <div className={styles.empty}><Circle size={19}/><div><strong>No practice tests are published yet.</strong><p>Question banks and test availability are managed by an authorized Super Admin. No sample or invented questions are shown here.</p></div></div>}
      </div>
      {!!history.length && <section className={styles.history}><h2>Previous results</h2><div className={styles.historyList}>{history.map((item) => <article key={item.id}><div><strong>{item.title}</strong><small>{new Date(item.submitted_at).toLocaleString()} · {item.total} questions</small></div><b>{item.score}/{item.total}</b><button type="button" onClick={() => openHistory(item)}>Review result</button><button type="button" onClick={() => { const test = tests.find((entry) => entry.id === item.test_config_id); if (test) { setSelectedId(test.id); void begin(test); } else setError("This test is no longer published. Choose another practice set to retake."); }}>Retake</button></article>)}</div></section>}
    </>}
    {attempt && activeQuestion && !result && <div className={styles.exam}>
      <div className={styles.examTop}><div><small>PRACTICE QUESTIONS · {attempt.test.title}</small><h2>Question {current + 1} of {questions.length}</h2></div><div className={`${styles.timer} ${remaining < 60 ? styles.timerLow : ""}`} role="timer" aria-live="off"><AlarmClock size={17}/>{prettyTime(remaining)}</div></div>
      <div className={styles.progress}><span style={{ width: `${((current + 1) / questions.length) * 100}%` }}/></div>
      <div className={styles.questionLayout}><article className={styles.question}><p>{activeQuestion.prompt}</p><div className={styles.options}>{activeQuestion.options.map((option, index) => <label className={answers[activeQuestion.id] === index ? styles.chosen : ""} key={`${activeQuestion.id}-${index}`}><input type="radio" name={`answer-${activeQuestion.id}`} checked={answers[activeQuestion.id] === index} onChange={() => chooseAnswer(activeQuestion.id, index)}/><span>{String.fromCharCode(65 + index)}</span>{option}</label>)}</div><button className={styles.reviewToggle} type="button" aria-pressed={Boolean(review[activeQuestion.id])} onClick={() => setReview((old) => ({ ...old, [activeQuestion.id]: !old[activeQuestion.id] }))}><Flag size={15}/>{review[activeQuestion.id] ? "Remove review mark" : "Mark for review"}</button></article>
        <aside className={styles.palette}><h3>Question palette</h3><div>{questions.map((question, index) => <button key={question.id} type="button" onClick={() => setCurrent(index)} aria-label={`Question ${index + 1}${answers[question.id] !== undefined ? ", answered" : ", unanswered"}${review[question.id] ? ", marked for review" : ""}`} className={`${current === index ? styles.current : ""} ${answers[question.id] !== undefined ? styles.answered : ""} ${review[question.id] ? styles.flagged : ""}`}>{index + 1}</button>)}</div><small><i className={styles.answeredDot}/> Answered <i/> Unanswered <i className={styles.flagDot}/> For review</small></aside></div>
      <div className={styles.examActions}><button type="button" onClick={() => setCurrent((value) => Math.max(0, value - 1))} disabled={current === 0}><ArrowLeft size={15}/>Previous</button><button type="button" onClick={() => setCurrent((value) => Math.min(questions.length - 1, value + 1))} disabled={current === questions.length - 1}>Next<ArrowRight size={15}/></button><button className={styles.submit} type="button" onClick={() => submit(false)} disabled={busy}>{busy ? "Submitting…" : "Submit test"}<Send size={15}/></button></div>
      <p className={`${styles.examHint} ${answerSaveError ? styles.saveError : ""}`}><CheckCircle2 size={14}/> {answerSaveError || `${Object.keys(answers).length} answered · ${questions.length - Object.keys(answers).length} unanswered${busy ? " · Saving final responses…" : " · Responses save as you go"}`}</p>
    </div>}
    {result && <section className={styles.result}><div className={styles.score}><p>TEST RESULT · {result.title}</p><h2>{result.score} <small>/ {result.total}</small></h2><strong>{result.percentage}%</strong><div><span>Correct {result.correct}</span><span>Wrong {result.wrong}</span><span>Unattempted {result.unanswered}</span></div></div><h3>Answers and explanations</h3><div className={styles.reviewList}>{result.review.map((item, index) => <article key={item.id}><strong>{index + 1}. {item.prompt}</strong><p>Your answer: {item.picked === null ? "Not answered" : item.options[item.picked]}</p><p>Correct answer: {item.options[item.correct_index]}</p>{item.explanation && <small>Explanation: {item.explanation}</small>}</article>)}</div><button type="button" className={styles.primary} onClick={() => { setResult(null); setAnswers({}); setReview({}); setCurrent(0); setResultError(""); }}>Back to mock tests<ArrowLeft size={15}/></button></section>}
  </section>;
}
