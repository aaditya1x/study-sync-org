import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BookOpen,
  BrainCircuit,
  ChartNoAxesCombined,
  CheckSquare,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import { AppShell } from "./components/AppShell/index.js";
import { Navbar } from "./components/Navbar/index.js";
import { Sidebar } from "./components/Sidebar/index.js";
import { StatCard } from "./components/StatCard/index.js";
import { CourseLibrary } from "./components/CourseLibrary/index.js";
import AcademicHub from "./components/AcademicHub/AcademicHub.jsx";
import AdminDashboard from "./components/AdminDashboard/AdminDashboard.jsx";
import { MaterialsPanel } from "./components/MaterialsPanel/index.js";
import { SyllabusLibrary } from "./components/SyllabusLibrary/index.js";
import { TasksPanel } from "./components/TasksPanel/index.js";
import { AIStudyTools } from "./components/AIStudyTools/index.js";
import { ProgressReport } from "./components/ProgressReport/index.js";
import { SettingsPanel } from "./components/SettingsPanel/index.js";
import { Toast } from "./components/Toast/index.js";
import { Login } from "./components/Login/index.js";
import AcademicProfile from "./components/AcademicProfile/AcademicProfile.jsx";
import AcademicAssignments from "./components/AcademicAssignments/AcademicAssignments.jsx";
import { LegalPage, PublicLanding } from "./components/PublicSite.jsx";

import { usePersistentState } from "./hooks/usePersistentState.js";
import { supabase, STORAGE_BUCKETS } from "./lib/supabase.js";
import {
  initialCourses,
  initialMaterials,
  initialTasks,
} from "./data/initialData.js";

import styles from "./App.module.css";

const navItems = [
  { id: "Dashboard", label: "Dashboard", group: "Workspace", icon: LayoutDashboard },
  { id: "Courses", label: "Courses & subjects", group: "Academics", icon: BookOpen },
  { id: "Syllabus", label: "Curriculum", group: "Academics", icon: GraduationCap },
  { id: "Materials", label: "Materials & notes", group: "Study space", icon: FileText },
  { id: "Tasks", label: "Assignments", group: "Study space", icon: CheckSquare },
  { id: "AI Tools", label: "AI study tools", group: "Workspace", icon: BrainCircuit },
  { id: "Progress", label: "Progress reports", group: "Workspace", icon: ChartNoAxesCombined },
  { id: "Settings", label: "Profile & appearance", group: "Settings", icon: Settings2 },
  { id: "Academic Profile", label: "My academic profile", group: "Settings", icon: GraduationCap },
];

function makeSession(user) {
  if (!user) return null;
  return {
    authenticated: true,
    userId: user.id,
    username:
      user.user_metadata?.username ||
      user.user_metadata?.full_name ||
      user.email?.split("@")[0] ||
      "Student",
  };
}

