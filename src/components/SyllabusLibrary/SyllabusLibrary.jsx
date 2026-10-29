import { ExternalLink, FileText, GraduationCap, Search } from "lucide-react";
import styles from "./SyllabusLibrary.module.css";

const OFFICIAL_SYLLABUS_INDEX = "https://www.dcrustm.ac.in/syllabus";

const syllabi = [
  {
    id: "dcrust-index",
    programme: "All programmes",
    title: "DCRUST official syllabus index",
    detail: "Browse undergraduate, postgraduate, architecture, education, and older scheme documents. Confirm your admission year and scheme before studying.",
    url: OFFICIAL_SYLLABUS_INDEX,
    source: "DCRUST official website",
    year: "Updated index",
  },
  {
    id: "btech-cse-2026",
    programme: "B.Tech · Computer Science & Engineering",
    title: "Scheme and syllabus · Semesters I–VI",
    detail: "DCRUST CSE scheme and syllabus listed for September 2026.",
    url: "https://www.dcrustm.ac.in/uploads/files/File2026092889982.pdf",
    source: "DCRUST official website",
    year: "2026",
  },
  {
    id: "bca-nep",
    programme: "BCA",
    title: "Complete syllabus and scheme · NEP-2020",
    detail: "Complete BCA syllabus and scheme listed on the DCRUST official syllabus index.",
    url: "https://www.dcrustm.ac.in/uploads/files/File2026092486706.pdf",
    source: "DCRUST official website",
    year: "NEP-2020",
  },
];

function dateLabel(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function uploaderLabel(material) {
  return material.userId ? `Student ${material.userId.slice(0, 8)}` : "Student";
}

export default function SyllabusLibrary({
  query = "",
  courses = [],
  materials = [],
  loading = false,
  coursesStatus = "",
  materialsStatus = "",
}) {
  const search = query.trim().toLowerCase();
  const visibleSyllabi = syllabi.filter((item) =>
    `${item.programme} ${item.title} ${item.detail} ${item.year}`.toLowerCase().includes(search)
  );
  const sharedMaterials = materials.filter((item) => item.isShared === true);
  const visibleCourses = courses.filter((course) =>
    `${course.name || course.title || ""} ${course.code || course.course_code || ""} ${course.description || ""} ${course.semester || ""}`
      .toLowerCase().includes(search)
    || (search && sharedMaterials.some((material) =>
      String(material.courseId || material.course_id || "") === String(course.id)
      && `${material.name || ""} ${material.subject || ""}`.toLowerCase().includes(search)
    ))
  );
  const visibleUnassigned = sharedMaterials.filter((item) =>
    !item.courseId && !item.course_id
    && `${item.name || ""} ${item.subject || ""} unassigned`.toLowerCase().includes(search)
  );

  function renderFile(material) {
    return (
      <li className={styles.file} key={material.path || material.id}>
        <FileText size={16} aria-hidden="true" />
        <span className={styles.fileDetails}>
          <strong>{material.name}</strong>
          <small>Uploaded by {uploaderLabel(material)} · {dateLabel(material.addedAt)}</small>
        </span>
        {material.url && <a href={material.url} target="_blank" rel="noreferrer" aria-label={`Open ${material.name}`}>Open <ExternalLink size={13} /></a>}
      </li>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <div className={styles.icon} aria-hidden="true"><GraduationCap size={24} /></div>
        <div>
          <p className={styles.eyebrow}>COLLEGE STUDY LIBRARY</p>
          <h1>Syllabus Library</h1>
          <p>Browse shared courses, semesters, study files, and official syllabus links.</p>
        </div>
      </header>

      <div className={styles.notice}>
        Course and file listings come from the authenticated shared library. Official syllabus links open documents hosted by DCRUST; confirm that each document matches your admission year and scheme.
      </div>

      <section className={styles.academicSection} aria-labelledby="shared-courses-title">
        <div className={styles.sectionHeading}>
          <div><h2 id="shared-courses-title">Shared courses and semester subjects</h2><p>{courses.length} available course{courses.length === 1 ? "" : "s"}</p></div>
        </div>
        {(coursesStatus === "error" || materialsStatus === "error") && <p className={styles.loadError} role="alert">Some shared course or file data could not be loaded. Refresh the Courses or Study Materials page and try again.</p>}
        {visibleCourses.length > 0 ? (
          <div className={styles.courseList}>
            {visibleCourses.map((course) => {
              const files = sharedMaterials.filter((material) =>
                String(material.courseId || material.course_id || "") === String(course.id)
                && (!search || `${material.name} ${material.subject} ${course.name || course.title}`.toLowerCase().includes(search))
              );
              return (
                <article className={styles.courseCard} key={course.id}>
                  <div className={styles.courseHead}>
                    <div><span>SEMESTER {course.semester || 1}</span><h3>{course.name || course.title || "Untitled subject"}</h3></div>
                    <strong>{course.code || course.course_code || "Course"}</strong>
                  </div>
                  {course.description && <p className={styles.courseDescription}>{course.description}</p>}
                  <div className={styles.courseFiles}>
                    <h4>Shared course files</h4>
                    {files.length
                      ? <ul>{files.map(renderFile)}</ul>
                      : <p>{loading ? "Loading shared files…" : "No shared files are linked to this course yet."}</p>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : loading ? (
          <p className={styles.loading} role="status">Loading shared courses and files…</p>
        ) : (
          <div className={styles.empty}><Search size={20} /><p>{search ? "No shared courses match this search." : "No shared courses are available yet."}</p></div>
        )}
        {visibleUnassigned.length > 0 && (
          <div className={styles.unassigned}>
            <h3>Shared files not linked to a course</h3>
            <ul>{visibleUnassigned.map(renderFile)}</ul>
          </div>
        )}
      </section>

      <section className={styles.academicSection} aria-labelledby="official-syllabi-title">
        <div className={styles.sectionHeading}><div><h2 id="official-syllabi-title">Official syllabus documents</h2><p>Links hosted by DCRUST</p></div></div>
        <div className={styles.grid}>
          {visibleSyllabi.map((item) => (
            <article className={styles.card} key={item.id}>
              <div className={styles.cardTop}><span>{item.programme}</span><span className={styles.year}>{item.year}</span></div>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <small>{item.source}</small>
              <a href={item.url} target="_blank" rel="noreferrer">Open syllabus <ExternalLink size={15} /></a>
            </article>
          ))}
        </div>
        {!visibleSyllabi.length && <div className={styles.empty}><Search size={20} /><p>No official syllabus links match “{query}”.</p><a href={OFFICIAL_SYLLABUS_INDEX} target="_blank" rel="noreferrer">Browse DCRUST syllabus index</a></div>}
      </section>
    </section>
  );
}
