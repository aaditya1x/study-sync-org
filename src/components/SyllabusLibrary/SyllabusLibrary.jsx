import { useEffect, useMemo, useState } from "react";
import { BookOpenCheck, ExternalLink, FileText, GraduationCap, Search } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
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

export default function SyllabusLibrary({ query = "", courses = [], materials = [], loading = false, coursesStatus = "", materialsStatus = "" }) {
  const [catalog, setCatalog] = useState({});
  const [completed, setCompleted] = useState(new Set());
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(query);
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [savingTopic, setSavingTopic] = useState("");

  useEffect(() => setSearch(query), [query]);
  useEffect(() => {
    let active = true;
    async function load() {
      setLoadingTopics(true); setError("");
      if (!supabase) { setError("Connect the academic database to browse the verified syllabus catalog."); setCatalog({}); setLoadingTopics(false); return; }
      const courseIds = SUBJECTS.map((subject) => courses.find((course) => String(course.code || course.course_code || "").toUpperCase() === subject.code)?.id).filter(Boolean);
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
          ? await supabase.from("academic_topics").select("id, chapter_id, title, position").in("chapter_id", chapterIds).is("archived_at", null).order("position")
          : { data: [], error: null };
        if (topicError) throw topicError;
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        const { data: progress, error: progressError } = userData.user
          ? await supabase.from("academic_topic_progress").select("topic_id").eq("user_id", userData.user.id)
          : { data: [], error: null };
        if (progressError) throw progressError;
        if (!active) return;
        setCatalog(Object.fromEntries(SUBJECTS.map((subject) => {
          const course = courses.find((item) => String(item.code || item.course_code || "").toUpperCase() === subject.code);
          const subjectUnits = (units || []).filter((unit) => unit.course_id === course?.id).sort((a, b) => a.position - b.position);
          return [subject.code, { course, units: subjectUnits.map((unit, index) => ({
            ...unit, number: rankUnit(unit, index), chapters: (chapters || []).filter((chapter) => chapter.unit_id === unit.id).map((chapter) => ({
              ...chapter, topics: (topics || []).filter((topic) => topic.chapter_id === chapter.id),
            })),
          })) }];
        })));
        setCompleted(new Set((progress || []).map((row) => row.topic_id)));
      } catch (failure) { if (active) setError(failure.message || "The syllabus catalog could not be loaded."); }
      finally { if (active) setLoadingTopics(false); }
    }
    load();
    return () => { active = false; };
  }, [courses]);

  const visibleSubjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return SUBJECTS.filter((subject) => subjectFilter === "all" || subjectFilter === subject.code)
      .map((subject) => {
        const value = catalog[subject.code] || { units: [] };
        const units = [1, 2, 3, 4].map((number) => {
          const actual = value.units.find((unit) => unit.number === number) || value.units[number - 1];
          return { number, actual };
        }).filter(({ number, actual }) => unitFilter === "all" || Number(unitFilter) === number)
          .map(({ number, actual }) => ({ number, actual, chapters: (actual?.chapters || []).map((chapter) => ({
            ...chapter, topics: chapter.topics.filter((topic) => !term || `${subject.name} ${subject.code} Unit ${number} ${chapter.title} ${topic.title}`.toLowerCase().includes(term)),
          })).filter((chapter) => !term || chapter.topics.length || chapter.title.toLowerCase().includes(term)) }))
          .filter((unit) => !term || unit.chapters.length || `${subject.name} ${subject.code} Unit ${unit.number}`.toLowerCase().includes(term));
        return { ...subject, ...value, units };
      }).filter((subject) => !term || `${subject.name} ${subject.code}`.toLowerCase().includes(term) || subject.units.some((unit) => unit.chapters.length));
  }, [catalog, search, subjectFilter, unitFilter]);
  const otherCourses = courses.filter((course) => !SUBJECTS.some((subject) => subject.code === String(course.code || course.course_code || "").toUpperCase()));
  const unassignedShared = materials.filter((item) => item.isShared === true || item.is_shared === true)
    .filter((item) => !item.courseId && !item.course_id)
    .filter((item) => !search.trim() || `${item.name || ""} ${item.subject || ""}`.toLowerCase().includes(search.trim().toLowerCase()));

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
    <div className={styles.notice}>The uploaded syllabus PDF was not present in the project files. This browser shows the requested subject list and only displays unit topics that have been entered in the verified academic curriculum. No syllabus topics have been invented.</div>
    <div className={styles.filters}><label><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subjects and topics" aria-label="Search syllabus topics"/></label><select value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} aria-label="Filter by subject"><option value="all">All subjects</option>{SUBJECTS.map((subject) => <option key={subject.code} value={subject.code}>{subject.code} · {subject.name}</option>)}</select><select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} aria-label="Filter by unit"><option value="all">All units</option>{[1,2,3,4].map((unit) => <option key={unit} value={unit}>Unit {unit}</option>)}</select></div>
    {(error || coursesStatus === "error" || materialsStatus === "error") && <p className={styles.loadError} role="alert">{error || "Some subject or study material data could not be loaded."}</p>}
    {loadingTopics && <p className={styles.loading} role="status">Loading verified units and topics…</p>}
    <div className={styles.subjectList}>{visibleSubjects.map((subject) => {
      const allTopics = (catalog[subject.code]?.units || []).flatMap((unit) => unit.chapters.flatMap((chapter) => chapter.topics));
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
            {unit.actual ? unit.chapters.length ? unit.chapters.map((chapter) => <div className={styles.chapter} key={chapter.id}><h3>{chapter.title}</h3>{chapter.topics.length ? chapter.topics.map((topic) => <label key={topic.id} className={styles.topic}><input type="checkbox" checked={completed.has(topic.id)} disabled={savingTopic === topic.id} onChange={(event) => toggleTopic(topic.id, event.target.checked)}/><span>{topic.title}</span></label>) : <p className={styles.empty}>No topics have been entered under this heading.</p>}</div>) : <p className={styles.empty}>The verified unit has no topic entries yet.</p> : <p className={styles.empty}>Topic details will appear after the source syllabus has been reviewed and entered.</p>}
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
