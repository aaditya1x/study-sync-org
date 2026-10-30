import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Edit3, Plus, Trash2, X, UploadCloud, FileText, RotateCw } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { CourseCard } from "../CourseCard/index.js";
import { ChapterTracker } from "../ChapterTracker/index.js";
import { EmptyState } from "../EmptyState/index.js";
import styles from "./CourseLibrary.module.css";

const COURSE_SELECT_COLUMNS = "id, owner_id, name, title, code, course_code, semester, description, color, created_at, branch_id, academic_cycle_id, year_level";

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

function organizeChapters(chapters, topics) {
  const topicsByChapter = new Map();
  topics.forEach((topic) => {
    const current = topicsByChapter.get(topic.chapter_id) || [];
    current.push(topic);
    topicsByChapter.set(topic.chapter_id, current);
  });
  return chapters.map((chapter) => ({
    ...chapter,
    topics: (topicsByChapter.get(chapter.id) || []).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at)),
  })).sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
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
  onChapterProgressChange,
  academicProfile = {},
  academicCatalog = { branches: [], cycles: [] },
}) {
  const [semester, setSemester] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [cycleFilter, setCycleFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
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
  const [currentUserId, setCurrentUserId] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [chapters, setChapters] = useState([]);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterError, setChapterError] = useState("");

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
      setCurrentUserId(authData.user.id);

      const { data, error: queryError } = await supabase
        .from("courses")
        .select(COURSE_SELECT_COLUMNS)
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      setCourses((data || []).map(normalizeCourse));
      setChapterLoading(true);
      setChapterError("");
      try {
        const { data: chapterRows, error: chapterQueryError } = await supabase
          .from("course_chapters")
          .select("id, course_id, title, position, created_at")
          .eq("user_id", authData.user.id)
          .order("position", { ascending: true });
        if (chapterQueryError) throw chapterQueryError;
        const { data: topicRows, error: topicQueryError } = await supabase
          .from("course_topics")
          .select("id, chapter_id, title, position, is_completed, completed_at, created_at")
          .eq("user_id", authData.user.id)
          .order("position", { ascending: true });
        if (topicQueryError) throw topicQueryError;
        setChapters(organizeChapters(chapterRows || [], topicRows || []));
      } catch (chapterLoadError) {
        console.error("Chapter progress loading failed:", chapterLoadError);
        setChapters([]);
        setChapterError("Chapter tracking is unavailable until its database migration is applied.");
      } finally {
        setChapterLoading(false);
      }
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

  const chapterProgressByCourse = useMemo(() => chapters.reduce((result, chapter) => {
    const current = result[chapter.course_id] || { completed: 0, total: 0 };
    const total = chapter.topics.length;
    current.total += total;
    current.completed += chapter.topics.filter((topic) => topic.is_completed).length;
    result[chapter.course_id] = current;
    return result;
  }, {}), [chapters]);

  useEffect(() => {
    onChapterProgressChange?.(chapterProgressByCourse);
  }, [chapterProgressByCourse, onChapterProgressChange]);

  async function mutateChapterProgress(action) {
    if (!supabase) {
      setChapterError("Supabase is not configured.");
      return null;
    }
    setChapterLoading(true);
    setChapterError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to update chapter progress.");
      return await action(authData.user.id);
    } catch (mutationError) {
      console.error("Chapter progress update failed:", mutationError);
      setChapterError(mutationError.message || "Could not save chapter progress.");
      return null;
    } finally {
      setChapterLoading(false);
    }
  }

  function createChapter(chapterTitle) {
    return mutateChapterProgress(async (userId) => {
      const { data, error: insertError } = await supabase.from("course_chapters")
        .insert({ course_id: selectedCourseId, user_id: userId, title: chapterTitle, position: chapters.filter((chapter) => String(chapter.course_id) === String(selectedCourseId)).length })
        .select("id, course_id, title, position, created_at").single();
      if (insertError) throw insertError;
      setChapters((current) => [...current, { ...data, topics: [] }]);
      notify?.("Chapter added.");
      return data;
    });
  }

  function updateChapter(chapterId, chapterTitle) {
    return mutateChapterProgress(async (userId) => {
      const { data, error: updateError } = await supabase.from("course_chapters").update({ title: chapterTitle, updated_at: new Date().toISOString() })
        .eq("id", chapterId).eq("user_id", userId).select("id, title").single();
      if (updateError) throw updateError;
      setChapters((current) => current.map((chapter) => chapter.id === data.id ? { ...chapter, title: data.title } : chapter));
      notify?.("Chapter updated.");
      return data;
    });
  }

  function deleteChapter(chapter) {
    return mutateChapterProgress(async (userId) => {
      const { error: deleteError } = await supabase.from("course_chapters").delete().eq("id", chapter.id).eq("user_id", userId);
      if (deleteError) throw deleteError;
      setChapters((current) => current.filter((item) => item.id !== chapter.id));
      notify?.("Chapter and its topics deleted.");
    });
  }

  function createTopic(chapterId, topicTitle) {
    return mutateChapterProgress(async (userId) => {
      const chapter = chapters.find((item) => item.id === chapterId);
      const { data, error: insertError } = await supabase.from("course_topics")
        .insert({ chapter_id: chapterId, user_id: userId, title: topicTitle, position: chapter?.topics.length || 0 })
        .select("id, chapter_id, title, position, is_completed, completed_at, created_at").single();
      if (insertError) throw insertError;
      setChapters((current) => current.map((item) => item.id === chapterId ? { ...item, topics: [...item.topics, data] } : item));
      notify?.("Topic added.");
      return data;
    });
  }

  function updateTopic(topicId, topicTitle) {
    return mutateChapterProgress(async (userId) => {
      const { data, error: updateError } = await supabase.from("course_topics").update({ title: topicTitle, updated_at: new Date().toISOString() })
        .eq("id", topicId).eq("user_id", userId).select("id, title").single();
      if (updateError) throw updateError;
      setChapters((current) => current.map((chapter) => ({ ...chapter, topics: chapter.topics.map((topic) => topic.id === data.id ? { ...topic, title: data.title } : topic) })));
      notify?.("Topic updated.");
      return data;
    });
  }

  function deleteTopic(topic) {
    return mutateChapterProgress(async (userId) => {
      const { error: deleteError } = await supabase.from("course_topics").delete().eq("id", topic.id).eq("user_id", userId);
      if (deleteError) throw deleteError;
      setChapters((current) => current.map((chapter) => ({ ...chapter, topics: chapter.topics.filter((item) => item.id !== topic.id) })));
      notify?.("Topic deleted.");
    });
  }

  function toggleTopic(topic) {
    return mutateChapterProgress(async (userId) => {
      const isCompleted = !topic.is_completed;
      const { data, error: updateError } = await supabase.from("course_topics")
        .update({ is_completed: isCompleted, completed_at: isCompleted ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
        .eq("id", topic.id).eq("user_id", userId).select("id, is_completed, completed_at").single();
      if (updateError) throw updateError;
      setChapters((current) => current.map((chapter) => ({ ...chapter, topics: chapter.topics.map((item) => item.id === data.id ? { ...item, ...data } : item) })));
      return data;
    });
  }

  const visible = useMemo(() => courses.filter((course) =>
    (semester === "all" || String(course.semester) === semester)
    && (branchFilter === "all" || String(course.branch_id || "") === branchFilter)
    && (cycleFilter === "all" || String(course.academic_cycle_id || "") === cycleFilter)
    && (yearFilter === "all" || String(course.year_level || "") === yearFilter)
    && `${course.name} ${course.code} ${course.description || ""}`.toLowerCase().includes(query.toLowerCase())
  ), [courses, semester, branchFilter, cycleFilter, yearFilter, query]);

  function startCreate() {
    setEditingCourse(null);
    setTitle("");
    setCode("");
    setDescription("");
    setSemesterValue(academicProfile.semester || "1");
    setError("");
    setFormOpen(true);
  }

  function startEdit(course) {
    if (course.owner_id !== currentUserId) return;
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
    const ownCourses = courses.filter((course) => course.owner_id === currentUserId);
    const cleanCode = courseCode(cleanTitle, code, ownCourses);
    if (cleanTitle.length < 2) {
      setError("Use at least 2 characters for the course name.");
      return;
    }
    if (cleanCode.length > 16) {
      setError("Course code must be 16 characters or fewer.");
      return;
    }
    if (ownCourses.some((course) => course.id !== editingCourse?.id && course.code?.toUpperCase() === cleanCode)) {
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
      if (editingCourse && editingCourse.owner_id !== authData.user.id) {
        throw new Error("Only the course owner can edit this course.");
      }

      const fields = {
        owner_id: authData.user.id,
        name: cleanTitle,
        title: cleanTitle,
        code: cleanCode,
        course_code: cleanCode,
        semester: Number(semesterValue),
        branch_id: academicProfile.branch_id || null,
        academic_cycle_id: academicProfile.academic_cycle_id || null,
        year_level: academicProfile.year_level ? Number(academicProfile.year_level) : null,
        description: description.trim(),
      };

      if (editingCourse) {
        const { data, error: updateError } = await supabase
          .from("courses")
          .update(fields)
          .eq("id", editingCourse.id)
          .eq("owner_id", authData.user.id)
          .select(COURSE_SELECT_COLUMNS)
          .single();
        if (updateError) throw updateError;
        setCourses((current) => current.map((course) => course.id === data.id ? normalizeCourse({ ...course, ...data }) : course));
        notify?.("Course changes saved.");
      } else {
        const { data, error: insertError } = await supabase
          .from("courses")
          .insert({ ...fields, progress: 0, color: ["purple", "green", "blue", "orange"][courses.length % 4], materials: 0 })
          .select(COURSE_SELECT_COLUMNS)
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
      if (course.owner_id !== authData.user.id) throw new Error("Only the course owner can delete this course.");
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
          {selectedCourse.owner_id === currentUserId && <div className={styles.detailActions}>
            <button type="button" className={styles.secondaryAction} onClick={() => startEdit(selectedCourse)}><Edit3 size={14} /> Edit course</button>
            <button type="button" className={styles.dangerAction} onClick={() => setDeleteTarget(selectedCourse)}><Trash2 size={14} /> Delete</button>
          </div>}
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
        <ChapterTracker
          chapters={chapters.filter((chapter) => String(chapter.course_id) === String(selectedCourse.id))}
          loading={chapterLoading}
          error={chapterError}
          onCreateChapter={createChapter}
          onUpdateChapter={updateChapter}
          onDeleteChapter={deleteChapter}
          onCreateTopic={createTopic}
          onUpdateTopic={updateTopic}
          onDeleteTopic={deleteTopic}
          onToggleTopic={toggleTopic}
        />
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
        <div className={styles.formHeading}><h3>{editingCourse ? "Edit subject" : "Add a subject"}</h3><button type="button" onClick={closeForm} aria-label="Close course form"><X size={16} /></button></div>
        <p className={styles.academicNote}>{academicProfile.branch_id ? "This subject will be categorized under your saved degree, branch, academic year and year." : "Set your academic allocation above to categorize this subject by branch and year."}</p>
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
        <div><h2>{compact ? "College courses" : "Course library"}</h2><p>{compact ? "Browse shared subjects and semesters" : "Browse college subjects; create and manage your own courses."}</p></div>
        <div className={styles.controls}>
          {!compact && <>
            <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} aria-label="Filter by branch"><option value="all">All branches</option>{academicCatalog.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <select value={cycleFilter} onChange={(event) => setCycleFilter(event.target.value)} aria-label="Filter by academic year"><option value="all">All academic years</option>{academicCatalog.cycles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
            <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} aria-label="Filter by year"><option value="all">All years</option>{Array.from({ length: 6 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Year {index + 1}</option>)}</select>
            <select value={semester} onChange={(event) => setSemester(event.target.value)} aria-label="Filter by semester"><option value="all">All semesters</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Semester {index + 1}</option>)}</select>
          </>}
          <button type="button" onClick={formOpen ? closeForm : startCreate} className={styles.add}><Plus size={15} /><span>{formOpen ? "Close" : "Add subject"}</span></button>
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
          const branchName = academicCatalog.branches.find((item) => item.id === course.branch_id)?.name;
          const cycleLabel = academicCatalog.cycles.find((item) => item.id === course.academic_cycle_id)?.label;
          return <CourseCard key={course.id} course={{ ...course, branchName, cycleLabel, materials: courseMaterials, progress, progressTasks: courseTasks.length, chapterProgress: chapterProgressByCourse[course.id] || { completed: 0, total: 0 } }} canManage={course.owner_id === currentUserId} onOpen={() => onOpenCourse ? onOpenCourse(course.id) : setSelectedCourseId(course.id)} onDelete={setDeleteTarget} />;
        })}
      </div>
      {!loading && !error && !visible.length && <EmptyState icon={BookOpen} title={query ? "No matching courses" : "No courses yet"} description={query ? "Try another search." : "Create your first course to organize materials, assignments, and progress."} />}
      {deleteTarget && <div className={styles.confirmBox} role="alertdialog" aria-modal="true" aria-labelledby="delete-course-title"><div><h3 id="delete-course-title">Delete {deleteTarget.name}?</h3><p>Uploaded files and material records stay in your account. Their course link will be cleared.</p></div><button type="button" className={styles.dangerAction} onClick={confirmDeleteCourse} disabled={loading}>{loading ? "Deleting…" : "Delete course"}</button><button type="button" className={styles.secondaryAction} onClick={() => setDeleteTarget(null)} disabled={loading}>Cancel</button></div>}
    </section>
  );
}
