import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, UploadCloud, Trash2, File, Download, LoaderCircle, Search,
  X, Eye, RotateCw, FolderOpen, AlertCircle, Share2,
} from "lucide-react";
import { EmptyState } from "../EmptyState/index.js";
import styles from "./MaterialsPanel.module.css";
import { supabase, isSupabaseConfigured, STORAGE_BUCKETS } from "../../lib/supabase.js";

const BUCKET = STORAGE_BUCKETS.materials;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(["pdf", "doc", "docx", "ppt", "pptx", "txt", "jpg", "jpeg", "png", "webp", "gif", "xlsx", "csv"]);

function storageErrorMessage(error) {
  if (/bucket not found/i.test(error?.message || "")) {
    return `Storage bucket "${BUCKET}" is missing. Review and manually run the existing-project repair migration.`;
  }
  if (error?.code === "42501" || /row-level security|permission denied/i.test(error?.message || "")) {
    return "Supabase denied this action. Check that you are signed in and that the owner-folder Storage policy is installed.";
  }
  return error?.message || "Storage request failed.";
}

function fileExtension(fileOrName) {
  const name = typeof fileOrName === "string" ? fileOrName : fileOrName?.name || "";
  return name.split(".").pop()?.toLowerCase() || "";
}

function formatSize(bytes = 0) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function materialType(item) {
  return (item.type || fileExtension(item.name) || "file").toUpperCase();
}

function mapMaterial(item, signedUrl = "", storageError = "") {
  return {
    id: item.storage_path,
    name: item.name,
    subject: item.subject || "",
    size: Number(item.size) || 0,
    type: item.type || fileExtension(item.name).toUpperCase(),
    addedAt: item.created_at,
    isIndexed: Boolean(item.is_indexed),
    isShared: item.is_shared === true,
    indexError: "",
    url: signedUrl,
    path: item.storage_path,
    courseId: item.course_id || null,
    storageError,
  };
}

function selectedCourseId(item) {
  return item.courseId || item.course_id || "";
}

function makeCourseCode(title, existingCourses) {
  const base = title.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 10) || "COURSE";
  let code = base;
  let suffix = 2;
  while (existingCourses.some((course) => (course.code || course.course_code)?.toUpperCase() === code)) {
    code = `${base.slice(0, 7)}${suffix++}`;
  }
  return code;
}