export default function App() {
  const currentPath = typeof window === "undefined" ? "/" : window.location.pathname;
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [active, setActive] = useState("Dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [createCourseRequested, setCreateCourseRequested] = useState(false);
  const [uploadMaterialRequest, setUploadMaterialRequest] = useState({ open: false, courseId: "" });
  const [courseLoadStatus, setCourseLoadStatus] = useState("loading");
  const [materialLoadStatus, setMaterialLoadStatus] = useState("loading");
  const [chapterProgressByCourse, setChapterProgressByCourse] = useState({});
  const [platformRole, setPlatformRole] = useState("student");
  const [academicProfile, setAcademicProfile] = useState(null);
  const [academicProfileLoading, setAcademicProfileLoading] = useState(true);
  const [academicProfileError, setAcademicProfileError] = useState("");

  const userStoragePrefix = session?.userId
    ? `campusflow-${session.userId}`
    : "campusflow-guest";

  const [courses, setCourses] = usePersistentState(
    `${userStoragePrefix}-courses`,
    initialCourses,
  );

  const [materials, setMaterials] = usePersistentState(
    `${userStoragePrefix}-materials`,
    initialMaterials,
  );

  const [tasks, setTasks] = usePersistentState(
    `${userStoragePrefix}-tasks`,
    initialTasks,
  );

  const [toast, setToast] = useState("");
  const [cloudReadyUserId, setCloudReadyUserId] = useState(null);
  const [taskSyncStatus, setTaskSyncStatus] = useState("checking");
  const [taskSyncError, setTaskSyncError] = useState("");
  const taskSaveQueue = useRef(Promise.resolve());
  const taskSaveVersion = useRef(0);

  const [profilePicture, setProfilePicture] = useState("");
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const recoveryHash = typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "");
  const isPasswordRecoveryFlow = typeof window !== "undefined" && window.location.pathname === "/auth/callback" && (
    new URLSearchParams(window.location.search).get("type") === "recovery" ||
    new URLSearchParams(recoveryHash).get("type") === "recovery"
  );

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return undefined;
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event, authSession) => {
      setSession(makeSession(authSession?.user));
      setAuthLoading(false);
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      if (event === "SIGNED_OUT") {
        setProfilePicture("");
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setPlatformRole("student");
    if (!supabase || !session?.userId) return () => { active = false; };
    supabase.from("academic_staff").select("role").eq("user_id", session.userId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw error;
        if (active) setPlatformRole(data?.role || "student");
      })
      .catch((error) => console.error("Could not load the signed-in role:", error));
    return () => { active = false; };
  }, [session?.userId]);

  useEffect(() => {
    let current = true;
    async function loadAcademicProfile() {
      setAcademicProfile(null);
      setAcademicProfileError("");
      setAcademicProfileLoading(true);
      if (!session?.userId || !supabase) { setAcademicProfileLoading(false); return; }
      const { data, error } = await supabase.from("academic_profiles")
        .select("degree_id, branch_id, academic_cycle_id, year_level, semester")
        .eq("user_id", session.userId).maybeSingle();
      if (!current) return;
      if (error) setAcademicProfileError(error.message || "Could not verify your academic profile.");
      else setAcademicProfile(data || null);
      setAcademicProfileLoading(false);
    }
    loadAcademicProfile();
    return () => { current = false; };
  }, [session?.userId]);

  useEffect(() => {
    if (active === "Admin" && platformRole !== "super_admin") setActive("Dashboard");
  }, [active, platformRole]);

  useEffect(() => {
    setProfilePicture("");
    if (!supabase || !session?.userId) return undefined;

    let active = true;
    let refreshing = false;

    async function refreshProfilePicture() {
      if (refreshing) return;
      refreshing = true;
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user || data.user.id !== session.userId) return;
        const path = data.user.user_metadata?.avatar_path;
        if (!path) {
          if (active) setProfilePicture("");
          return;
        }

        const { data: signedData, error: signedError } = await supabase.storage
          .from(STORAGE_BUCKETS.profiles)
          .createSignedUrl(path, 3600);
        if (!signedError && active) setProfilePicture(signedData.signedUrl);
      } catch (error) {
        console.error("Could not refresh profile photo:", error);
      } finally {
        refreshing = false;
      }
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshProfilePicture();
    };

    refreshProfilePicture();
    const refreshTimer = window.setInterval(refreshProfilePicture, 50 * 60 * 1000);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [session?.userId]);

  useEffect(() => {
  let cancelled = false;

  async function loadCloudData() {
    setCloudReadyUserId(null);

    if (!session?.authenticated || !supabase) {
      setTaskSyncStatus("local");
      return;
    }

    setTaskSyncStatus("checking");
    setTaskSyncError("");

    try {
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (
        authError ||
        !authData.user ||
        authData.user.id !== session.userId
      ) {
        setTaskSyncStatus("error");
        setTaskSyncError("Your session is no longer valid. Sign in again to sync.");
        notify("Please log in again to sync your data.");
        return;
      }

      const { data, error } = await supabase
        .from("user_app_data")
        .select("data_key, data")
        .eq("user_id", authData.user.id);

      if (error) throw error;
      if (cancelled) return;

      const savedTasks = (data || []).find(
        (item) => item.data_key === "tasks"
      );
      if (savedTasks && Array.isArray(savedTasks.data)) {
        setTasks(savedTasks.data);
      }

      setCloudReadyUserId(authData.user.id);
      setTaskSyncStatus(savedTasks ? "synced" : "saving");
    } catch (error) {
      console.error("Cloud data loading failed:", error);
      if (!cancelled) {
        setTaskSyncStatus("error");
        setTaskSyncError(error.message || "Could not load tasks from Supabase.");
      }
      if (!cancelled) notify("Could not load saved data.");
    }
  }

  loadCloudData();

  return () => {
    cancelled = true;
  };
}, [session?.userId]);

