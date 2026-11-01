import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenCheck, CheckCircle2, ExternalLink, FileText, GraduationCap, Search, UploadCloud } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { sourceMatchesSelectedCourse, syllabusSourcesForCourse } from "../../lib/syllabusImport.js";
import styles from "./SyllabusLibrary.module.css";

const SUBJECTS = [
  ["ESECE201D", "Digital System Design"],
  ["PCCSE201", "Data Structures"],
  ["PCCSE203", "OOP Using Java"],
  ["PCCSE205", "Database Management Systems"],
  ["PCCSE207", "Computer Organization and Architecture"],
].map(([code, name]) => ({ code, name }));
const EXISTING_SYLLABUS_LINKS = [
  { title: "DCRUST official syllabus index", detail: "Browse current programme, scheme and syllabus documents.", url: "https://www.dcrustm.ac.in/syllabus", year: "Index" },
  { title: "B.Tech CSE scheme and syllabus · Semesters I–VI", detail: "Existing official syllabus link. Verify the scheme and admission year against your source PDF.", url: "https://www.dcrustm.ac.in/uploads/files/File2026092889982.pdf", year: "2026" },
  { title: "BCA complete syllabus · NEP-2020", detail: "Existing official syllabus link for BCA students.", url: "https://www.dcrustm.ac.in/uploads/files/File2026092486706.pdf", year: "NEP-2020" },
];

function rankUnit(unit, index) {
  const roman = { i: 1, ii: 2, iii: 3, iv: 4 };
  const found = String(unit.title || "").match(/(?:unit\s*)?(iv|iii|ii|i|[1-4])\b/i);
  return found ? Number(found[1]) || roman[found[1].toLowerCase()] || index + 1 : index + 1;
}

