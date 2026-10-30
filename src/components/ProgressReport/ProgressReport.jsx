import { ChartNoAxesCombined, BookOpen, FileText, ListTodo } from "lucide-react";
import { StatCard } from "../StatCard/index.js";
import styles from "./ProgressReport.module.css";

function percentage(completed, total) {
  if (!total) return 0;
  return completed === total ? 100 : Math.round((completed / total) * 100);
}

export default function ProgressReport({ courses, tasks, materials, chapterProgressByCourse = {} }) {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.completed).length;
  const taskProgress = percentage(completedTasks, totalTasks);
  const courseProgress = courses.map((course) => {
    const linked = tasks.filter((task) => String(task.courseId || "") === String(course.id));
    const chapterProgress = chapterProgressByCourse[course.id] || { completed: 0, total: 0 };
    return {
      ...course,
      taskCount: linked.length,
      actualProgress: percentage(linked.filter((task) => task.completed).length, linked.length),
      chapterProgress,
      chapterPercent: percentage(chapterProgress.completed, chapterProgress.total),
    };
  });
  const averageTaskProgress = courseProgress.length
    ? Math.round(courseProgress.reduce((sum, course) => sum + course.actualProgress, 0) / courseProgress.length)
    : 0;
  const totalTopics = courseProgress.reduce((sum, course) => sum + course.chapterProgress.total, 0);
  const completedTopics = courseProgress.reduce((sum, course) => sum + course.chapterProgress.completed, 0);
  const overallChapterProgress = percentage(completedTopics, totalTopics);

  return <section className={styles.page}>
    <div className={styles.heading}><p>YOUR GROWTH</p><h1>Progress report</h1><span>Review chapter progress and task completion separately.</span></div>
    <div className={styles.stats}>
      <StatCard label="Task completion" value={`${taskProgress}%`} note={`${completedTasks} of ${totalTasks} tasks completed`} icon={ListTodo} tint="purple"/>
      <StatCard label="Average task progress" value={`${averageTaskProgress}%`} note="Across courses with assigned tasks" icon={ChartNoAxesCombined} tint="green"/>
      <StatCard label="Chapter progress" value={`${overallChapterProgress}%`} note={`${completedTopics} of ${totalTopics} personal topics complete`} icon={BookOpen} tint="blue"/>
      <StatCard label="Available courses" value={courses.length} note="College study library" icon={BookOpen} tint="blue"/>
      <StatCard label="Materials available" value={materials.length} note="Shared files and your private uploads" icon={FileText} tint="orange"/>
    </div>
    <div className={styles.panel}>
      <div className={styles.taskProgressHeading}><div><h2>Overall task completion</h2><p>{totalTasks === 0 ? "Add a task to start tracking progress." : taskProgress === 100 ? "Every task is complete." : "Keep going; each completed task moves you forward."}</p></div><strong>{taskProgress}%</strong></div>
      <div className={styles.taskProgressTrack} role="progressbar" aria-label="Overall task completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={taskProgress}><span style={{ width: `${taskProgress}%` }}/></div>
    </div>
    <div className={styles.panel}>
      <div className={styles.taskProgressHeading}><div><h2>Overall chapter progress</h2><p>{totalTopics ? `${completedTopics} of ${totalTopics} personal topics complete` : "Add chapters and topics in a course to start tracking."}</p></div><strong>{overallChapterProgress}%</strong></div>
      <div className={styles.taskProgressTrack} role="progressbar" aria-label="Overall chapter progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overallChapterProgress}><span style={{ width: `${overallChapterProgress}%` }}/></div>
    </div>
    <div className={styles.panel}><h2>Course completion</h2><p>Task progress and personal chapter progress use separate counts.</p>{courseProgress.map((course) => <div className={styles.course} key={course.id}><div className={styles.courseHead}><strong>{course.name}</strong><span>Tasks {course.actualProgress}% · Chapters {course.chapterPercent}%</span></div><div className={styles.courseProgress}><div className={styles.track} role="progressbar" aria-label={`${course.name} task completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={course.actualProgress}><span style={{ width: `${course.actualProgress}%` }}/></div><div className={styles.track} role="progressbar" aria-label={`${course.name} chapter progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={course.chapterPercent}><span style={{ width: `${course.chapterPercent}%` }}/></div></div><small>{course.code} · Semester {course.semester} · {course.taskCount} linked tasks · {course.chapterProgress.completed} of {course.chapterProgress.total} topics</small></div>)}</div>
  </section>;
}