useEffect(() => {
  if (
    !session?.userId ||
    cloudReadyUserId !== session.userId ||
    !supabase
  ) return;

  let cancelled = false;
  const version = ++taskSaveVersion.current;
  const taskSnapshot = tasks;

  async function saveCloudData() {
    try {
      const previousSave = taskSaveQueue.current.catch(() => {});
      const currentSave = previousSave.then(async () => {
        if (cancelled) return;
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!authData.user || authData.user.id !== session.userId) {
          throw new Error("Your session changed before tasks could sync.");
        }

        const { error } = await supabase
          .from("user_app_data")
          .upsert(
            { user_id: authData.user.id, data_key: "tasks", data: taskSnapshot },
            { onConflict: "user_id,data_key" },
          );
        if (error) throw error;
      });
      taskSaveQueue.current = currentSave;
      await currentSave;
      if (!cancelled && version === taskSaveVersion.current) {
        setTaskSyncStatus("synced");
        setTaskSyncError("");
      }
    } catch (error) {
      console.error("Cloud data saving failed:", error);
      if (!cancelled && version === taskSaveVersion.current) {
        setTaskSyncStatus("error");
        setTaskSyncError(error.message || "Supabase rejected the task update.");
      }
    }
  }

  setTaskSyncStatus("saving");
  saveCloudData();

  return () => {
    cancelled = true;
  };
}, [tasks, cloudReadyUserId, session?.userId]);

  const [query, setQuery] = useState("");

  // All React hooks must run before any conditional return.
  useEffect(() => {
    const onResize = () => {
      if (window.matchMedia("(min-width: 801px)").matches) {
        setMobileNavOpen(false);
      }
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileNavOpen]);

  const doneTasks = tasks.filter((task) => task.completed).length;
  const pendingTasks = tasks.length - doneTasks;
  const studyProgress = tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(notify.timer);

    notify.timer = window.setTimeout(() => {
      setToast("");
    }, 2800);
  }, []);

  function handleLogin(user) {
    setSession(makeSession(user));
    setActive("Dashboard");
  }

