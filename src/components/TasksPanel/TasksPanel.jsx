import { useMemo, useState } from "react";
import { CheckCircle2, Circle, Plus, ListTodo, Trash2, X, Pencil } from "lucide-react";
import { EmptyState } from "../EmptyState/index.js";
import styles from "./TasksPanel.module.css";

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function TasksPanel({
  tasks = [],
  setTasks,
  courses = [],
  notify,
  compact = false,
  syncStatus = "",
  syncError = "",
  query = "",
  onViewAll,
}) {
  const [filter, setFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [courseId, setCourseId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [formError, setFormError] = useState("");

  const done = tasks.filter((task) => task.completed).length;
  const visible = useMemo(() => tasks
    .filter((task) => !query.trim() || `${task.title} ${task.description || ""} ${courses.find((course) => course.id === task.courseId)?.name || ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((task) => filter === "all"
      || (filter === "open" && !task.completed)
      || (filter === "done" && task.completed))
    .slice(0, compact ? 4 : undefined), [tasks, filter, compact, query, courses]);

  function addTask(event) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setFormError("Enter a task or assignment title.");
      return;
    }

    setTasks((current) => editingTaskId
      ? current.map((task) => task.id === editingTaskId ? {
          ...task,
          title: cleanTitle,
          description: description.trim(),
          dueDate: dueDate || null,
          courseId: courseId || null,
        } : task)
      : [{ id: crypto.randomUUID(), title: cleanTitle, description: description.trim(), dueDate: dueDate || null, courseId: courseId || null, completed: false, createdAt: new Date().toISOString() }, ...current]);
    setTitle("");
    setDescription("");
    setDueDate("");
    setCourseId("");
    setFormError("");
    setEditingTaskId(null);
    setFilter("all");
    setFormOpen(false);
    notify(editingTaskId ? "Task updated." : "Task added.");
  }

  function editTask(task) {
    setEditingTaskId(task.id);
    setTitle(task.title || "");
    setDescription(task.description || "");
    setDueDate(task.dueDate || "");
    setCourseId(task.courseId || "");
    setFormError("");
    setFormOpen(true);
  }

  function toggleTask(task) {
    const completed = !task.completed;
    setTasks((current) => current.map((item) => item.id === task.id
      ? { ...item, completed, completedAt: completed ? new Date().toISOString() : null }
      : item));
  }

  function deleteTask(task) {
    setTasks((current) => current.filter((item) => item.id !== task.id));
    notify("Task deleted.");
  }

  const syncLabel = {
    checking: "Checking cloud sync…",
    saving: "Saving tasks…",
    synced: "Tasks synced to your account",
    local: "Tasks saved on this device",
    error: "Cloud sync failed; tasks remain saved on this device",
  }[syncStatus];

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <h2>{compact ? "Study checklist" : "Tasks & assignments"}</h2>
          <p>{compact ? "Small steps, meaningful progress" : "Keep track of revision, practice and coursework."}</p>
          {!compact && syncLabel && (
            <p className={syncStatus === "error" ? styles.syncError : styles.syncStatus} role="status">
              {syncLabel}{syncStatus === "error" && syncError ? `: ${syncError}` : ""}
            </p>
          )}
        </div>
        <span className={styles.badge}>{done}/{tasks.length} done</span>
      </div>

      {!compact && (
        <div className={styles.filters} role="group" aria-label="Filter tasks">
          {[["all", "All tasks"], ["open", "To do"], ["done", "Completed"]].map(([id, label]) => (
            <button
              type="button"
              key={id}
              onClick={() => setFilter(id)}
              className={filter === id ? styles.selected : ""}
              aria-pressed={filter === id}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {formOpen && (
        <form className={styles.form} onSubmit={addTask}>
          <label className={styles.field}>
            Task or assignment
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              placeholder="e.g. Submit DBMS assignment"
              required
            />
          </label>
          <label className={styles.field}>
            Notes <span className={styles.optional}>(optional)</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Add a reminder or a few details"
            />
          </label>
          <div className={styles.formRow}>
            <label className={styles.field}>
              Due date <span className={styles.optional}>(optional)</span>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            {!!courses.length && (
              <label className={styles.field}>
                Course <span className={styles.optional}>(optional)</span>
                <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                  <option value="">No course</option>
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>{course.name || course.title}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <div className={styles.formActions}>
            <button className={styles.submit} type="submit">{editingTaskId ? "Save changes" : <><Plus size={15} /> Save task</>}</button>
            <button
              className={styles.cancel}
              type="button"
              onClick={() => { setFormOpen(false); setFormError(""); setEditingTaskId(null); }}
            >
              <X size={14} /> Cancel
            </button>
          </div>
        </form>
      )}

      <div className={styles.list}>
        {visible.map((task) => {
          const course = courses.find((item) => item.id === task.courseId);
          const due = dateLabel(task.dueDate);
          const overdue = due && !task.completed && task.dueDate < localDateValue();
          return (
            <div key={task.id} className={styles.taskRow}>
              <label className={styles.task}>
                <input
                  type="checkbox"
                  checked={Boolean(task.completed)}
                  onChange={() => toggleTask(task)}
                  aria-label={`${task.completed ? "Mark incomplete" : "Mark complete"}: ${task.title}`}
                />
                <span className={styles.customCheck} aria-hidden="true">
                  {task.completed ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                </span>
                <span className={styles.copy}>
                  <strong className={task.completed ? styles.completed : ""}>{task.title}</strong>
                  {task.description && <small>{task.description}</small>}
                  {(due || course) && (
                    <small className={overdue ? styles.overdue : styles.metadata}>
                      {due ? `${overdue ? "Overdue · " : "Due "}${due}` : ""}
                      {due && course ? " · " : ""}
                      {course?.name || course?.title || ""}
                    </small>
                  )}
                </span>
              </label>
              <button
                type="button"
                className={styles.edit}
                onClick={() => editTask(task)}
                aria-label={`Edit ${task.title}`}
                title={`Edit ${task.title}`}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className={styles.delete}
                onClick={() => deleteTask(task)}
                title={`Delete ${task.title}`}
                aria-label={`Delete ${task.title}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>

      {!visible.length && (
        <EmptyState
          icon={ListTodo}
          title={query ? "No matching tasks" : filter === "done" ? "No completed tasks yet" : filter === "open" ? "All caught up" : "No tasks yet"}
          description={query ? "Try another search term." : filter === "all" ? "Add an assignment, revision session or reminder to get started." : "Tasks matching this filter will appear here."}
        />
      )}

      <button
        type="button"
        className={styles.add}
        onClick={() => { setFormOpen((open) => !open); setFormError(""); if (formOpen) setEditingTaskId(null); }}
        aria-expanded={formOpen}
      >
        {formOpen ? <X size={15} /> : <Plus size={15} />}
        {formOpen ? "Close form" : "Add task"}
      </button>
      {compact && <button type="button" className={styles.viewAll} onClick={onViewAll}>View all tasks <span aria-hidden="true">→</span></button>}
    </section>
  );
}
