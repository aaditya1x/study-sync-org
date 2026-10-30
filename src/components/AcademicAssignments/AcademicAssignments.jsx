import { useEffect, useState } from "react";
import { CalendarDays, ClipboardList } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import styles from "./AcademicAssignments.module.css";

export default function AcademicAssignments({ courses = [] }) {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState("loading");
  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase || !courses.length) { setRows([]); setState("ready"); return; }
      setState("loading");
      const { data, error } = await supabase.from("academic_assignments")
        .select("id, course_id, title, description, due_at")
        .in("course_id", courses.map((course) => course.id))
        .is("archived_at", null)
        .order("due_at", { ascending: true, nullsFirst: false });
      if (!active) return;
      if (error) { setRows([]); setState("error"); }
      else { setRows(data || []); setState("ready"); }
    }
    load();
    return () => { active = false; };
  }, [courses]);
  const names = new Map(courses.map((course) => [course.id, course.name]));
  return <section className={styles.panel} aria-labelledby="academic-assignments-heading">
    <div className={styles.heading}><span><ClipboardList size={18}/></span><div><h2 id="academic-assignments-heading">Academic assignments</h2><p>Assignments for your selected branch and courses.</p></div></div>
    {state === "loading" ? <p className={styles.status}>Loading assignments…</p> : state === "error" ? <p className={styles.status}>Assignments are currently unavailable.</p> : rows.length ? <ul>{rows.map((row) => <li key={row.id}><div><strong>{row.title}</strong><span>{names.get(row.course_id) || "Course"}</span>{row.description && <p>{row.description}</p>}</div>{row.due_at && <time dateTime={row.due_at}><CalendarDays size={14}/>{new Date(row.due_at).toLocaleDateString()}</time>}</li>)}</ul> : <p className={styles.status}>No academic assignments for your selected courses yet.</p>}
  </section>;
}