export default function SyllabusLibrary({ query = "", courses = [], materials = [], loading = false, coursesStatus = "", materialsStatus = "", onPageContextChange, platformRole }) {
  const [catalog, setCatalog] = useState({});
  const [completed, setCompleted] = useState(new Set());
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(query);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [savingTopic, setSavingTopic] = useState("");
  const [importCourseId, setImportCourseId] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSources, setImportSources] = useState([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [openingSource, setOpeningSource] = useState("");
  const sourceRequestId = useRef(0);
  const isSuperAdmin = platformRole === "super_admin";

  const subjectList = useMemo(() => {
    const list = [...SUBJECTS];
    for (const course of courses) {
      const code = String(course.code || course.course_code || course.id);
      if (!list.some((subject) => subject.code.toUpperCase() === code.toUpperCase() || subject.code.toUpperCase() === String(course.code || course.course_code || "").toUpperCase())) {
        list.push({ code, name: course.name || course.title || "Untitled subject", courseId: course.id });
      }
    }
    return list;
  }, [courses]);
  const subjectCourse = (subject) => courses.find((course) => (subject.courseId && course.id === subject.courseId)
    || String(course.code || course.course_code || "").toUpperCase() === subject.code.toUpperCase());

  async function syllabusRequest(body) {
    const { data, error: authError } = await supabase.auth.getSession();
    if (authError || !data.session?.access_token) throw new Error("Sign in again to manage syllabus imports.");
    const response = await fetch("/api/syllabus-import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Syllabus request failed (${response.status}).`);
    return result;
  }

  async function refreshSyllabusSources(courseId = importCourseId) {
    if (!isSuperAdmin || !supabase) return;
    const requestId = ++sourceRequestId.current;
    if (!courseId) { setImportSources([]); return; }
    try {
      const result = await syllabusRequest({ action: "list", ...(courseId ? { course_id: courseId } : {}) });
      if (requestId === sourceRequestId.current) setImportSources(syllabusSourcesForCourse(result.sources, courseId));
    } catch (failure) {
      if (requestId === sourceRequestId.current) setImportError(failure.message || "Could not load syllabus review items.");
    }
  }

  useEffect(() => {
    setImportSources([]);
    void refreshSyllabusSources(importCourseId);
    return () => { sourceRequestId.current += 1; };
  }, [isSuperAdmin, importCourseId, courses]);

  useEffect(() => setSearch(query), [query]);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingTopics(true); setError("");
      if (!supabase) { setError("Connect the academic database to browse the verified syllabus catalog."); setCatalog({}); setLoadingTopics(false); return; }
      const courseIds = subjectList.map((subject) => subjectCourse(subject)?.id).filter(Boolean);
      if (!courseIds.length) { setCatalog({}); setLoadingTopics(false); return; }
      try {
        const { data: units, error: unitError } = await supabase.from("academic_units").select("id, course_id, title, position").in("course_id", courseIds).is("archived_at", null).order("position");
        if (unitError) throw unitError;
        const unitIds = (units || []).map((unit) => unit.id);
        const { data: chapters, error: chapterError } = unitIds.length
          ? await supabase.from("academic_chapters").select("id, unit_id, title, position").in("unit_id", unitIds).is("archived_at", null).order("position")
          : { data: [], error: null };
        if (chapterError) throw chapterError;
        const chapterIds = (chapters || []).map((chapter) => chapter.id);
        const { data: topics, error: topicError } = chapterIds.length
          ? await supabase.from("academic_topics").select("id, chapter_id, parent_topic_id, title, position").in("chapter_id", chapterIds).is("archived_at", null).order("position")
          : { data: [], error: null };
        if (topicError) throw topicError;
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const { data: progress, error: progressError } = userData.user
          ? await supabase.from("academic_topic_progress").select("topic_id").eq("user_id", userData.user.id)
          : { data: [], error: null };
        if (progressError) throw progressError;
        if (!active) return;
        setCatalog(Object.fromEntries(subjectList.map((subject) => {
          const course = subjectCourse(subject);
          const subjectUnits = (units || []).filter((unit) => unit.course_id === course?.id).sort((a, b) => a.position - b.position);
          return [subject.code, { course, units: subjectUnits.map((unit, index) => ({
            ...unit, number: rankUnit(unit, index), chapters: (chapters || []).filter((chapter) => chapter.unit_id === unit.id).map((chapter) => ({
              ...chapter, topics: (topics || []).filter((topic) => topic.chapter_id === chapter.id && !topic.parent_topic_id)
                .map((topic) => ({ ...topic, subtopics: (topics || []).filter((child) => child.parent_topic_id === topic.id) })),
            })),
          })) }];
        })));
        setCompleted(new Set((progress || []).map((row) => row.topic_id)));
      } catch (failure) { if (active) setError(failure.message || "The syllabus catalog could not be loaded."); }
      finally { if (active) setLoadingTopics(false); }
    }
    load();
    return () => { active = false; };
  }, [courses, subjectList, refreshVersion]);

  useEffect(() => {
    if (!importCourseId && courses.length) setImportCourseId(courses[0].id);
  }, [courses, importCourseId]);

  async function importSyllabus(event) {
    event.preventDefault(); setImportError("");
    const form = event.currentTarget;
    if (!isSuperAdmin || !supabase) return;
    if (!importCourseId || !importFile) { setImportError("Choose a subject and syllabus PDF."); return; }
    if (importFile.size < 1 || importFile.size > 25 * 1024 * 1024 || (importFile.type && importFile.type !== "application/pdf") || !importFile.name.toLowerCase().endsWith(".pdf")) {
      setImportError("Select a valid PDF file up to 25 MB."); return;
    }
    const selectedCourseId = importCourseId;
    setImportBusy(true);
    let storagePath = "";
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Sign in again before uploading a syllabus.");
      storagePath = `syllabus/${auth.user.id}/${selectedCourseId}/${crypto.randomUUID()}.pdf`;
      const { error: uploadError } = await supabase.storage.from("academic-syllabi").upload(storagePath, importFile, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      const result = await syllabusRequest({ action: "process", course_id: selectedCourseId, storage_path: storagePath, filename: importFile.name, file_size: importFile.size });
      if (!sourceMatchesSelectedCourse(result.source, selectedCourseId)) throw new Error("The processed syllabus was not associated with the selected subject. No preview was added.");
      if (importCourseId === selectedCourseId) setImportSources((current) => [result.source, ...syllabusSourcesForCourse(current, selectedCourseId).filter((source) => source.id !== result.source.id)]);
      setImportFile(null);
      form.reset();
    } catch (failure) {
      setImportError(failure.message || "The syllabus could not be processed. An uploaded original remains in private Storage if upload completed.");
      await refreshSyllabusSources(selectedCourseId);
    } finally { setImportBusy(false); }
  }

  async function publishSyllabus(sourceId) {
    setImportBusy(true); setImportError("");
    try {
      await syllabusRequest({ action: "publish", source_id: sourceId });
      await refreshSyllabusSources(importCourseId);
      setRefreshVersion((value) => value + 1);
    } catch (failure) { setImportError(failure.message || "The reviewed syllabus could not be published."); }
    finally { setImportBusy(false); }
  }

  async function openSyllabusSource(source) {
    if (!supabase) return;
    setOpeningSource(source.id); setImportError("");
    try {
      const { data, error: signError } = await supabase.storage.from("academic-syllabi").createSignedUrl(source.storage_path, 300);
      if (signError) throw signError;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (failure) { setImportError(failure.message || "Could not open the private source PDF."); }
    finally { setOpeningSource(""); }
  }

  const visibleSubjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return subjectList.filter((subject) => subjectFilter === "all" || subjectFilter === subject.code)
      .map((subject) => {
        const value = catalog[subject.code] || { units: [] };
        const unitNumbers = [...new Set([1, 2, 3, 4, ...(value.units || []).map((unit) => unit.number)])].sort((a, b) => a - b);
        const units = unitNumbers.map((number) => {
          const actual = value.units.find((unit) => unit.number === number) || value.units[number - 1];
          return { number, actual };
        }).filter(({ number, actual }) => unitFilter === "all" || Number(unitFilter) === number)
          .map(({ number, actual }) => ({ number, actual, chapters: (actual?.chapters || []).map((chapter) => ({
            ...chapter, topics: chapter.topics.filter((topic) => !term || `${subject.name} ${subject.code} Unit ${number} ${chapter.title} ${topic.title}`.toLowerCase().includes(term)),
          })).filter((chapter) => !term || chapter.topics.length || chapter.title.toLowerCase().includes(term)) }))
          .filter((unit) => !term || unit.chapters.length || `${subject.name} ${subject.code} Unit ${unit.number}`.toLowerCase().includes(term));
        return { ...subject, ...value, units };
      }).filter((subject) => !term || `${subject.name} ${subject.code}`.toLowerCase().includes(term) || subject.units.some((unit) => unit.chapters.length));
  }, [catalog, search, subjectFilter, unitFilter, subjectList]);
  const otherCourses = courses.filter((course) => !subjectList.some((subject) => subjectCourse(subject)?.id === course.id));
  const unassignedShared = materials.filter((item) => item.isShared === true || item.is_shared === true)
    .filter((item) => !item.courseId && !item.course_id)
    .filter((item) => !search.trim() || `${item.name || ""} ${item.subject || ""}`.toLowerCase().includes(search.trim().toLowerCase()));

  const pageContextSummary = useMemo(() => {
    const lines = [`Visible curriculum filters: ${search.trim() || "no text search"}; subject ${subjectFilter}; unit ${unitFilter}.`];
    let remaining = 60;
    for (const subject of visibleSubjects) {
      lines.push(`${subject.name} (${subject.code})`);
      for (const unit of subject.units) {
        for (const chapter of unit.chapters) {
          for (const topic of chapter.topics) {
            if (remaining <= 0) break;
            lines.push(`- Unit ${unit.number}, ${chapter.title}: ${topic.title} (${completed.has(topic.id) ? "complete" : "incomplete"})`);
            for (const child of topic.subtopics || []) {
              if (remaining <= 0) break;
              lines.push(`  - Subtopic: ${child.title} (${completed.has(child.id) ? "complete" : "incomplete"})`);
              remaining -= 1;
            }
            remaining -= 1;
          }
          if (remaining <= 0) break;
        }
        if (remaining <= 0) break;
      }
      if (remaining <= 0) break;
    }
    if (loadingTopics) lines.push("Curriculum is still loading; no topics beyond the currently available rows are assumed.");
    if (error) lines.push("The curriculum page reports a loading/access error; unavailable content is not inferred.");
    return lines.join("\n").slice(0, 7000);
  }, [visibleSubjects, completed, search, subjectFilter, unitFilter, loadingTopics, error]);

  useEffect(() => {
    onPageContextChange?.({ page: "Syllabus", summary: pageContextSummary });
  }, [onPageContextChange, pageContextSummary]);

  async function toggleTopic(topicId, checked) {
    if (!supabase) return;
    setSavingTopic(topicId); setError("");
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) throw new Error("Sign in again to save topic progress.");
      if (checked) {
        const { error: saveError } = await supabase.from("academic_topic_progress").upsert({ user_id: data.user.id, topic_id: topicId }, { onConflict: "user_id,topic_id" });
        if (saveError) throw saveError;
        setCompleted((old) => new Set([...old, topicId]));
      } else {
        const { error: deleteError } = await supabase.from("academic_topic_progress").delete().eq("topic_id", topicId).eq("user_id", data.user.id);
        if (deleteError) throw deleteError;
        setCompleted((old) => { const next = new Set(old); next.delete(topicId); return next; });
      }
    } catch (failure) { setError(failure.message || "Topic progress could not be saved."); }
    finally { setSavingTopic(""); }
  }

  return <section className={styles.page}>
    <header className={styles.heading}><div className={styles.icon}><GraduationCap size={24}/></div><div><p className={styles.eyebrow}>DEGREE: B.TECH · BRANCH: COMPUTER SCIENCE & ENGINEERING</p><h1>Syllabus Browser</h1><p>Session 2026–27 · Semester III · Units 1–4</p></div></header>
    {isSuperAdmin ? <section className={styles.importPanel}>
      <div><h2><UploadCloud size={17}/> Import syllabus PDF</h2><p>Upload a text-based PDF for a subject. Extracted entries remain pending until you review and publish them.</p></div>
      <form onSubmit={importSyllabus}>
        <label>Subject<select value={importCourseId} onChange={(event) => setImportCourseId(event.target.value)} disabled={importBusy} required><option value="">Select subject</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name || course.title || "Untitled subject"}{course.code || course.course_code ? ` · ${course.code || course.course_code}` : ""}</option>)}</select></label>
        <label>Source PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => setImportFile(event.target.files?.[0] || null)} disabled={importBusy} required/></label>
        <button type="submit" disabled={importBusy || !importFile || !importCourseId}>{importBusy ? "Processing…" : "Upload and extract"}</button>
      </form>
      {importError && <p className={styles.importError} role="alert">{importError}</p>}
      {syllabusSourcesForCourse(importSources, importCourseId).filter((source) => source.status !== "verified").map((source) => <article className={styles.pendingImport} key={source.id}>
        <div><strong>{source.original_filename}</strong><span>{courses.find((course) => course.id === source.course_id)?.name || "Subject"} · {source.status === "pending_review" ? "Pending Super Admin verification" : "Processing failed; source retained"}</span></div>
        <button type="button" onClick={() => openSyllabusSource(source)} disabled={openingSource === source.id}>{openingSource === source.id ? "Opening…" : "Open source PDF"}</button>
        {source.processing_error && <p className={styles.importError}>{source.processing_error}</p>}
        {source.status === "pending_review" && <>
          {source.extracted_outline?.subject_found_in_pdf !== true && <p className={styles.importError}>The PDF content did not match the selected subject. It cannot be published.</p>}
          <ul>{(source.extracted_outline?.units || []).map((unit) => <li key={`${source.id}-${unit.number}`}><strong>Unit {unit.number}: {unit.title}</strong><ul>{unit.topics.map((topic, index) => <li key={`${unit.number}-${index}`}>{topic.title}{topic.subtopics?.length ? ` · ${topic.subtopics.join("; ")}` : ""}</li>)}</ul></li>)}</ul>
          <button type="button" onClick={() => publishSyllabus(source.id)} disabled={importBusy || source.extracted_outline?.subject_found_in_pdf !== true}><CheckCircle2 size={15}/> Verify and publish</button>
        </>}
      </article>)}
    </section> : <div className={styles.notice}>Curriculum topics are imported from source PDFs and displayed after an authorized Super Admin verifies the extracted outline. No syllabus topics are generated or invented.</div>}
    <div className={styles.filters}><label><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subjects and topics" aria-label="Search syllabus topics"/></label><select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label="Filter by subject"><option value="all">All subjects</option>{subjectList.map((subject) => <option key={subject.code} value={subject.code}>{subject.code} · {subject.name}</option>)}</select><select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} aria-label="Filter by unit"><option value="all">All units</option>{[...new Set([...visibleSubjects.flatMap((subject) => subject.units.map((unit) => unit.number)), 1, 2, 3, 4])].sort((a,b)=>a-b).map((unit) => <option key={unit} value={unit}>Unit {unit}</option>)}</select></div>
    {(error || coursesStatus === "error" || materialsStatus === "error") && <p className={styles.loadError} role="alert">{error || "Some subject or study material data could not be loaded."}</p>}
    {loadingTopics && <p className={styles.loading} role="status">Loading verified units and topics…</p>}
    <div className={styles.subjectList}>{visibleSubjects.map((subject) => {
      const allTopics = (catalog[subject.code]?.units || []).flatMap((unit) => unit.chapters.flatMap((chapter) => chapter.topics.flatMap((topic) => [topic, ...topic.subtopics])));
      const done = allTopics.filter((topic) => completed.has(topic.id)).length;
      const subjectMaterials = materials.filter((item) => String(item.courseId || item.course_id || "") === String(subject.course?.id || ""));
      return <article className={styles.subject} key={subject.code}>
        <div className={styles.subjectHead}><div><span>{subject.code} · Semester III</span><h2>{subject.name}</h2></div><span className={styles.progressText}>{done}/{allTopics.length} topics complete</span></div>
        <div className={styles.track} role="progressbar" aria-label={`${subject.name} topic progress`} aria-valuemin="0" aria-valuemax={allTopics.length || 1} aria-valuenow={done}><span style={{ width: `${allTopics.length ? done / allTopics.length * 100 : 0}%` }}/></div>
        {!subject.course && <p className={styles.empty}>Subject record is not available in your academic catalog yet.</p>}
        <div className={styles.units}>{subject.units.map((unit) => {
          const topics = unit.chapters.flatMap((chapter) => chapter.topics);
          if (search && !topics.length && !`${subject.name} ${subject.code} Unit ${unit.number}`.toLowerCase().includes(search.toLowerCase())) return null;
          return <details key={unit.number} className={styles.unit}>
            <summary><span>Unit {unit.number}{unit.actual?.title ? ` · ${unit.actual.title}` : ""}</span><small>{unit.actual ? `${topics.length} topics` : "No verified topic details available"}</small></summary>
            {unit.actual ? unit.chapters.length ? unit.chapters.map((chapter) => <div className={styles.chapter} key={chapter.id}><h3>{chapter.title}</h3>{chapter.topics.length ? chapter.topics.map((topic) => <div key={topic.id}><label className={styles.topic}><input type="checkbox" checked={completed.has(topic.id)} disabled={savingTopic === topic.id} onChange={(event) => toggleTopic(topic.id, event.target.checked)}/><span>{topic.title}</span></label>{topic.subtopics.map((subtopic) => <label key={subtopic.id} className={`${styles.topic} ${styles.subtopic}`}><input type="checkbox" checked={completed.has(subtopic.id)} disabled={savingTopic === subtopic.id} onChange={(event) => toggleTopic(subtopic.id, event.target.checked)}/><span>{subtopic.title}</span></label>)}</div>) : <p className={styles.empty}>No topics have been entered under this heading.</p>}</div>) : <p className={styles.empty}>The verified unit has no topic entries yet.</p> : <p className={styles.empty}>Topic details will appear after the source syllabus has been reviewed and entered.</p>}
            {subjectMaterials.length > 0 && <div className={styles.materialLinks}><h3><FileText size={14}/> Related shared study materials</h3>{subjectMaterials.map((material) => material.url ? <a href={material.url} key={material.id || material.path} target="_blank" rel="noreferrer">{material.name}<ExternalLink size={13}/></a> : <span key={material.id || material.path}>{material.name}</span>)}</div>}
          </details>;
        })}</div>
      </article>;
    })}</div>
    {!visibleSubjects.length && <div className={styles.empty}><Search size={20}/><p>No subjects or syllabus topics match the selected filters.</p></div>}
    <div className={styles.notice}><BookOpenCheck size={16}/> Unit/topic content is read from the academic curriculum managed in Academic Hub. Ask an authorized Super Admin to enter topics from the verified PDF before using topic-linked practice sets.</div>
    {otherCourses.length > 0 && <section className={styles.academicSection}><div className={styles.sectionHeading}><div><h2>Other available course subjects</h2><p>Shared courses outside the requested Semester III CSE list</p></div></div><div className={styles.courseList}>{otherCourses.map((course) => <article className={styles.courseCard} key={course.id}><div className={styles.courseHead}><div><span>SEMESTER {course.semester || 1}</span><h3>{course.name || course.title || "Untitled subject"}</h3></div><strong>{course.code || course.course_code || "Course"}</strong></div><div className={styles.courseFiles}><h4>Shared course files</h4>{materials.filter((item) => String(item.courseId || item.course_id || "") === String(course.id) && (item.isShared === true || item.is_shared === true)).length ? <ul>{materials.filter((item) => String(item.courseId || item.course_id || "") === String(course.id) && (item.isShared === true || item.is_shared === true)).map((material) => <li className={styles.file} key={material.id || material.path}><FileText size={15}/><span className={styles.fileDetails}><strong>{material.name}</strong><small>Shared course material</small></span>{material.url && <a href={material.url} target="_blank" rel="noreferrer">Open <ExternalLink size={13}/></a>}</li>)}</ul> : <p>No shared files are linked to this course yet.</p>}</div></article>)}</div></section>}
    {unassignedShared.length > 0 && <section className={styles.unassigned}><h3>Shared files not linked to a course</h3><ul>{unassignedShared.map((material) => <li className={styles.file} key={material.id || material.path}><FileText size={15}/><span className={styles.fileDetails}><strong>{material.name}</strong><small>Shared study material</small></span>{material.url && <a href={material.url} target="_blank" rel="noreferrer">Open <ExternalLink size={13}/></a>}</li>)}</ul></section>}
    <section className={styles.academicSection}><div className={styles.sectionHeading}><div><h2>Official syllabus references</h2><p>Existing DCRUST links; these are not used to populate the requested uploaded syllabus topics.</p></div></div><div className={styles.grid}>{EXISTING_SYLLABUS_LINKS.map((item) => <article className={styles.card} key={item.title}><div className={styles.cardTop}><span>DCRUST official website</span><span className={styles.year}>{item.year}</span></div><h3>{item.title}</h3><p>{item.detail}</p><a href={item.url} target="_blank" rel="noreferrer">Open reference <ExternalLink size={14}/></a></article>)}</div></section>
  </section>;
}
