import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Edit3, Plus, Trash2, X, UploadCloud, FileText, RotateCw } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { CourseCard } from "../CourseCard/index.js";
import { EmptyState } from "../EmptyState/index.js";
import styles from "./CourseLibrary.module.css";

function courseCode(title, requested, existing) {
  const input = requested.trim().toUpperCase();
  if (input) return input;
  const base = title.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "COURSE";
  let code = base;
  let suffix = 2;
  while (existing.some((course) => course.code?.toUpperCase() === code)) {
    code = `${base.slice(0, 7)}${suffix++}`;
  }
  return code;
}

function normalizeCourse(course) {
  return {
    ...course,
    name: course.name || course.title || "Untitled subject",
    code: course.code || course.course_code || "",
    semester: course.semester ?? 1,
    description: course.description || "",
  };
}

export default function CourseLibrary({
  courses = [],
  setCourses,
  setMaterials,
  setTasks,
  materials = [],
  tasks = [],
  notify,
  query = "",
  compact = false,
  initialSelectedCourseId = "",
  onOpenCourse,
  onViewAll,
  onUploadMaterial,
  autoOpenCreate = false,
  onCreateFormOpened,
  onCourseLoadStatusChange,
}) {
  const [semester, setSemester] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState(null);
  const [selectedCourseId, setSelectedCourseId] = useState(initialSelectedCourseId);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [semesterValue, setSemesterValue] = useState("1");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    setSelectedCourseId(initialSelectedCourseId || "");
  }, [initialSelectedCourseId]);

  useEffect(() => {
    if (selectedCourseId && coursesLoaded && !courses.some((course) => String(course.id) === String(selectedCourseId))) {
      setSelectedCourseId("");
    }
  }, [selectedCourseId, courses, coursesLoaded]);

  useEffect(() => {
    if (!autoOpenCreate || compact) return;
    setEditingCourse(null);
    setFormOpen(true);
    onCreateFormOpened?.();
  }, [autoOpenCreate, compact, onCreateFormOpened]);

  const loadCourses = useCallback(async () => {
    setCoursesLoaded(false);
    onCourseLoadStatusChange?.("loading");
    if (!supabase) {
      setError("Supabase is not configured. Check your VITE_SUPABASE_URL and publishable key.");
      setCoursesLoaded(true);
      onCourseLoadStatusChange?.("error");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to load your courses.");

      const { data, error: queryError } = await supabase
        .from("courses")
        .select("*")
        .eq("owner_id", authData.user.id)
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      setCourses((data || []).map(normalizeCourse));
      onCourseLoadStatusChange?.("loaded");
    } catch (loadError) {
      console.error("Course loading failed:", loadError);
      setError(loadError.message || "Could not load courses.");
      onCourseLoadStatusChange?.("error");
    } finally {
      setLoading(false);
      setCoursesLoaded(true);
    }
  }, [setCourses, onCourseLoadStatusChange]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!active) return;
      await loadCourses();
    }
    load();
    return () => { active = false; };
  }, [loadCourses, refreshVersion]);

  const visible = useMemo(() => courses.filter((course) =>
    (semester === "all" || String(course.semester) === semester)
    && `${course.name} ${course.code} ${course.description || ""}`.toLowerCase().includes(query.toLowerCase())
  ), [courses, semester, query]);

  function startCreate() {
    setEditingCourse(null);
    setTitle("");
    setCode("");
    setDescription("");
    setSemesterValue("1");
    setError("");
    setFormOpen(true);
  }

  function startEdit(course) {
    setEditingCourse(course);
    setTitle(course.name);
    setCode(course.code || "");
    setDescription(course.description || "");
    setSemesterValue(String(course.semester || 1));
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingCourse(null);
    setError("");
  }

  async function saveCourse(event) {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanCode = courseCode(cleanTitle, code, courses);
    if (cleanTitle.length < 2) {
      setError("Use at least 2 characters for the course name.");
      return;
    }
    if (cleanCode.length > 16) {
      setError("Course code must be 16 characters or fewer.");
      return;
    }
    if (courses.some((course) => course.id !== editingCourse?.id && course.code?.toUpperCase() === cleanCode)) {
      setError("That course code is already in use. Choose another code.");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to save this course.");

      const fields = {
        owner_id: authData.user.id,
        name: cleanTitle,
        title: cleanTitle,
        code: cleanCode,
        course_code: cleanCode,
        semester: Number(semesterValue),
        description: description.trim(),
      };

      if (editingCourse) {
        const { data, error: updateError } = await supabase
          .from("courses")
          .update(fields)
          .eq("id", editingCourse.id)
          .eq("owner_id", authData.user.id)
          .select()
          .single();
        if (updateError) throw updateError;
        setCourses((current) => current.map((course) => course.id === data.id ? normalizeCourse({ ...course, ...data }) : course));
        notify?.("Course changes saved.");
      } else {
        const { data, error: insertError } = await supabase
          .from("courses")
          .insert({ ...fields, progress: 0, color: ["purple", "green", "blue", "orange"][courses.length % 4], materials: 0 })
          .select()
          .single();
        if (insertError) throw insertError;
        setCourses((current) => [normalizeCourse(data), ...current]);
        notify?.("Course created.");
      }
      closeForm();
    } catch (saveError) {
      console.error("Course save failed:", saveError);
      setError(saveError.message || "Could not save the course. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDeleteCourse() {
    const course = deleteTarget;
    if (!course || !supabase) return;
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to delete this course.");
      const { error: deleteError, count } = await supabase
        .from("courses")
        .delete({ count: "exact" })
        .eq("id", course.id)
        .eq("owner_id", authData.user.id);
      if (deleteError) throw deleteError;
      if (count === 0) throw new Error("Course was not deleted. It may no longer belong to your account.");
      setCourses((current) => current.filter((item) => item.id !== course.id));
      setMaterials?.((current) => current.map((material) => String(material.courseId || material.course_id || "") === String(course.id)
        ? { ...material, courseId: null, course_id: null }
        : material));
      setTasks?.((current) => current.map((task) => String(task.courseId || "") === String(course.id)
        ? { ...task, courseId: null }
        : task));
      setSelectedCourseId("");
      setDeleteTarget(null);
      notify?.("Course deleted. Its uploaded files and material records are preserved and become unassigned.");
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete the course.");
      setDeleteTarget(null);
    } finally {
      setLoading(false);
    }
  }

  const selectedCourse = courses.find((course) => String(course.id) === String(selectedCourseId));

  if (selectedCourse) {
    const courseMaterials = materials.filter((item) => String(item.courseId || item.course_id || "") === String(selectedCourse.id));
    const linkedTasks = tasks.filter((task) => String(task.courseId || "") === String(selectedCourse.id));
    const completedTasks = linkedTasks.filter((task) => task.completed).length;
    const progress = linkedTasks.length ? Math.round((completedTasks / linkedTasks.length) * 100) : 0;
    return (
      <section className={styles.panel}>
        <div className={styles.detailTop}>
          <button type="button" className={styles.back} onClick={() => setSelectedCourseId("")}><ArrowLeft size={15} /> All courses</button>
          <div className={styles.detailActions}>
            <button type="button" className={styles.secondaryAction} onClick={() => startEdit(selectedCourse)}><Edit3 size={14} /> Edit course</button>
            <button type="button" className={styles.dangerAction} onClick={() => setDeleteTarget(selectedCourse)}><Trash2 size={14} /> Delete</button>
          </div>
        </div>
        <div className={styles.detailHeading}>
          <span className={styles.detailIcon}><BookOpen size={23} /></span>
          <div><p>COURSE DETAILS</p><h2>{selectedCourse.name}</h2><span>{selectedCourse.code || "No course code"} · Semester {selectedCourse.semester}</span></div>
        </div>
        {selectedCourse.description && <p className={styles.detailDescription}>{selectedCourse.description}</p>}
        <div className={styles.detailStats}>
          <div><strong>{courseMaterials.length}</strong><span>Linked materials</span></div>
          <div><strong>{linkedTasks.length}</strong><span>Tasks</span></div>
          <div><strong>{progress}%</strong><span>Task completion</span></div>
        </div>
        <div className={styles.detailSectionHead}>
          <div><h3>Course materials</h3><p>Files linked to this course.</p></div>
          <button type="button" className={styles.primaryAction} onClick={() => onUploadMaterial?.(selectedCourse.id)}><UploadCloud size={14} /> Upload material</button>
        </div>
        {courseMaterials.length ? (
          <div className={styles.materialList}>
            {courseMaterials.map((material) => (
              <div className={styles.materialRow} key={material.id}>
                <FileText size={16} />
                <span>{material.name}<small>{material.type || "File"} · {material.addedAt ? new Date(material.addedAt).toLocaleDateString() : ""}</small></span>
                {material.url && <a href={material.url} target="_blank" rel="noreferrer" aria-label={`Open ${material.name}`}>Open</a>}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={FileText} title="No materials linked yet" description="Upload a file and choose this course to keep its resources together." />
        )}

        {deleteTarget && <div className={styles.confirmBox} role="alertdialog" aria-modal="true" aria-labelledby="delete-course-title">
          <div><h3 id="delete-course-title">Delete {deleteTarget.name}?</h3><p>Course materials and uploaded files will not be deleted. Their course link will be cleared.</p></div>
          <button type="button" className={styles.dangerAction} onClick={confirmDeleteCourse} disabled={loading}>{loading ? "Deleting…" : "Delete course"}</button>
          <button type="button" className={styles.secondaryAction} onClick={() => setDeleteTarget(null)} disabled={loading}>Keep course</button>
        </div>}
        {formOpen && renderCourseForm()}
      </section>
    );
  }

  function renderCourseForm() {
    return (
      <form className={styles.addForm} onSubmit={saveCourse}>
        <div className={styles.formHeading}><h3>{editingCourse ? "Edit course" : "Create a course"}</h3><button type="button" onClick={closeForm} aria-label="Close course form"><X size={16} /></button></div>
        <div className={styles.formGrid}>
          <label>Course name<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Database Management Systems" maxLength={100} required /></label>
          <label>Course code <span>(optional)</span><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Generated from course name when blank" maxLength={16} /></label>
          <label>Semester<select value={semesterValue} onChange={(event) => setSemesterValue(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>Semester {index + 1}</option>)}</select></label>
          <label className={styles.descriptionField}>Description <span>(optional)</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What will you study in this course?" maxLength={500} rows={3} /></label>
        </div>
        {error && <p className={styles.formError} role="alert">{error}</p>}
        <div className={styles.formActions}><button className={styles.primaryAction} type="submit" disabled={loading}>{loading ? "Saving…" : editingCourse ? "Save changes" : "Create course"}</button><button className={styles.secondaryAction} type="button" onClick={closeForm} disabled={loading}>Cancel</button></div>
      </form>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div><h2>{compact ? "My courses" : "Course library"}</h2><p>{compact ? "Your subjects at a glance" : "Create, organize, and manage your subjects."}</p></div>
        <div className={styles.controls}>
          {!compact && <select value={semester} onChange={(event) => setSemester(event.target.value)} aria-label="Filter courses by semester"><option value="all">All semesters</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Semester {index + 1}</option>)}</select>}
          <button type="button" onClick={formOpen ? closeForm : startCreate} className={styles.add}><Plus size={15} /><span>{formOpen ? "Close" : "Add course"}</span></button>
          {compact && <button type="button" className={styles.viewAll} onClick={onViewAll}>View all</button>}
          {!compact && <button type="button" className={styles.refresh} onClick={() => setRefreshVersion((value) => value + 1)} disabled={loading} aria-label="Refresh courses"><RotateCw size={15} /></button>}
        </div>
      </div>

      {formOpen && renderCourseForm()}
      {loading && <div className={styles.loading} role="status">Loading your courses…</div>}
      {error && !formOpen && <div className={styles.loadError} role="alert"><span>{error}</span><button type="button" onClick={() => setRefreshVersion((value) => value + 1)}>Retry</button></div>}

      {loading && <div className={styles.skeletonGrid} aria-hidden="true">{[0, 1, 2].map((item) => <div className={styles.skeletonCourse} key={item}><i /><i /><i /></div>)}</div>}
      <div className={styles.grid}>
        {visible.slice(0, compact ? 4 : undefined).map((course) => {
          const courseMaterials = materials.filter((item) => String(item.courseId || item.course_id || "") === String(course.id)).length;
          const courseTasks = tasks.filter((task) => String(task.courseId || "") === String(course.id));
          const progress = courseTasks.length ? Math.round(courseTasks.filter((task) => task.completed).length / courseTasks.length * 100) : 0;
          return <CourseCard key={course.id} course={{ ...course, materials: courseMaterials, progress, progressTasks: courseTasks.length }} onOpen={() => onOpenCourse ? onOpenCourse(course.id) : setSelectedCourseId(course.id)} onDelete={setDeleteTarget} />;
        })}
      </div>
      {!loading && !error && !visible.length && <EmptyState icon={BookOpen} title={query ? "No matching courses" : "No courses yet"} description={query ? "Try another search." : "Create your first course to organize materials, assignments, and progress."} />}
      {deleteTarget && <div className={styles.confirmBox} role="alertdialog" aria-modal="true" aria-labelledby="delete-course-title"><div><h3 id="delete-course-title">Delete {deleteTarget.name}?</h3><p>Uploaded files and material records stay in your account. Their course link will be cleared.</p></div><button type="button" className={styles.dangerAction} onClick={confirmDeleteCourse} disabled={loading}>{loading ? "Deleting…" : "Delete course"}</button><button type="button" className={styles.secondaryAction} onClick={() => setDeleteTarget(null)} disabled={loading}>Cancel</button></div>}
    </section>
  );
}
