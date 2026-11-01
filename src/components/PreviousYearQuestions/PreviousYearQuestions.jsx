import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileCheck2, FileText, Filter, LockKeyhole, Search, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { validatePdfFile } from "../../../server/learningTools.js";
import { validateMaterialFile } from "../MaterialsPanel/fileValidation.js";
import styles from "./PreviousYearQuestions.module.css";

const BUCKET = "previous-year-papers";
const YEARS = Array.from({ length: 31 }, (_, index) => new Date().getFullYear() - index);
const SUBJECTS = ["ESECE201D", "PCCSE201", "PCCSE203", "PCCSE205", "PCCSE207"];
const blank = { title: "", course_id: "", semester: "3", exam_year: String(new Date().getFullYear()), unit_id: "", verified: false, is_published: false };

export default function PreviousYearQuestions({ role, courses = [], onOpenMockTests }) {
  const isAdmin = role === "super_admin";
  const [rows, setRows] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState(null);
  const [filter, setFilter] = useState({ query: "", subject: "all", semester: "all", year: "all", unit: "all" });
  const [preview, setPreview] = useState(null);

  const refresh = useCallback(async () => {
    if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
    setLoading(true); setError("");
    const { data, error: readError } = await supabase.from("previous_year_papers")
      .select("id,title,course_id,semester,exam_year,unit_id,storage_path,original_filename,content_type,file_size,verified,is_published,published_at,created_at")
      .order("created_at", { ascending: false });
    if (readError) setError(readError.message || "Question papers could not be loaded.");
    else setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!isAdmin || !supabase || !courses.length) { setUnits([]); return; }
    supabase.from("academic_units").select("id,course_id,title,position").in("course_id", courses.map((course) => course.id)).is("archived_at", null).order("position")
      .then(({ data, error: readError }) => { if (!readError) setUnits(data || []); });
  }, [isAdmin, courses]);

  const visible = useMemo(() => rows.filter((paper) => {
    const course = courses.find((item) => item.id === paper.course_id);
    const code = String(course?.code || course?.course_code || "").toUpperCase();
    const title = `${paper.title} ${paper.original_filename} ${code} ${course?.name || course?.title || ""}`.toLowerCase();
    return (!filter.query || title.includes(filter.query.trim().toLowerCase()))
      && (filter.subject === "all" || code === filter.subject)
      && (filter.semester === "all" || String(paper.semester) === filter.semester)
      && (filter.year === "all" || String(paper.exam_year) === filter.year)
      && (filter.unit === "all" || String(paper.unit_id || "") === filter.unit);
  }), [rows, courses, filter]);

  async function upload(event) {
    event.preventDefault();
    if (!isAdmin || !supabase) return;
    if (!validatePdfFile(file)) {
      setError("Select a valid PDF file up to 25 MB."); return;
    }
    if (form.is_published && !form.verified) { setError("Verify the uploaded paper before publishing it as an official PYQ."); return; }
    setSaving(true); setError("");
    let path = "";
    try {
      await validateMaterialFile(file);
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again before uploading.");
      path = `${auth.user.id}/${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      const { error: insertError } = await supabase.from("previous_year_papers").insert({
        title: form.title.trim() || file.name.replace(/\.pdf$/i, ""), course_id: form.course_id || null,
        semester: Number(form.semester), exam_year: Number(form.exam_year), unit_id: form.unit_id || null,
        storage_path: path, original_filename: file.name, content_type: "application/pdf", file_size: file.size,
        verified: form.verified, is_published: form.is_published,
        published_by: form.is_published ? auth.user.id : null, published_at: form.is_published ? new Date().toISOString() : null,
        uploaded_by: auth.user.id,
      });
      if (insertError) throw insertError;
      setForm(blank); setFile(null); event.target.reset(); await refresh();
    } catch (failure) {
      if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      setError(failure.message || "The paper upload could not be completed.");
    } finally { setSaving(false); }
  }

  async function openFile(paper, download = false) {
    setError("");
    const { data, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(paper.storage_path, 300, download ? { download: paper.original_filename } : undefined);
    if (signError) { setError(signError.message || "The private PDF could not be opened."); return; }
    if (download) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    else setPreview({ ...paper, url: data.signedUrl });
  }

  async function togglePublish(paper) {
    if (!isAdmin || !supabase) return;
    if (!paper.is_published && !paper.verified && !window.confirm("Publishing marks this uploaded document as a verified official previous-year paper. Have you checked the source and file contents?")) return;
    const publish = !paper.is_published;
    const { data: auth } = await supabase.auth.getUser();
    const { error: updateError } = await supabase.from("previous_year_papers").update({
      is_published: publish, verified: publish ? true : paper.verified,
      published_by: publish ? auth.user.id : null, published_at: publish ? new Date().toISOString() : null,
    }).eq("id", paper.id);
    if (updateError) setError(updateError.message || "Paper visibility could not be changed.");
    else refresh();
  }

  async function removePaper(paper) {
    if (!isAdmin || !supabase || !window.confirm(`Delete ${paper.original_filename}? This removes the paper record and private file.`)) return;
    setSaving(true); setError("");
    const { error: objectError } = await supabase.storage.from(BUCKET).remove([paper.storage_path]);
    if (objectError) { setError(objectError.message || "The private PDF could not be deleted."); setSaving(false); return; }
    const { error: rowError } = await supabase.from("previous_year_papers").delete().eq("id", paper.id);
    if (rowError) setError(rowError.message || "The paper record could not be deleted.");
    else await refresh();
    setSaving(false);
  }

  function updateForm(event) { const { name, value, type, checked } = event.target; setForm((old) => ({ ...old, [name]: type === "checkbox" ? checked : value })); }

  return <section className={styles.page}>
    <header className={styles.heading}><span><FileText size={23}/></span><div><p>VERIFIED DOCUMENT LIBRARY</p><h1>Previous Year Questions</h1><small>Official PYQ labels are shown only for verified papers uploaded by an authorized administrator.</small></div></header>
    <section className={styles.practice}><div><span><ShieldCheck size={18}/></span><div><p>IMPORTANT PRACTICE QUESTIONS</p><h2>Practice without mixing sources</h2><small>Generated practice tests stay in a separate section and are never labeled as official exam papers.</small></div></div><button type="button" onClick={onOpenMockTests}>Open Mock Tests</button></section>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {isAdmin && <details className={styles.admin} open><summary><Upload size={16}/> Upload and manage official papers</summary><form onSubmit={upload}>
      <label>Paper title<input name="title" value={form.title} onChange={updateForm} maxLength={200} placeholder="Title shown to students"/></label>
      <label>Subject<select name="course_id" value={form.course_id} onChange={updateForm}><option value="">All subjects / unspecified</option>{courses.filter((course) => SUBJECTS.includes(String(course.code || course.course_code || "").toUpperCase())).map((course) => <option key={course.id} value={course.id}>{course.code || course.course_code} · {course.name || course.title}</option>)}</select></label>
      <label>Semester<select name="semester" value={form.semester} onChange={updateForm}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Exam year<select name="exam_year" value={form.exam_year} onChange={updateForm}>{YEARS.map((year) => <option key={year}>{year}</option>)}</select></label>
      <label>Unit<select name="unit_id" value={form.unit_id} onChange={updateForm}><option value="">All units</option>{units.filter((unit) => !form.course_id || unit.course_id === form.course_id).map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
      <label>Verified source<input type="checkbox" name="verified" checked={form.verified} onChange={updateForm}/></label>
      <label>Publish to students<input type="checkbox" name="is_published" checked={form.is_published} onChange={updateForm} disabled={!form.verified}/></label>
      <label className={styles.fileInput}>PDF file<input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} required/></label>
      <p>Private storage · PDF only · Maximum 25 MB. Publishing is restricted by Supabase RLS to an active Super Admin.</p>
      <button type="submit" disabled={saving}>{saving ? "Uploading…" : "Upload paper"}<Upload size={15}/></button>
    </form></details>}
    <div className={styles.filters}><label className={styles.search}><Search size={15}/><input value={filter.query} onChange={(event) => setFilter((old) => ({ ...old, query: event.target.value }))} placeholder="Search papers"/></label><label><Filter size={14}/><select value={filter.subject} onChange={(event) => setFilter((old) => ({ ...old, subject: event.target.value }))}><option value="all">All subjects</option>{SUBJECTS.map((code) => <option key={code}>{code}</option>)}</select></label><label><select aria-label="Filter semester" value={filter.semester} onChange={(event) => setFilter((old) => ({ ...old, semester: event.target.value }))}><option value="all">All semesters</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Semester {index + 1}</option>)}</select></label><label><select aria-label="Filter year" value={filter.year} onChange={(event) => setFilter((old) => ({ ...old, year: event.target.value }))}><option value="all">All years</option>{[...new Set([...YEARS, ...rows.map((row) => row.exam_year)])].sort((a, b) => b - a).map((year) => <option key={year}>{year}</option>)}</select></label><label><select aria-label="Filter unit" value={filter.unit} onChange={(event) => setFilter((old) => ({ ...old, unit: event.target.value }))}><option value="all">All units</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label></div>
    {loading ? <p className={styles.empty}>Loading published question papers…</p> : visible.length ? <div className={styles.list}>{visible.map((paper) => {
      const course = courses.find((item) => item.id === paper.course_id);
      return <article className={styles.paper} key={paper.id}><div className={styles.pdf}><FileCheck2 size={19}/></div><div className={styles.details}><span className={styles.badge}>{paper.is_published && paper.verified ? "Verified official PYQ" : "Admin draft · not published"}</span><h2>{paper.title}</h2><p>{course?.code || "All subjects"} · Semester {paper.semester} · {paper.exam_year}{paper.unit_id ? ` · ${units.find((unit) => unit.id === paper.unit_id)?.title || "Unit"}` : ""}</p><small>{paper.original_filename} · {(paper.file_size / 1048576).toFixed(2)} MB · Uploaded {new Date(paper.created_at).toLocaleDateString()}</small></div><div className={styles.actions}><button type="button" onClick={() => openFile(paper)}>Preview</button><button type="button" onClick={() => openFile(paper, true)} aria-label={`Download ${paper.original_filename}`}><Download size={15}/>Download</button>{isAdmin && <button type="button" onClick={() => togglePublish(paper)}>{paper.is_published ? "Unpublish" : "Publish"}</button>}{isAdmin && <button type="button" className={styles.delete} onClick={() => removePaper(paper)} disabled={saving} aria-label={`Delete ${paper.original_filename}`}><Trash2 size={15}/></button>}</div></article>;
    })}</div> : <div className={styles.empty}><LockKeyhole size={20}/><div><strong>No published papers are available for these filters.</strong><p>Official papers appear here only after an administrator uploads and verifies the actual PDF. No example or generated files are shown.</p></div></div>}
    {preview && <div className={styles.modal} role="dialog" aria-modal="true" aria-label={`Preview ${preview.title}`}><div><header><div><strong>{preview.title}</strong><small>{preview.original_filename} · Private signed preview</small></div><button type="button" onClick={() => setPreview(null)} aria-label="Close PDF preview"><X size={18}/></button></header><iframe title={preview.title} src={preview.url}/><a href={preview.url} download={preview.original_filename} target="_blank" rel="noreferrer"><Download size={15}/>Download PDF</a></div></div>}
  </section>;
}
