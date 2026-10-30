import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Archive, BookOpen, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight,
  ClipboardList, FileText, GraduationCap, Layers3, Megaphone, RefreshCw, Search,
  Settings2, ShieldCheck, UserCog, Users, X,
} from "lucide-react";
import { adminRequest } from "../../lib/adminApi.js";
import { supabase } from "../../lib/supabase.js";
import AcademicCatalogAdmin from "../AcademicHub/AcademicCatalogAdmin.jsx";
import styles from "./AdminDashboard.module.css";

const sections = [
  ["overview", "Overview", Activity],
  ["users", "User management", Users],
  ["catalog", "Academic catalog", GraduationCap],
  ["courses", "Courses & subjects", BookOpen],
  ["curriculum", "Units & topics", Layers3],
  ["assignments", "Assignments", ClipboardList],
  ["resources", "Shared resources", FileText],
  ["teachers", "Teacher assignments", UserCog],
  ["announcements", "Announcements", Megaphone],
  ["audit", "Security & audit", ShieldCheck],
  ["settings", "Platform settings", Settings2],
];

const entities = {
  courses: "courses", curriculum: "units", assignments: "assignments",
  resources: "materials", teachers: "teachers", announcements: "announcements",
  audit: "audit", settings: "settings",
};

function displayDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function AdminDashboard({ notify }) {
  const [section, setSection] = useState("overview");
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [auxiliary, setAuxiliary] = useState({ courses: [], units: [], chapters: [], topics: [], branches: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (section === "overview") {
        setOverview(await adminRequest("overview"));
        return;
      }
      if (section === "users") {
        setData(await adminRequest("users", { page }));
        return;
      }
      if (section === "catalog") {
        const [degrees, branches, cycles] = await Promise.all([
          supabase.from("academic_degrees").select("id, name, archived_at").order("name"),
          supabase.from("academic_branches").select("id, degree_id, name, archived_at").order("name"),
          supabase.from("academic_cycles").select("id, label, starts_on, ends_on, archived_at").order("label", { ascending: false }),
        ]);
        for (const result of [degrees, branches, cycles]) if (result.error) throw result.error;
        setData({ degrees: degrees.data || [], branches: branches.data || [], cycles: cycles.data || [] });
        return;
      }
      if (section === "curriculum") {
        const [units, chapters, topics, courses] = await Promise.all([
          adminRequest("list", { entity: "units", includeArchived: true }),
          adminRequest("list", { entity: "chapters", includeArchived: true }),
          adminRequest("list", { entity: "topics", includeArchived: true }),
          adminRequest("list", { entity: "courses", includeArchived: false }),
        ]);
        const [branchResult] = await Promise.all([supabase.from("academic_branches").select("id, name")]);
        if (branchResult.error) throw branchResult.error;
        setAuxiliary({ units, chapters, topics, courses, branches: branchResult.data || [] });
        setData(units);
        return;
      }
      if (section === "teachers") {
        const [teachers, branches] = await Promise.all([
          adminRequest("list", { entity: "teachers" }),
          supabase.from("academic_branches").select("id, name").order("name"),
        ]);
        if (branches.error) throw branches.error;
        setData(teachers);
        setAuxiliary((old) => ({ ...old, branches: branches.data || [] }));
        return;
      }
      if (section === "assignments") {
        const [assignments, courses] = await Promise.all([
          adminRequest("list", { entity: "assignments", includeArchived: true }),
          adminRequest("list", { entity: "courses" }),
        ]);
        setData(assignments);
        setAuxiliary((old) => ({ ...old, courses }));
        return;
      }
      const entity = entities[section];
      if (!entity) { setData([]); return; }
      setData(await adminRequest("list", { entity, includeArchived: ["courses", "announcements", "resources"].includes(section) }));
    } catch (loadError) {
      setError(loadError.message || "Could not load this admin section.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [section, page]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setSearch(""); setDraft({}); setPage(1); }, [section]);

  const visibleRows = useMemo(() => {
    if (!Array.isArray(data)) return [];
    const term = search.trim().toLowerCase();
    return term ? data.filter((row) => JSON.stringify(row).toLowerCase().includes(term)) : data;
  }, [data, search]);

  async function run(action, values, successMessage) {
    setSaving(true);
    setError("");
    try {
      await adminRequest(action, values);
      notify?.(successMessage);
      setDraft({});
      await refresh();
      if (["overview", "courses", "assignments", "resources", "users", "teachers"].includes(section)) {
        setOverview(await adminRequest("overview"));
      }
    } catch (saveError) {
      setError(saveError.message || "The action failed.");
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(person, role) {
    if (role === person.role) return;
    const label = role === "super_admin" ? "grant Super Admin access to" : `change ${person.email} to ${role}`;
    if (!window.confirm(`Confirm: ${label}? This action is recorded in the audit log.`)) return;
    await run("set_role", { userId: person.id, role }, "User role updated.");
  }

  async function setSuspension(person, suspend) {
    const action = suspend ? "suspend_student" : "restore_student";
    if (!window.confirm(`${suspend ? "Suspend" : "Restore access for"} ${person.email}?`)) return;
    await run(action, { userId: person.id }, suspend ? "Student account suspended." : "Student account restored.");
  }

  async function archive(entity, row, archived = true) {
    const label = row.name || row.title || row.label || row.subject || row.id;
    if (!window.confirm(`${archived ? "Archive" : "Restore"} “${label}”? Archived records are retained.`)) return;
    await run("archive", { entity, id: row.id, archived }, archived ? "Item archived." : "Item restored.");
  }

  async function saveEntity(event, entity, values, id) {
    event.preventDefault();
    await run("save", { entity, values, ...(id ? { id } : {}) }, "Changes saved.");
  }

  const currentLabel = sections.find(([id]) => id === section)?.[1] || "Admin";

  return <section className={styles.page}>
    <header className={styles.header}>
      <div><p>STUDY SYNC · PLATFORM OPERATIONS</p><h1>Super Admin</h1><span>Privileged actions are verified server-side and recorded.</span></div>
      <div className={styles.secure}><ShieldCheck size={15}/> Super Admin role</div>
    </header>
    <div className={styles.layout}>
      <nav className={styles.nav} aria-label="Admin sections">
        {sections.map(([id, label, Icon]) => <button type="button" key={id} className={section === id ? styles.navActive : ""} onClick={() => setSection(id)}><Icon size={16}/><span>{label}</span></button>)}
      </nav>
      <main className={styles.content}>
        <div className={styles.contentTop}><div><p>ADMINISTRATION</p><h2>{currentLabel}</h2></div><button type="button" className={styles.refresh} onClick={refresh} disabled={loading}><RefreshCw size={15}/> Refresh</button></div>
        {error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={refresh}>Retry</button></div>}
        {loading ? <div className={styles.loading} role="status">Loading verified platform data…</div> : <>
          {section === "overview" && <Overview data={overview} onGo={setSection}/>}
          {section === "users" && <UserManagement rows={visibleRows} page={page} search={search} setSearch={setSearch} setPage={setPage} onRole={changeRole} onSuspend={setSuspension} />}
          {section === "catalog" && data && <CatalogManagement data={data} onRefresh={refresh} notify={notify}/>}
          {section === "courses" && <CourseManagement rows={visibleRows} search={search} setSearch={setSearch} draft={draft} setDraft={setDraft} saving={saving} onSave={saveEntity} onArchive={archive}/>}
          {section === "curriculum" && <CurriculumManagement data={auxiliary} draft={draft} setDraft={setDraft} saving={saving} onSave={saveEntity} onArchive={archive}/>}
          {section === "assignments" && <AssignmentManagement rows={visibleRows} courses={auxiliary.courses} search={search} setSearch={setSearch} draft={draft} setDraft={setDraft} saving={saving} onSave={saveEntity} onArchive={archive}/>}
          {section === "resources" && <ResourceManagement rows={visibleRows} search={search} setSearch={setSearch} saving={saving} onSave={run} onArchive={archive}/>}
          {section === "teachers" && <TeacherManagement rows={visibleRows} branches={auxiliary.branches} search={search} setSearch={setSearch} saving={saving} onAssign={run} onRefresh={refresh}/>}
          {section === "announcements" && <AnnouncementManagement rows={visibleRows} search={search} setSearch={setSearch} draft={draft} setDraft={setDraft} saving={saving} onSave={saveEntity} onArchive={archive}/>}
          {section === "audit" && <AuditLogs rows={visibleRows} search={search} setSearch={setSearch}/>}
          {section === "settings" && <SettingsManagement rows={visibleRows} search={search} setSearch={setSearch} draft={draft} setDraft={setDraft} saving={saving} onSave={saveEntity}/>}
        </>}
      </main>
    </div>
  </section>;
}

function Overview({ data, onGo }) {
  if (!data) return <Empty text="No platform metrics are available."/>;
  const cards = [
    ["Auth users", data.users, Users, "Supabase Auth accounts"],
    ["Active subjects", data.courses, BookOpen, `${data.archivedCourses} archived`],
    ["Study materials", data.materials, FileText, `${data.sharedMaterials} shared`],
    ["Curriculum topics", data.topics, Layers3, `${data.units} active units`],
    ["Assignments", data.assignments, ClipboardList, "Published academic assignments"],
    ["Personal tasks", data.tasks, CheckCircle2, "Stored in student-owned app data"],
    ["Teachers", data.teachers, UserCog, `${data.superAdmins} Super Admins`],
  ];
  return <>
    <div className={styles.metrics}>{cards.map(([label, value, Icon, note]) => <article key={label}><span><Icon size={17}/></span><small>{label}</small><strong>{Number(value).toLocaleString()}</strong><p>{note}</p></article>)}</div>
    <section className={styles.panel}><h3>Administration status</h3><p>Counts come from Supabase Auth and current database rows. No sample or projected values are shown.</p><div className={styles.statusRow}><ShieldCheck size={17}/><span>Administrative access is rechecked by the server on every privileged request.</span><b>Enforced</b></div><div className={styles.statusRow}><Archive size={17}/><span>Academic records are archived and retained when the operation supports it.</span><b>Enabled</b></div></section>
    <div className={styles.quickLinks}>{[["users","Manage users"],["courses","Review subjects"],["audit","Open audit log"],["announcements","Post announcement"]].map(([id,label])=><button type="button" key={id} onClick={()=>onGo(id)}>{label}<ChevronRight size={15}/></button>)}</div>
  </>;
}

function UserManagement({ rows, page, search, setSearch, setPage, onRole, onSuspend }) {
  return <>
    <SearchBox search={search} setSearch={setSearch} placeholder="Search account email or name"/>
    <div className={styles.tableWrap}><table><thead><tr><th>Account</th><th>Role</th><th>Joined</th><th>Last sign in</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((person)=><tr key={person.id}><td><strong>{person.name || "Unnamed account"}</strong><small>{person.email}</small></td><td><select value={person.role} onChange={(event)=>onRole(person,event.target.value)} aria-label={`Role for ${person.email}`}><option value="student">Student</option><option value="teacher">Teacher</option><option value="super_admin">Super Admin</option></select></td><td>{displayDate(person.created_at)}</td><td>{displayDate(person.last_sign_in_at)}</td><td><span className={person.is_suspended ? styles.badgeWarn : styles.badge}>{person.is_suspended ? `Suspended${person.banned_until ? ` until ${displayDate(person.banned_until)}` : " (database access blocked)"}` : "Active"}</span></td><td>{person.role === "student" ? <button type="button" className={styles.smallAction} onClick={()=>onSuspend(person,!person.is_suspended)}>{person.is_suspended?"Restore":"Suspend"}</button> : <span className={styles.muted}>Staff accounts protected</span>}</td></tr>)}</tbody></table>{!rows.length && <Empty text="No user accounts on this page match the search."/>}</div>
    <div className={styles.pager}><button type="button" onClick={()=>setPage((value)=>Math.max(1,value-1))} disabled={page===1}><ChevronLeft size={15}/> Previous</button><span>Page {page}</span><button type="button" onClick={()=>setPage((value)=>value+1)} disabled={rows.length<100}>Next <ChevronRight size={15}/></button></div>
  </>;
}

function CatalogManagement({ data, onRefresh, notify }) {
  return <div className={styles.panel}><div className={styles.panelHeading}><div><h3>Degrees, branches and academic cycles</h3><p>Catalog edits are checked by RLS and create audit events.</p></div><button type="button" className={styles.smallAction} onClick={onRefresh}>Reload catalog</button></div><AcademicCatalogAdmin catalog={data} onCatalogChange={()=>onRefresh()} notify={notify}/></div>;
}

function CourseManagement({ rows, search, setSearch, draft, setDraft, saving, onSave, onArchive }) {
  return <><SearchBox search={search} setSearch={setSearch} placeholder="Search courses and subjects"/><form className={styles.form} onSubmit={(event)=>onSave(event,"courses",{name:draft.name,title:draft.name,code:draft.code||draft.name?.slice(0,12).toUpperCase(),course_code:draft.code||draft.name?.slice(0,12).toUpperCase(),semester:Number(draft.semester)||1,description:draft.description||""})}><input value={draft.name||""} onChange={(event)=>setDraft((old)=>({...old,name:event.target.value}))} placeholder="Subject name" required maxLength={100}/><input value={draft.code||""} onChange={(event)=>setDraft((old)=>({...old,code:event.target.value}))} placeholder="Code" maxLength={16}/><select value={draft.semester||"1"} onChange={(event)=>setDraft((old)=>({...old,semester:event.target.value}))}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>Semester {i+1}</option>)}</select><button disabled={saving}><BookOpen size={14}/> Add subject</button></form><div className={styles.tableWrap}><table><thead><tr><th>Subject</th><th>Branch</th><th>Semester</th><th>Owner</th><th>Status</th><th/></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.code||"No code"}</small></td><td>{row.branch_id||"Unclassified"}</td><td>{row.semester||"—"}</td><td>{row.owner_id}</td><td>{row.archived_at?"Archived":"Active"}</td><td><button type="button" className={styles.smallAction} onClick={()=>onArchive("courses",row,!row.archived_at)}>{row.archived_at?"Restore":"Archive"}</button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No courses match this filter."/>}</div></>;
}

function CurriculumManagement({ data, draft, setDraft, saving, onSave, onArchive }) {
  const [kind,setKind]=useState("units");
  const [unitId,setUnitId]=useState("");
  const [chapterId,setChapterId]=useState("");
  const rows = kind === "units" ? data.units : kind === "chapters" ? data.chapters : data.topics;
  const formValues = kind === "units" ? {course_id:draft.course_id,title:draft.title,position:Number(draft.position)||0} : kind === "chapters" ? {unit_id:draft.unit_id,title:draft.title,position:Number(draft.position)||0} : {chapter_id:draft.chapter_id,title:draft.title,position:Number(draft.position)||0};
  return <><div className={styles.segment}>{[["units","Units"],["chapters","Chapters"],["topics","Topics"]].map(([key,label])=><button type="button" key={key} className={kind===key?styles.segmentActive:""} onClick={()=>setKind(key)}>{label}</button>)}</div><form className={styles.form} onSubmit={(event)=>onSave(event,kind,formValues)}>
    {kind==="units"&&<select value={draft.course_id||""} onChange={(event)=>setDraft((old)=>({...old,course_id:event.target.value}))} required><option value="">Select subject</option>{data.courses.map((course)=><option value={course.id} key={course.id}>{course.name}</option>)}</select>}
    {kind==="chapters"&&<select value={draft.unit_id||unitId} onChange={(event)=>{setUnitId(event.target.value);setDraft((old)=>({...old,unit_id:event.target.value}));}} required><option value="">Select unit</option>{data.units.filter((row)=>!row.archived_at).map((row)=><option value={row.id} key={row.id}>{row.title}</option>)}</select>}
    {kind==="topics"&&<select value={draft.chapter_id||chapterId} onChange={(event)=>{setChapterId(event.target.value);setDraft((old)=>({...old,chapter_id:event.target.value}));}} required><option value="">Select chapter</option>{data.chapters.filter((row)=>!row.archived_at).map((row)=><option value={row.id} key={row.id}>{row.title}</option>)}</select>}
    <input value={draft.title||""} onChange={(event)=>setDraft((old)=>({...old,title:event.target.value}))} placeholder={`${kind.slice(0,-1)} title`} maxLength={200} required/><input type="number" min="0" value={draft.position||0} onChange={(event)=>setDraft((old)=>({...old,position:event.target.value}))} aria-label="Position"/><button disabled={saving}><Layers3 size={14}/> Add {kind.slice(0,-1)}</button>
  </form><div className={styles.tableWrap}><table><thead><tr><th>Title</th><th>Parent record</th><th>Position</th><th>Status</th><th/></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td>{row.title}</td><td>{row.course_id||row.unit_id||row.chapter_id}</td><td>{row.position}</td><td>{row.archived_at?"Archived":"Active"}</td><td><button type="button" className={styles.smallAction} onClick={()=>onArchive(kind,row,!row.archived_at)}>{row.archived_at?"Restore":"Archive"}</button></td></tr>)}</tbody></table>{!rows.length&&<Empty text={`No ${kind} have been created yet.`}/>}</div></>;
}