async function handleLogout() {
  try {
    if (supabase) {
      const { error } = await supabase.auth.signOut();

      if (error) {
        notify(`Could not log out: ${error.message}`);
        return;
      }
    }
    setSession(null);
    setProfilePicture("");
    setActive("Dashboard");
    setQuery("");
  } catch (error) {
    console.error("Logout error:", error);
    notify("Could not log out. Please try again.");
  }
}


  function handleNavigate(id) {
    setQuery("");
    setActive(id);
    setMobileNavOpen(false);
  }

  const openCourse = useCallback((courseId) => {
    setSelectedCourseId(courseId || "");
    setActive("Courses");
  }, []);

  const requestUpload = useCallback((courseId = "") => {
    setUploadMaterialRequest({ open: true, courseId: courseId || "" });
    setQuery("");
    setActive("Materials");
  }, []);

  const clearUploadRequest = useCallback(() => {
    setUploadMaterialRequest((current) => ({ ...current, open: false }));
  }, []);

  const clearCourseRequest = useCallback(() => setCreateCourseRequested(false), []);

  const recentActivity = useMemo(() => [
    ...materials.map((item) => ({
      id: `material-${item.id || item.path || item.name}`,
      label: `Uploaded ${item.name}`,
      date: item.addedAt || item.created_at,
      action: () => setActive("Materials"),
    })),
    ...courses.map((item) => ({
      id: `course-${item.id}`,
      label: `Added ${item.name || item.title || "a course"}`,
      date: item.created_at,
      action: () => openCourse(item.id),
    })),
    ...tasks.map((item) => ({
      id: `task-${item.id}`,
      label: item.completed ? `Completed ${item.title}` : `Added ${item.title}`,
      date: item.completedAt || item.createdAt,
      action: () => setActive("Tasks"),
    })),
  ].filter((item) => item.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5), [materials, courses, tasks, openCourse]);

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term.length < 2) return [];
    return [
      ...courses.filter((item) => (item.owner_id === session?.userId || item.branch_id === academicProfile?.branch_id)
        && `${item.name || item.title} ${item.code || item.course_code || ""}`.toLowerCase().includes(term))
        .map((item) => ({ id: `course-${item.id}`, label: item.name || item.title, detail: "Course", section: "Courses", courseId: item.id })),
      ...materials.filter((item) => `${item.name} ${item.subject || ""}`.toLowerCase().includes(term))
        .map((item) => ({ id: `material-${item.id || item.path}`, label: item.name, detail: "Study material", section: "Materials" })),
      ...tasks.filter((item) => `${item.title} ${item.description || ""}`.toLowerCase().includes(term))
        .map((item) => ({ id: `task-${item.id}`, label: item.title, detail: item.completed ? "Completed task" : "Task", section: "Tasks" })),
    ].slice(0, 8);
  }, [query, courses, materials, tasks, session?.userId, academicProfile?.branch_id]);

  const selectSearchResult = useCallback((result) => {
    if (result.courseId) setSelectedCourseId(result.courseId);
    setActive(result.section);
    setMobileNavOpen(false);
  }, []);

  const shared = {
    courses,
    setCourses,
    materials,
    setMaterials,
    tasks,
    setTasks,
    taskSyncStatus,
    taskSyncError,
    notify,
    query,
    setQuery,
    onQueryChange: setQuery,
    setActive,
    onLoadStatusChange: setMaterialLoadStatus,
    onCourseLoadStatusChange: setCourseLoadStatus,
  };

  const scopedCourses = useMemo(() => courses.filter((course) => {
    if (course.owner_id && course.owner_id === session?.userId) return true;
    return Boolean(academicProfile?.branch_id && course.branch_id === academicProfile.branch_id);
  }), [courses, academicProfile?.branch_id, session?.userId]);
  const academicShared = { ...shared, courses: scopedCourses };

  const visibleNavItems = platformRole === "super_admin"
    ? [...navItems, { id: "Admin", label: "Super Admin", icon: ShieldCheck }]
    : navItems;
  const title = visibleNavItems.find((item) => item.id === active)?.label || active;

  if (currentPath === "/terms") return <LegalPage type="terms" />;
  if (currentPath === "/privacy") return <LegalPage type="privacy" />;

  if (authLoading) {
    return <main className={styles.loading} aria-live="polite">Loading your workspace…</main>;
  }

  if (!session?.authenticated || isPasswordRecoveryFlow || passwordRecovery) {
    if (!isPasswordRecoveryFlow && !passwordRecovery && currentPath === "/") return <PublicLanding />;
    return <Login onLogin={handleLogin} initialMode={isPasswordRecoveryFlow || passwordRecovery ? "reset" : currentPath === "/signup" ? "signup" : undefined} onExitRecovery={() => setPasswordRecovery(false)} />;
  }

  if (academicProfileLoading) return <main className={styles.loading} aria-live="polite">Preparing your academic workspace…</main>;
  if (academicProfileError) return <main className={styles.loading} role="alert">Could not verify your academic profile: {academicProfileError}</main>;
  if (!academicProfile || !academicProfile.degree_id || !academicProfile.branch_id) {
    return <AcademicProfile onboarding onSaved={(profile) => { setAcademicProfile(profile); setActive("Dashboard"); }} />;
  }

  return (
    <AppShell collapsed={sidebarCollapsed}>
      {mobileNavOpen && (
        <button
          type="button"
          className={styles.navOverlay}
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <Sidebar
        items={visibleNavItems}
        active={active}
        onChange={handleNavigate}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
      />

      <main className={styles.main}>
        <Navbar
          title={title}
          showSearch={active === "Dashboard"}
          query={query}
          onQueryChange={setQuery}
          searchResults={searchResults}
          onSelectSearchResult={selectSearchResult}
          onMenu={() => setMobileNavOpen((open) => !open)}
          mobileNavOpen={mobileNavOpen}
          profilePicture={profilePicture}
          onOpenSettings={() => setActive("Settings")}
          notify={notify}
          username={session.username}
          onLogout={handleLogout}
        />

        {active === "Dashboard" && (
          <>
            <section className={styles.welcome}>
              <div>
                <p className={styles.eyebrow}>YOUR LEARNING SPACE</p>
                <h1>
                  Welcome back, {session.username}!{" "}
                  <span aria-hidden="true">✦</span>
                </h1>
                <p className={styles.subtitle}>
                  Small steps today, stronger skills tomorrow.
                </p>
              </div>

              <button
                className={styles.primaryButton}
                onClick={() => { setCreateCourseRequested(true); setActive("Courses"); }}
              >
                ＋ Add a course
              </button>
            </section>

            <section className={styles.stats} aria-label="Study overview">
              <StatCard
                label="Available courses"
                value={courseLoadStatus === "loading" ? "…" : courseLoadStatus === "error" ? "—" : scopedCourses.length}
                note={courseLoadStatus === "error" ? "Could not load courses" : "Shared college library"}
                icon={BookOpen}
                tint="purple"
                onClick={() => setActive("Courses")}
              />
              <StatCard
                label="Study materials"
                value={materialLoadStatus === "loading" ? "…" : materialLoadStatus === "error" ? "—" : materials.length}
                note={materialLoadStatus === "error" ? "Could not load materials" : "Shared files and your private uploads"}
                icon={FileText}
                tint="blue"
                onClick={() => setActive("Materials")}
              />
              <StatCard
                label="Pending tasks"
                value={pendingTasks}
                note="Assignments and study goals"
                icon={CheckSquare}
                tint="orange"
                onClick={() => setActive("Tasks")}
              />
              <StatCard
                label="Tasks completed"
                value={doneTasks}
                note={`Out of ${tasks.length} tasks`}
                icon={CheckSquare}
                tint="green"
                onClick={() => setActive("Tasks")}
              />
              <StatCard
                label="Study progress"
                value={`${studyProgress}%`}
                note={tasks.length ? "Based on completed tasks" : "Add a task to start tracking"}
                icon={ChartNoAxesCombined}
                tint="purple"
                onClick={() => setActive("Progress")}
              />
            </section>

            <div className={styles.dashboardGrid}>
              <CourseLibrary
                {...academicShared}
                compact
                onOpenCourse={openCourse}
                onViewAll={() => setActive("Courses")}
                onCourseLoadStatusChange={setCourseLoadStatus}
                onChapterProgressChange={setChapterProgressByCourse}
              />

              <div className={styles.rightColumn}>
                <div className={styles.aiBanner}>
                  <span className={styles.sparkle}>✦</span>
                  <h2>Your AI study companion</h2>
                  <p>
                    Turn notes into clear summaries, concept explanations and
                    practice quizzes.
                  </p>
                  <button onClick={() => setActive("AI Tools")}>
                    Explore AI tools <span>↗</span>
                  </button>
                </div>

                <div className={styles.quickActions} aria-label="Quick actions">
                  <button type="button" onClick={() => { setCreateCourseRequested(true); setActive("Courses"); }}>Create course</button>
                  <button type="button" onClick={() => requestUpload()}>Upload material</button>
                  <button type="button" onClick={() => setActive("Tasks")}>View assignments</button>
                </div>

                <TasksPanel {...shared} compact onViewAll={() => setActive("Tasks")} />
                <MaterialsPanel {...shared} compact onOpenCourses={() => setActive("Materials")} />

                <section className={styles.activity} aria-labelledby="activity-title">
                  <div className={styles.activityHeading}><div><h2 id="activity-title">Recent activity</h2><p>Updates from your workspace</p></div></div>
                  {recentActivity.length ? <ul>{recentActivity.map((item) => <li key={item.id}><button type="button" onClick={item.action}><span>{item.label}</span><time dateTime={item.date}>{new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></button></li>)}</ul> : <p className={styles.activityEmpty}>Your course and material updates will appear here.</p>}
                </section>
              </div>
            </div>
          </>
        )}

        {active === "Courses" && <AcademicHub
          {...academicShared}
          onAcademicProfileChange={setAcademicProfile}
          materials={materials}
          initialSelectedCourseId={selectedCourseId}
          onUploadMaterial={requestUpload}
          autoOpenCreate={createCourseRequested}
          onCreateFormOpened={clearCourseRequest}
          onCourseLoadStatusChange={setCourseLoadStatus}
          onChapterProgressChange={setChapterProgressByCourse}
        />}

        {active === "Materials" && <MaterialsPanel
          {...shared}
          courses={scopedCourses}
          setCourses={setCourses}
          initialCourseId={uploadMaterialRequest.courseId}
          autoOpenUpload={uploadMaterialRequest.open}
          onUploadFormOpened={clearUploadRequest}
          onOpenCourses={() => { setCreateCourseRequested(true); setActive("Courses"); }}
        />}

        {active === "Syllabus" && <SyllabusLibrary
          query={query}
          courses={scopedCourses}
          materials={materials}
          loading={courseLoadStatus === "loading" || materialLoadStatus === "loading"}
          coursesStatus={courseLoadStatus}
          materialsStatus={materialLoadStatus}
        />}

        {active === "Tasks" && <><AcademicAssignments courses={scopedCourses} /><TasksPanel {...shared} /></>}

        {active === "AI Tools" && (
          <AIStudyTools
            materials={materials}
            notify={notify}
            onOpenMaterials={() => setActive("Materials")}
          />
        )}

        {active === "Progress" && (
          <ProgressReport
            courses={scopedCourses}
            tasks={tasks}
            materials={materials}
            chapterProgressByCourse={chapterProgressByCourse}
          />
        )}

        {active === "Settings" && (
          <SettingsPanel
            notify={notify}
            username={session.username}
            profilePicture={profilePicture}
            onProfilePictureChange={setProfilePicture}
            onOpenAcademicProfile={() => setActive("Academic Profile")}
          />
        )}

        {active === "Academic Profile" && <AcademicProfile
          initialProfile={academicProfile}
          notify={notify}
          onSaved={(profile) => { setAcademicProfile((current) => ({ ...current, ...profile })); setActive("Dashboard"); }}
        />}

        {active === "Admin" && platformRole === "super_admin" && <AdminDashboard notify={notify} />}
      </main>

      <Toast message={toast} />
    </AppShell>
  );
}
