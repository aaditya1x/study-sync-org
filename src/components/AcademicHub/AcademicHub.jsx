import { useEffect, useMemo, useState } from "react";
import { BookOpen, GraduationCap, Layers3, Save } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { validateAcademicProfile } from "../../lib/academicProfileValidation.js";
import { CourseLibrary } from "../CourseLibrary/index.js";
import AcademicCatalogAdmin from "./AcademicCatalogAdmin.jsx";
import styles from "./AcademicHub.module.css";

const emptyProfile = { degree_id: "", branch_id: "", academic_cycle_id: "", year_level: "", semester: "" };

export default function AcademicHub(props) {
  const [catalog, setCatalog] = useState({ degrees: [], branches: [], cycles: [] });
  const [profile, setProfile] = useState(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadAllocation() {
      if (!supabase) {
        setError("Connect Supabase and apply the Academic Hub migration to load academic options.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!auth.user) throw new Error("Sign in again to load your academic allocation.");
        const [degrees, branches, cycles, allocation, staffRole] = await Promise.all([
          supabase.from("academic_degrees").select("id, name").is("archived_at", null).order("name"),
          supabase.from("academic_branches").select("id, degree_id, name").is("archived_at", null).order("name"),
          supabase.from("academic_cycles").select("id, label, starts_on, ends_on").is("archived_at", null).order("label", { ascending: false }),
          supabase.from("academic_profiles").select("degree_id, branch_id, academic_cycle_id, year_level, semester").eq("user_id", auth.user.id).maybeSingle(),
          supabase.from("academic_staff").select("role").eq("user_id", auth.user.id).maybeSingle(),
        ]);
        for (const result of [degrees, branches, cycles, allocation, staffRole]) if (result.error) throw result.error;
        if (!active) return;
        setCatalog({ degrees: degrees.data || [], branches: branches.data || [], cycles: cycles.data || [] });
        setProfile({
          degree_id: allocation.data?.degree_id || "",
          branch_id: allocation.data?.branch_id || "",
          academic_cycle_id: allocation.data?.academic_cycle_id || "",
          year_level: allocation.data?.year_level ? String(allocation.data.year_level) : "",
          semester: allocation.data?.semester ? String(allocation.data.semester) : "",
        });
        setIsAdmin(staffRole.data?.role === "super_admin");
        setReady(true);
      } catch (loadError) {
        if (active) setError(loadError.message || "Could not load academic allocation.");
      } finally {
        if (active) setLoading(false);
      }
    }
    loadAllocation();
    return () => { active = false; };
  }, []);

  const availableBranches = useMemo(
    () => catalog.branches.filter((branch) => !profile.degree_id || branch.degree_id === profile.degree_id),
    [catalog.branches, profile.degree_id],
  );

  function update(field, value) {
    setProfile((current) => ({ ...current, [field]: value, ...(field === "degree_id" ? { branch_id: "" } : {}) }));
  }

  async function saveAllocation(event) {
    event.preventDefault();
    if (!supabase || !ready) return;
    const validationError = validateAcademicProfile({
      degreeId: profile.degree_id,
      branchId: profile.branch_id,
      degrees: catalog.degrees,
      branches: catalog.branches,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in again to save your allocation.");
      const row = {
        user_id: auth.user.id,
        degree_id: profile.degree_id || null,
        branch_id: profile.branch_id || null,
        academic_cycle_id: profile.academic_cycle_id || null,
        year_level: profile.year_level ? Number(profile.year_level) : null,
        semester: profile.semester ? Number(profile.semester) : null,
        updated_at: new Date().toISOString(),
      };
      const { error: saveError } = await supabase.from("academic_profiles").upsert(row, { onConflict: "user_id" });
      if (saveError) throw saveError;
      props.onAcademicProfileChange?.(row);
      props.notify?.("Academic allocation saved.");
    } catch (saveError) {
      setError(saveError.message || "Could not save academic allocation.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.page}>
    <header className={styles.hero}><div className={styles.heroIcon}><GraduationCap size={22}/></div><div><p>YOUR ACADEMIC WORKSPACE</p><h1>Academic Hub</h1><span>Organize subjects around your degree and current semester.</span></div></header>
    <section className={styles.allocation} aria-labelledby="allocation-heading">
      <div className={styles.sectionHeading}><div className={styles.sectionIcon}><Layers3 size={17}/></div><div><h2 id="allocation-heading">Academic allocation</h2><p>Set your degree, branch, academic cycle, year and semester.</p></div></div>
      {loading ? <p className={styles.status} role="status">Loading your academic options…</p> : <form onSubmit={saveAllocation}>
        <div className={styles.fields}>
          <label>Degree<select value={profile.degree_id} onChange={(event) => update("degree_id", event.target.value)}><option value="">Select degree</option>{catalog.degrees.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>Branch<select value={profile.branch_id} onChange={(event) => update("branch_id", event.target.value)} disabled={!profile.degree_id}><option value="">Select branch</option>{availableBranches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label>Academic year<select value={profile.academic_cycle_id} onChange={(event) => update("academic_cycle_id", event.target.value)}><option value="">Select academic year</option>{catalog.cycles.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label>Year<select value={profile.year_level} onChange={(event) => update("year_level", event.target.value)}><option value="">Select year</option>{Array.from({ length: 6 }, (_, index) => <option key={index + 1} value={index + 1}>Year {index + 1}</option>)}</select></label>
          <label>Semester<select value={profile.semester} onChange={(event) => update("semester", event.target.value)}><option value="">Select semester</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>Semester {index + 1}</option>)}</select></label>
        </div>
        {!loading && ready && (!catalog.degrees.length || !catalog.cycles.length) && <p className={styles.catalogHint}>Academic degree and year options are managed in the Supabase catalog. Ask your administrator to add the institutions’ current options.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.save} type="submit" disabled={!ready || saving}>{saving ? "Saving…" : <><Save size={15}/> Save allocation</>}</button>
      </form>}
      {error && loading && <p className={styles.error} role="alert">{error}</p>}
    </section>
    {isAdmin && <AcademicCatalogAdmin catalog={catalog} onCatalogChange={setCatalog} notify={props.notify} />}
    <div className={styles.subjectHeading}><div><p>ACADEMIC LIBRARY</p><h2>Subjects</h2><span>Find branch and semester subjects, or add a personal subject for your allocation.</span></div><span className={styles.subjectMark}><BookOpen size={18}/></span></div>
    <CourseLibrary {...props} academicProfile={profile} academicCatalog={catalog} />
  </section>;
}