function AssignmentManagement({ rows, courses, search, setSearch, draft, setDraft, saving, onSave, onArchive }) {
  return <><SearchBox search={search} setSearch={setSearch} placeholder="Search assignments"/><form className={styles.form} onSubmit={(event)=>onSave(event,"assignments",{course_id:draft.course_id,title:draft.title,description:draft.description||"",due_at:draft.due_at||null})}><select value={draft.course_id||""} onChange={(event)=>setDraft((old)=>({...old,course_id:event.target.value}))} required><option value="">Choose subject</option>{courses.map((course)=><option key={course.id} value={course.id}>{course.name}</option>)}</select><input value={draft.title||""} onChange={(event)=>setDraft((old)=>({...old,title:event.target.value}))} placeholder="Assignment title" required maxLength={200}/><input type="datetime-local" value={draft.due_at||""} onChange={(event)=>setDraft((old)=>({...old,due_at:event.target.value}))}/><button disabled={saving}><ClipboardList size={14}/> Create assignment</button><textarea value={draft.description||""} onChange={(event)=>setDraft((old)=>({...old,description:event.target.value}))} placeholder="Instructions" rows="2"/></form><ArchiveTable rows={rows} onArchive={(row)=>onArchive("assignments",row,!row.archived_at)} columns={[["title","Assignment"],["course_id","Subject"],["due_at","Due"],["archived_at","Archived"]]}/></>;
}