export default function MaterialsPanel({
  materials = [],
  setMaterials,
  courses = [],
  setCourses,
  notify,
  compact = false,
  query = "",
  onQueryChange,
  initialCourseId = "",
  autoOpenUpload = false,
  onUploadFormOpened,
  onLoadStatusChange,
  onOpenCourses,
}) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [uploadId, setUploadId] = useState("");
  const [courseId, setCourseId] = useState(initialCourseId || "");
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadAttempt, setUploadAttempt] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseCode, setNewCourseCode] = useState("");
  const [courseCreateError, setCourseCreateError] = useState("");
  const [courseCreating, setCourseCreating] = useState(false);
  const [filterCourse, setFilterCourse] = useState(initialCourseId || "all");
  const [filterType, setFilterType] = useState("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [groupByCourse, setGroupByCourse] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const [indexingPaths, setIndexingPaths] = useState(() => new Set());
  const [sharingPaths, setSharingPaths] = useState(() => new Set());

  useEffect(() => {
    if (!selectedMaterial && !deleteTarget) return undefined;
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector("button, a[href]")?.focus();
    function handleDialogKeys(event) {
      if (event.key === "Escape") {
        setSelectedMaterial(null);
        setDeleteTarget(null);
      }
      if (event.key === "Tab" && dialogRef.current) {
        const elements = [...dialogRef.current.querySelectorAll('button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])')];
        if (!elements.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener("keydown", handleDialogKeys);
    return () => {
      window.removeEventListener("keydown", handleDialogKeys);
      previousFocus?.focus?.();
    };
  }, [selectedMaterial, deleteTarget]);

  useEffect(() => {
    if (initialCourseId) {
      setCourseId(initialCourseId);
      setFilterCourse(initialCourseId);
    }
  }, [initialCourseId]);

  useEffect(() => {
    if (!autoOpenUpload || compact) return;
    setUploadOpen(true);
    setUploadError("");
    onUploadFormOpened?.();
  }, [autoOpenUpload, compact, onUploadFormOpened]);

  const loadMaterials = useCallback(async (isActive = () => true) => {
    if (!isSupabaseConfigured || !supabase) {
      if (isActive()) {
        setLoadError("Supabase is not configured. Check the VITE_SUPABASE_URL and publishable key.");
        onLoadStatusChange?.("error");
      }
      return;
    }

    if (isActive()) {
      setLoading(true);
      setLoadError("");
      onLoadStatusChange?.("loading");
    }
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to load your materials.");

      const { data, error } = await supabase
        .from("study_materials")
        .select("*")
        .eq("user_id", authData.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!isActive()) return;

      const loaded = await Promise.all((data || []).map(async (item) => {
        try {
          const { data: signed, error: signedError } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(item.storage_path, 3600);
          if (signedError) return mapMaterial(item, "", storageErrorMessage(signedError));
          return mapMaterial(item, signed.signedUrl);
        } catch (error) {
          return mapMaterial(item, "", storageErrorMessage(error));
        }
      }));
      if (!isActive()) return;
      setMaterials(loaded);
      const linkFailure = loaded.find((item) => item.storageError);
      if (linkFailure) setLoadError(`Some private download links could not be created: ${linkFailure.storageError}`);
      onLoadStatusChange?.("loaded");
    } catch (error) {
      if (!isActive()) return;
      console.error("Study materials loading failed:", error);
      const message = storageErrorMessage(error);
      setLoadError(message);
      onLoadStatusChange?.("error");
    } finally {
      if (isActive()) setLoading(false);
    }
  }, [setMaterials, onLoadStatusChange]);

  useEffect(() => {
    let active = true;
    loadMaterials(() => active);
    return () => { active = false; };
  }, [loadMaterials, retryVersion]);

  const availableTypes = useMemo(() => [...new Set(materials.map((item) => materialType(item)))].sort(), [materials]);
  const courseNames = useMemo(() => new Map(courses.map((course) => [String(course.id), course.name || course.title || "Course"])), [courses]);
  const filteredMaterials = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return materials
      .filter((item) => filterCourse === "all"
        || (filterCourse === "unassigned" ? !selectedCourseId(item) : String(selectedCourseId(item)) === String(filterCourse)))
      .filter((item) => filterType === "all" || materialType(item) === filterType)
      .filter((item) => !normalizedQuery || `${item.name} ${item.subject || ""} ${courseNames.get(String(selectedCourseId(item))) || ""} ${materialType(item)}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        if (sortOrder === "filename") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        const delta = new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime();
        return sortOrder === "oldest" ? delta : -delta;
      });
  }, [materials, filterCourse, filterType, query, courseNames, sortOrder]);

  const groupedMaterials = useMemo(() => {
    if (!groupByCourse) return [["all", filteredMaterials]];
    const groups = new Map();
    for (const item of filteredMaterials) {
      const id = selectedCourseId(item) || "unassigned";
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(item);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      const nameA = a === "unassigned" ? "Unassigned" : courseNames.get(String(a)) || "Course";
      const nameB = b === "unassigned" ? "Unassigned" : courseNames.get(String(b)) || "Course";
      return nameA.localeCompare(nameB);
    });
  }, [filteredMaterials, groupByCourse, courseNames]);

  function chooseFile(nextFile) {
    if (!nextFile) return;
    const extension = fileExtension(nextFile);
    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      setUploadError("This file type is not supported. Choose a PDF, Office document, text file, image, spreadsheet, or CSV.");
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setUploadError("Files must be 50 MB or smaller.");
      return;
    }
    setFile(nextFile);
    setUploadId(crypto.randomUUID());
    setUploadAttempt(0);
    setUploadError("");
  }

  function resetUpload() {
    if (uploading) return;
    setUploadOpen(false);
    setFile(null);
    setUploadId("");
    setUploadError("");
    setCreatingCourse(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function createCourseForUpload(event) {
    event?.preventDefault?.();
    const name = newCourseName.trim();
    if (name.length < 2) {
      setCourseCreateError("Enter a course name with at least 2 characters.");
      return;
    }
    if (!supabase) {
      setCourseCreateError("Supabase is not configured.");
      return;
    }
    setCourseCreating(true);
    setCourseCreateError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to create a course.");
      const code = newCourseCode.trim().toUpperCase() || makeCourseCode(name, courses);
      if (courses.some((course) => (course.code || course.course_code)?.toUpperCase() === code)) {
        throw new Error("That course code is already in use.");
      }
      const { data, error } = await supabase.from("courses").insert({
        owner_id: authData.user.id,
        name,
        title: name,
        code,
        course_code: code,
        semester: 1,
        description: "",
        progress: 0,
        color: "purple",
        materials: 0,
      }).select().single();
      if (error) throw error;
      const next = { ...data, name: data.name || data.title, code: data.code || data.course_code };
      setCourses?.((current) => [next, ...current]);
      setCourseId(next.id);
      setFilterCourse(String(next.id));
      setNewCourseName("");
      setNewCourseCode("");
      setCreatingCourse(false);
      notify("Course created. Your selected file is ready to upload.");
    } catch (error) {
      setCourseCreateError(error.message || "Could not create the course.");
    } finally {
      setCourseCreating(false);
    }
  }

  async function uploadMaterial(event) {
    event.preventDefault();
    if (!file) {
      setUploadError("Choose a file first.");
      return;
    }
    if (!courseId || !courses.some((course) => String(course.id) === String(courseId))) {
      setUploadError("Choose one of your courses before uploading this material.");
      return;
    }
    if (!supabase || !isSupabaseConfigured) {
      setUploadError("Supabase is not configured. Check your environment variables.");
      return;
    }

    setUploading(true);
    setUploadError("");
    setUploadAttempt((attempt) => attempt + 1);
    setUploadStage("Checking your account…");
    let uploadedPath = "";
    let uploadedByThisAttempt = false;
    let metadataSaved = false;
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Please sign in again before uploading.");

      const path = `${authData.user.id}/${uploadId}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      uploadedPath = path;
      const { data: existing, error: existingError } = await supabase
        .from("study_materials")
        .select("storage_path, course_id, name, subject, size, type, created_at, is_indexed, is_shared")
        .eq("user_id", authData.user.id)
        .eq("storage_path", path)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        if (String(existing.course_id || "") !== String(courseId)) {
          const { error: associationError } = await supabase.from("study_materials")
            .update({ course_id: courseId })
            .eq("user_id", authData.user.id)
            .eq("storage_path", path);
          if (associationError) throw associationError;
        }
      } else {
        setUploadStage("Uploading file to your private library…");
        const { data: uploaded, error: storageError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: true });
        if (storageError) throw new Error(storageErrorMessage(storageError));
        uploadedPath = uploaded.path;
        uploadedByThisAttempt = true;

        setUploadStage("Saving course and file details…");
        const { error: insertError } = await supabase.from("study_materials").insert({
          user_id: authData.user.id,
          name: file.name,
          subject: courseNames.get(String(courseId)) || "",
          size: file.size,
          type: fileExtension(file).toUpperCase(),
          storage_path: uploaded.path,
          course_id: courseId,
        });
        if (insertError) throw insertError;
        metadataSaved = true;
      }

      setUploadStage("Creating a private download link…");
      const { data: signed, error: signedError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(uploadedPath, 3600);
      if (signedError) throw new Error(storageErrorMessage(signedError));

      const now = new Date().toISOString();
      const mapped = existing
        ? mapMaterial({ ...existing, course_id: courseId }, signed.signedUrl)
        : mapMaterial({
          storage_path: uploadedPath,
          name: file.name,
          subject: courseNames.get(String(courseId)) || "",
          size: file.size,
          type: fileExtension(file).toUpperCase(),
          created_at: now,
          is_indexed: false,
          course_id: courseId,
        }, signed.signedUrl);

      setMaterials((current) => [mapped, ...current.filter((item) => item.path !== mapped.path)]);
      setUploadError("");
      notify(`${file.name} uploaded to ${courseNames.get(String(courseId)) || "your course"}.`);
      setUploadOpen(false);
      setFile(null);
      setUploadId("");

      if (fileExtension(file) === "pdf") {
        await indexMaterial(mapped);
      }
    } catch (error) {
      console.error("Material upload failed:", error);
      let message = error.message || "Upload failed. Try again.";
      if (/course_id|column .* does not exist|schema cache/i.test(message)) {
        message = "Your database does not have the course_id relationship yet. Review and manually run supabase-migrations/20261029_material_course_relationship.sql, then retry.";
      }
      if (uploadedByThisAttempt && !metadataSaved && uploadedPath) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([uploadedPath]);
        if (cleanupError) {
          console.error("Could not clean up this exact failed upload:", cleanupError);
          message += " Cleanup also failed; the uploaded object is retained at its own user-folder path for safe retry.";
        }
      }
      setUploadError(message);
      setUploadStage("");
    } finally {
      setUploading(false);
    }
  }

  async function indexMaterial(material) {
    if (indexingPaths.has(material.path)) return;
    setIndexingPaths((old) => new Set(old).add(material.path));
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) throw new Error("Please sign in again before indexing this PDF.");
      const response = await fetch("/api/index-book", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session.access_token}` },
        body: JSON.stringify({ storage_path: material.path }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Indexing failed (${response.status}).`);
      setMaterials((current) => current.map((item) => item.path === material.path ? { ...item, isIndexed: true, indexError: "" } : item));
      notify(`${material.name} indexed for AI study.`);
    } catch (error) {
      setMaterials((current) => current.map((item) => item.path === material.path ? { ...item, isIndexed: false, indexError: error.message } : item));
      notify(`${material.name} could not be indexed: ${error.message}`);
    } finally {
      setIndexingPaths((current) => {
        const next = new Set(current);
        next.delete(material.path);
        return next;
      });
    }
  }

  async function deleteMaterial() {
    if (!deleteTarget || !supabase) return;
    setDeleteBusy(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to remove this material.");
      const { error: rowError } = await supabase.from("study_materials")
        .delete().eq("storage_path", deleteTarget.path).eq("user_id", authData.user.id);
      if (rowError) throw rowError;
      setMaterials((current) => current.filter((item) => item.path !== deleteTarget.path));
      setSelectedMaterial((current) => current?.path === deleteTarget.path ? null : current);
      const { error: fileError } = await supabase.storage.from(BUCKET).remove([deleteTarget.path]);
      if (fileError) {
        notify(`Material record removed, but its file cleanup failed: ${storageErrorMessage(fileError)}`);
      } else {
        notify("Material and its file were removed.");
      }
      setDeleteTarget(null);
    } catch (error) {
      notify(`Could not remove material: ${storageErrorMessage(error)}`);
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function toggleSharedMaterial(material) {
    if (!supabase || sharingPaths.has(material.path)) return;
    setSharingPaths((current) => new Set(current).add(material.path));
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!authData.user) throw new Error("Sign in again to change sharing.");
      const nextShared = !material.isShared;
      const { error } = await supabase.from("study_materials")
        .update({ is_shared: nextShared })
        .eq("user_id", authData.user.id)
        .eq("storage_path", material.path);
      if (error) throw error;
      setMaterials((current) => current.map((item) => item.path === material.path ? { ...item, isShared: nextShared } : item));
      notify(nextShared
        ? "Indexed PDF text is now visible to signed-in students. The file itself remains private."
        : "PDF sharing turned off.");
    } catch (error) {
      console.error("Could not update PDF sharing:", error);
      notify(/is_shared|column .* does not exist|schema cache/i.test(error.message || "")
        ? "Run the reviewed course relationship migration before changing PDF sharing."
        : `Could not update sharing: ${storageErrorMessage(error)}`);
    } finally {
      setSharingPaths((current) => {
        const next = new Set(current);
        next.delete(material.path);
        return next;
      });
    }
  }

  const list = compact ? [...materials].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0)).slice(0, 3) : filteredMaterials;

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div><h2>{compact ? "Recent materials" : "Study materials"}</h2><p>{compact ? "Recently uploaded course resources" : "Find, organize, and open your course files."}</p></div>
        <div className={styles.headerActions}>
          {compact && <span className={styles.count}>{materials.length} files</span>}
          {!compact && <button type="button" className={styles.refresh} onClick={() => setRetryVersion((value) => value + 1)} disabled={loading} aria-label="Refresh materials"><RotateCw size={15} /></button>}
          {!compact && <button type="button" className={styles.uploadButton} onClick={() => { setUploadOpen((open) => !open); setUploadError(""); }}><UploadCloud size={15} /> {uploadOpen ? "Close upload" : "Upload material"}</button>}
        </div>
      </div>

      {loading && <div className={styles.loadingState} role="status"><LoaderCircle size={17} /> Loading your materials…</div>}
      {loadError && <div className={styles.errorBanner} role="alert"><AlertCircle size={16} /><span>{loadError}</span><button type="button" onClick={() => setRetryVersion((value) => value + 1)}>Retry</button></div>}

      {uploadOpen && !compact && (
        <form className={styles.uploadForm} onSubmit={uploadMaterial}>
          <div className={styles.uploadFormHeader}><div><h3>Upload to a course</h3><p>Your file stays private and is linked to the course you select.</p></div><button type="button" onClick={resetUpload} disabled={uploading} aria-label="Cancel upload"><X size={17} /></button></div>

          <div
            className={`${styles.dropZone} ${dragActive ? styles.dropActive : ""} ${file ? styles.dropHasFile : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => !uploading && inputRef.current?.click()}
            onKeyDown={(event) => { if (!uploading && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); inputRef.current?.click(); } }}
            onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragActive(false); }}
            onDrop={(event) => { event.preventDefault(); setDragActive(false); chooseFile(event.dataTransfer.files?.[0]); }}
          >
            <input ref={inputRef} type="file" hidden accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.gif,.xlsx,.csv" onChange={(event) => chooseFile(event.target.files?.[0])} disabled={uploading} />
            <span className={styles.dropIcon}><UploadCloud size={21} /></span>
            {file ? <><strong>{file.name}</strong><span>{formatSize(file.size)} · {fileExtension(file).toUpperCase()}</span></> : <><strong>Drop a file here or browse</strong><span>PDF, DOCX, PPTX, images, text, spreadsheets · max 50 MB</span></>}
          </div>

          <div className={styles.uploadFields}>
            <label>Course <span className={styles.required}>Required</span>
              <select value={courseId} onChange={(event) => { setCourseId(event.target.value); setUploadError(""); }} disabled={uploading || !courses.length} required>
                <option value="">Select a course</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name || course.title}{course.code ? ` · ${course.code}` : ""}</option>)}
              </select>
            </label>
            <p className={styles.fieldHint}>Topic field is not available in the current material schema, so it is not collected or saved.</p>
          </div>

          {!courses.length && (
            <div className={styles.noCourses}>
              <FolderOpen size={18} /><div><strong>Create a course first</strong><span>Your selected file will stay in this form.</span></div>
              {!creatingCourse && <button type="button" onClick={() => setCreatingCourse(true)}>Create course</button>}
            </div>
          )}

          {creatingCourse && (
          <div className={styles.quickCourse}>
              <strong>New course</strong>
              <input value={newCourseName} onChange={(event) => setNewCourseName(event.target.value)} placeholder="Course name" maxLength={100} required />
              <input value={newCourseCode} onChange={(event) => setNewCourseCode(event.target.value)} placeholder="Course code (optional)" maxLength={16} />
              {courseCreateError && <p role="alert">{courseCreateError}</p>}
            <div><button type="button" onClick={() => createCourseForUpload()} disabled={courseCreating || !newCourseName.trim()}>{courseCreating ? "Creating…" : "Create course"}</button><button type="button" onClick={() => setCreatingCourse(false)} disabled={courseCreating}>Cancel</button></div>
          </div>
          )}

          {uploading && <div className={styles.progressState} role="status"><LoaderCircle size={16} /><div><strong>{uploadStage}</strong><div className={styles.progressTrack}><span /></div></div></div>}
          {uploadError && <div className={styles.uploadError} role="alert"><AlertCircle size={15} /><span>{uploadError}</span></div>}
          <div className={styles.formActions}>
            <button className={styles.submitUpload} type="submit" disabled={uploading || !file || !courseId || !courses.length}>{uploading ? "Uploading…" : uploadAttempt ? "Retry upload" : "Upload material"}</button>
            <button className={styles.cancelUpload} type="button" onClick={resetUpload} disabled={uploading}>Cancel</button>
          </div>
        </form>
      )}

      {!compact && (
        <div className={styles.filters}>
          <label className={styles.search}><Search size={15} /><input value={query} onChange={(event) => onQueryChange?.(event.target.value)} placeholder="Search filename, course, or file type" aria-label="Search materials" /></label>
          <select value={filterCourse} onChange={(event) => setFilterCourse(event.target.value)} aria-label="Filter materials by course"><option value="all">All courses</option><option value="unassigned">Unassigned</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name || course.title}</option>)}</select>
          <select value={filterType} onChange={(event) => setFilterType(event.target.value)} aria-label="Filter materials by file type"><option value="all">All file types</option>{availableTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
          <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Sort materials"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="filename">Filename A–Z</option></select>
          <label className={styles.groupToggle}><input type="checkbox" checked={groupByCourse} onChange={(event) => setGroupByCourse(event.target.checked)} /> Group by course</label>
        </div>
      )}

      {!compact && filteredMaterials.length > 0 && <p className={styles.resultCount}>Showing {filteredMaterials.length} of {materials.length} materials</p>}

      {loading && <div className={styles.materialSkeletons} aria-hidden="true">{[0, 1, 2].map((item) => <div className={styles.materialSkeleton} key={item}><i /><span><i /><i /></span></div>)}</div>}
      <div className={styles.groups}>
        {(!compact && groupByCourse ? groupedMaterials : [["all", list]]).map(([groupId, groupItems]) => {
          const groupName = groupId === "unassigned" ? "Unassigned" : courseNames.get(String(groupId)) || "All materials";
          return <section className={groupId === "all" ? "" : styles.courseGroup} key={groupId}>
          {groupId !== "all" && <h3>{groupName}<span>{groupItems.length}</span></h3>}
          {groupItems.map((material) => {
          const isPdf = materialType(material) === "PDF";
          const courseIdForMaterial = selectedCourseId(material);
          const courseName = courseNames.get(String(courseIdForMaterial)) || (courseIdForMaterial ? "Course unavailable" : "Unassigned");
          const isIndexing = indexingPaths.has(material.path);
          const row = (
            <article className={styles.item} key={material.id}>
              <span className={styles.fileIcon}><FileText size={18} /></span>
              <button type="button" className={styles.materialInfo} onClick={() => setSelectedMaterial(material)}>
                <strong title={material.name}>{material.name}</strong>
                <small>{courseName} · {materialType(material)} · {formatSize(material.size)} · {formatDate(material.addedAt)} · You</small>
                {material.storageError && <small className={styles.itemError}>{material.storageError}</small>}
                {material.indexError && <small className={styles.itemError}>{material.indexError}</small>}
              </button>
              {isPdf && !material.isIndexed && <button type="button" className={styles.index} onClick={() => indexMaterial(material)} disabled={isIndexing} title={material.indexError || "Index PDF for AI study"}>{isIndexing ? <LoaderCircle size={14} /> : "Retry index"}</button>}
              {isPdf && material.isIndexed && <button type="button" className={material.isShared ? styles.shared : styles.share} onClick={() => toggleSharedMaterial(material)} disabled={sharingPaths.has(material.path)} aria-pressed={material.isShared} title={material.isShared ? "Turn off shared PDF text access" : "Let signed-in students search this PDF's text"}><Share2 size={14} /><span>{sharingPaths.has(material.path) ? "Saving…" : material.isShared ? "Shared" : "Share text"}</span></button>}
              <button type="button" className={styles.open} onClick={() => material.url ? setSelectedMaterial(material) : setLoadError(material.storageError || "Private download link is unavailable.")} aria-label={`Preview ${material.name}`} title="Preview material"><Eye size={15} /></button>
              {material.url && <a className={styles.download} href={material.url} download={material.name} target="_blank" rel="noreferrer" title="Download file" aria-label={`Download ${material.name}`}><Download size={15} /></a>}
              <button type="button" className={styles.remove} onClick={() => setDeleteTarget(material)} title="Delete material" aria-label={`Delete ${material.name}`}><Trash2 size={15} /></button>
            </article>
          );
          return row;
        })}
        </section>;
        })}
      </div>

      {!loading && !list.length && <EmptyState icon={File} title={materials.length ? "No matching materials" : "No materials yet"} description={materials.length ? "Try changing your search or filters." : "Upload a course file to keep your study resources together."} />}

      {compact && <button type="button" className={styles.viewAll} onClick={() => onOpenCourses?.("Materials")}>View all materials <span>→</span></button>}

      {selectedMaterial && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMaterial(null); }}>
        <section ref={dialogRef} className={styles.previewDialog} role="dialog" aria-modal="true" aria-labelledby="material-preview-title" tabIndex={-1}>
          <div className={styles.previewHeader}><div><h3 id="material-preview-title">{selectedMaterial.name}</h3><p>{courseNames.get(String(selectedCourseId(selectedMaterial))) || "Unassigned"} · {formatDate(selectedMaterial.addedAt)}</p></div><button type="button" onClick={() => setSelectedMaterial(null)} aria-label="Close preview"><X size={17} /></button></div>
          {selectedMaterial.url && materialType(selectedMaterial) === "PDF" ? <iframe className={styles.pdfPreview} title={`Preview of ${selectedMaterial.name}`} src={selectedMaterial.url} /> : selectedMaterial.url && ["PNG", "JPG", "JPEG", "WEBP", "GIF"].includes(materialType(selectedMaterial)) ? <img className={styles.imagePreview} src={selectedMaterial.url} alt={selectedMaterial.name} /> : <div className={styles.unsupportedPreview}><FileText size={28} /><p>Preview is not available for this format. Download the file to open it.</p></div>}
          <div className={styles.previewFooter}>{selectedMaterial.url && <a href={selectedMaterial.url} download={selectedMaterial.name} target="_blank" rel="noreferrer"><Download size={14} /> Download</a>}<button type="button" onClick={() => setSelectedMaterial(null)}>Close</button></div>
        </section>
      </div>}

      {deleteTarget && <div className={styles.modalBackdrop} role="presentation"><section ref={dialogRef} className={styles.deleteDialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-material-title" tabIndex={-1}><span className={styles.deleteIcon}><Trash2 size={19} /></span><h3 id="delete-material-title">Delete this material?</h3><p>{deleteTarget.name} and its stored file will be removed from your account.</p><div><button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Keep material</button><button type="button" className={styles.confirmDelete} onClick={deleteMaterial} disabled={deleteBusy}>{deleteBusy ? "Removing…" : "Delete material"}</button></div></section></div>}
    </section>
  );
}
