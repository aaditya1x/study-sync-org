import { ArrowUpRight, BookOpen, Trash2 } from "lucide-react";
import styles from "./CourseCard.module.css";

const tones = {
  purple: "var(--primary-soft)",
  green: "color-mix(in srgb,var(--green) 13%,var(--surface))",
  blue: "color-mix(in srgb,#3f7fe8 12%,var(--surface))",
  orange: "color-mix(in srgb,#d97732 12%,var(--surface))",
};

export default function CourseCard({ course, onOpen, onDelete, canManage = true }) {
  const progress = Math.min(100, Math.max(0, Number(course.progress) || 0));
  const chapterTotal = course.chapterProgress?.total || 0;
  const chapterCompleted = course.chapterProgress?.completed || 0;
  const chapterProgress = chapterTotal ? (chapterCompleted === chapterTotal ? 100 : Math.round((chapterCompleted / chapterTotal) * 100)) : 0;
  return (
    <article className={styles.card}>
      <div className={styles.top}>
        <span className={styles.courseIcon} style={{ background: tones[course.color] || tones.purple }}><BookOpen size={19} /></span>
        <span className={styles.semester}>Semester {course.semester || 1}</span>
      </div>
      <h3>{course.name}</h3>
      <span className={styles.ownerBadge}>{canManage ? "Your course" : "Shared course"}</span>
      <p className={styles.code}>{course.code || "Course code not set"} <span>·</span> {course.materials || 0} materials</p>
      {(course.branchName || course.cycleLabel || course.year_level) && <p className={styles.academicMeta}>{[course.branchName, course.cycleLabel, course.year_level ? `Year ${course.year_level}` : "", `Semester ${course.semester || 1}`].filter(Boolean).join(" · ")}</p>}
      <div className={styles.progressLabel}>
        <span>Task completion</span>
        <b>{progress}%</b>
      </div>
      <div className={styles.track} role="progressbar" aria-label={`${course.name} task completion`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className={styles.progressNote}>{course.progressTasks ? `Based on ${course.progressTasks} linked task${course.progressTasks === 1 ? "" : "s"}` : "Link tasks to track course progress"}</p>
      <div className={styles.chapterProgress}>
        <div className={styles.progressLabel}><span>Chapter progress</span><b>{chapterProgress}%</b></div>
        <div className={styles.track} role="progressbar" aria-label={`${course.name} chapter progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={chapterProgress}><span style={{ width: `${chapterProgress}%` }} /></div>
        <p className={styles.progressNote}>{chapterTotal ? `${chapterCompleted} of ${chapterTotal} personal topics complete` : "Add chapters to track your study plan"}</p>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={onOpen} className={styles.open}>Manage chapters <ArrowUpRight size={14} /></button>
        {canManage && <button type="button" className={styles.delete} onClick={() => onDelete?.(course)} aria-label={`Delete ${course.name}`} title="Delete course"><Trash2 size={15} /></button>}
      </div>
    </article>
  );
}
