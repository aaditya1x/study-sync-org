import { ArrowUpRight, BookOpen, Trash2 } from "lucide-react";
import styles from "./CourseCard.module.css";

const tones = {
  purple: "var(--primary-soft)",
  green: "color-mix(in srgb,var(--green) 13%,var(--surface))",
  blue: "color-mix(in srgb,#3f7fe8 12%,var(--surface))",
  orange: "color-mix(in srgb,#d97732 12%,var(--surface))",
};

export default function CourseCard({ course, onOpen, onDelete }) {
  const progress = Math.min(100, Math.max(0, Number(course.progress) || 0));
  return (
    <article className={styles.card}>
      <div className={styles.top}>
        <span className={styles.courseIcon} style={{ background: tones[course.color] || tones.purple }}><BookOpen size={19} /></span>
        <span className={styles.semester}>Semester {course.semester || 1}</span>
      </div>
      <h3>{course.name}</h3>
      <p className={styles.code}>{course.code || "Course code not set"} <span>·</span> {course.materials || 0} materials</p>
      <div className={styles.progressLabel}>
        <span>Task completion</span>
        <b>{progress}%</b>
      </div>
      <div className={styles.track} role="progressbar" aria-label={`${course.name} task completion`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className={styles.progressNote}>{course.progressTasks ? `Based on ${course.progressTasks} linked task${course.progressTasks === 1 ? "" : "s"}` : "Link tasks to track course progress"}</p>
      <div className={styles.actions}>
        <button type="button" onClick={onOpen} className={styles.open}>Open course <ArrowUpRight size={14} /></button>
        <button type="button" className={styles.delete} onClick={() => onDelete?.(course)} aria-label={`Delete ${course.name}`} title="Delete course"><Trash2 size={15} /></button>
      </div>
    </article>
  );
}