function ResourceManagement({ rows, search, setSearch, saving, onSave, onArchive }) {
  return <><SearchBox search={search} setSearch={setSearch} placeholder="Search material name or subject"/><div className={styles.tableWrap}><table><thead><tr><th>Resource</th><th>Uploader</th><th>Subject</th><th>Sharing</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.type} · {Number(row.size||0).toLocaleString()} bytes</small></td><td>{row.user_id}</td><td>{row.subject||"—"}</td><td><button type="button" className={styles.smallAction} disabled={saving} onClick={()=>onSave("save",{entity:"materials",id:row.id,values:{is_shared:!row.is_shared}},"Resource sharing updated.")}>{row.is_shared?"Shared":"Private"}</button></td><td>{row.archived_at?"Archived":"Active"}</td><td><button type="button" className={styles.smallAction} onClick={()=>onArchive("materials",row,!row.archived_at)}>{row.archived_at?"Restore":"Archive"}</button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No uploaded resources were found."/>}</div></>;
}

function TeacherManagement({ rows, branches, search, setSearch, onAssign, onRefresh }) {
  const [selectedBranch,setSelectedBranch]=useState({});
  return <><SearchBox search={search} setSearch={setSearch} placeholder="Search teachers"/><div className={styles.tableWrap}><table><thead><tr><th>Staff member</th><th>Role</th><th>Assigned branches</th><th>Assign branch</th></tr></thead><tbody>{rows.map((row)=><tr key={row.user_id}><td><strong>{row.user?.user_metadata?.full_name||row.user?.email||row.user_id}</strong><small>{row.user?.email||row.user_id}</small></td><td><span className={row.role==="super_admin"?styles.badgeWarn:styles.badge}>{row.role.replace("_"," ")}</span></td><td>{row.branches.map((branch)=><button type="button" key={branch.id} className={styles.assignmentTag} onClick={()=>onAssign("teacher_branch",{userId:row.user_id,branchId:branch.id,assigned:false}).then(onRefresh)}>{branch.name} <X size={12}/></button>)}{row.role==="super_admin"&&<span className={styles.muted}>Global access</span>}</td><td>{row.role==="teacher"&&<div className={styles.assignControl}><select value={selectedBranch[row.user_id]||""} onChange={(event)=>setSelectedBranch((old)=>({...old,[row.user_id]:event.target.value}))}><option value="">Choose branch</option>{branches.filter((branch)=>!row.branches.some((assigned)=>assigned.id===branch.id)).map((branch)=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><button type="button" disabled={!selectedBranch[row.user_id]} onClick={()=>onAssign("teacher_branch",{userId:row.user_id,branchId:selectedBranch[row.user_id],assigned:true}).then(onRefresh)}>Assign</button></div>}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No teachers or Super Admins have been provisioned."/>}</div></>;
}

function AnnouncementManagement({ rows, search, setSearch, draft, setDraft, saving, onSave, onArchive }) {
  return <><SearchBox search={search} setSearch={setSearch} placeholder="Search announcements"/><form className={styles.form} onSubmit={(event)=>onSave(event,"announcements",{title:draft.title,body:draft.body,audience:draft.audience||"all",published_at:draft.published?new Date().toISOString():null})}><input value={draft.title||""} onChange={(event)=>setDraft((old)=>({...old,title:event.target.value}))} placeholder="Announcement title" required maxLength={160}/><select value={draft.audience||"all"} onChange={(event)=>setDraft((old)=>({...old,audience:event.target.value}))}><option value="all">Everyone</option><option value="students">Students</option><option value="teachers">Teachers</option></select><textarea value={draft.body||""} onChange={(event)=>setDraft((old)=>({...old,body:event.target.value}))} placeholder="Announcement message" rows="3" required maxLength={10000}/><label className={styles.check}><input type="checkbox" checked={Boolean(draft.published)} onChange={(event)=>setDraft((old)=>({...old,published:event.target.checked}))}/> Publish now</label><button disabled={saving}><Megaphone size={14}/> Save announcement</button></form><ArchiveTable rows={rows} onArchive={(row)=>onArchive("announcements",row,!row.archived_at)} columns={[["title","Title"],["audience","Audience"],["published_at","Published"],["archived_at","Archived"]]}/></>;
}

function AuditLogs({ rows, search, setSearch }) {
  return <><SearchBox search={search} setSearch={setSearch} placeholder="Search audit events"/><div className={styles.tableWrap}><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td>{displayDate(row.created_at)}</td><td>{row.actor_id||"System/legacy"}</td><td><span className={styles.badge}>{row.action}</span></td><td>{row.entity_type} · {row.entity_id||"—"}</td><td><code>{JSON.stringify(row.metadata||{})}</code></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No administrative events have been recorded yet."/>}</div></>;
}

function SettingsManagement({ rows, search, setSearch, draft, setDraft, saving, onSave }) {
  return <><p className={styles.help}>Settings are stored as JSON values and remain readable only to Super Admins.</p><form className={styles.form} onSubmit={(event)=>{event.preventDefault();let settingValue;try{settingValue=JSON.parse(draft.setting_value||"{}");}catch{return;}onSave(event,"settings",{setting_key:draft.setting_key,setting_value:settingValue});}}><input value={draft.setting_key||""} onChange={(event)=>setDraft((old)=>({...old,setting_key:event.target.value}))} placeholder="Setting key" maxLength={100} required/><textarea value={draft.setting_value||"{}"} onChange={(event)=>setDraft((old)=>({...old,setting_value:event.target.value}))} placeholder='{"enabled": true}' rows="3" required/><button disabled={saving}><Settings2 size={14}/> Save setting</button></form><SearchBox search={search} setSearch={setSearch} placeholder="Search settings"/><div className={styles.tableWrap}><table><thead><tr><th>Key</th><th>Value</th><th>Updated</th></tr></thead><tbody>{rows.map((row)=><tr key={row.setting_key}><td>{row.setting_key}</td><td><code>{JSON.stringify(row.setting_value)}</code></td><td>{displayDate(row.updated_at)}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="No platform settings have been created."/>}</div></>;
}

function ArchiveTable({ rows, columns, onArchive }) {
  return <div className={styles.tableWrap}><table><thead><tr>{columns.map(([key,label])=><th key={key}>{label}</th>)}<th/></tr></thead><tbody>{rows.map((row)=><tr key={row.id}>{columns.map(([key])=><td key={key}>{key.endsWith("at")?displayDate(row[key]):row[key]||"—"}</td>)}<td><button type="button" className={styles.smallAction} onClick={()=>onArchive(row)}>{row.archived_at?"Restore":"Archive"}</button></td></tr>)}</tbody></table>{!rows.length&&<Empty text="No records found."/>}</div>;
}

function SearchBox({ search, setSearch, placeholder }) { return <label className={styles.search}><Search size={15}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder={placeholder}/></label>; }
function Empty({ text }) { return <div className={styles.empty}>{text}</div>; }
