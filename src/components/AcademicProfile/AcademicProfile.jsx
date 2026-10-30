import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GraduationCap, Save } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import { validateAcademicProfile } from "../../lib/academicProfileValidation.js";
import styles from "./AcademicProfile.module.css";

const empty = { degree_id: "", branch_id: "", academic_cycle_id: null, year_level: null, semester: null };

export default function AcademicProfile({ onboarding = false, initialProfile, onSaved, notify }) {
  const [degrees, setDegrees] = useState([]);
  const [branches, setBranches] = useState([]);
  const [value, setValue] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const branchOptions = useMemo(() => branches.filter((item) => item.degree_id === value.degree_id), [branches, value.degree_id]);

  useEffect(() => {
    let current = true;
    async function load() {
      if (!supabase) { setError("Supabase is not configured."); setLoading(false); return; }
      try {
        const { data: auth, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!auth.user) throw new Error("Sign in again to set your academic profile.");
        const [degreeRows, branchRows, profile] = await Promise.all([
          supabase.from("academic_degrees").select("id, name").is("archived_at", null).order("name"),
          supabase.from("academic_branches").select("id, degree_id, name").is("archived_at", null).order("name"),
          supabase.from("academic_profiles").select("degree_id, branch_id, academic_cycle_id, year_level, semester").eq("user_id", auth.user.id).maybeSingle(),
        ]);
        for (const result of [degreeRows, branchRows, profile]) if (result.error) throw result.error;
        if (!current) return;
        setDegrees(degreeRows.data || []);
        setBranches(branchRows.data || []);
        setValue({
          degree_id: profile.data?.degree_id || initialProfile?.degree_id || "",
          branch_id: profile.data?.branch_id || initialProfile?.branch_id || "",
          academic_cycle_id: profile.data?.academic_cycle_id ?? initialProfile?.academic_cycle_id ?? null,
          year_level: profile.data?.year_level ?? initialProfile?.year_level ?? null,
          semester: profile.data?.semester ?? initialProfile?.semester ?? null,
        });
      } catch (loadError) { if (current) setError(loadError.message || "Could not load academic options."); }
      finally { if (current) setLoading(false); }
    }
    load();
    return () => { current = false; };
  }, []);

  async function save(event) {
    event.preventDefault(); setError("");
    const validationError = validateAcademicProfile({
      degreeId: value.degree_id,
      branchId: value.branch_id,
      degrees,
      branches,
    });
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!auth.user) throw new Error("Sign in again to save your academic profile.");
      const { error: saveError } = await supabase.from("academic_profiles").upsert({
        user_id: auth.user.id,
        degree_id: value.degree_id,
        branch_id: value.branch_id,
        academic_cycle_id: value.academic_cycle_id,
        year_level: value.year_level,
        semester: value.semester,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (saveError) throw saveError;
      const profile = {
        degree_id: value.degree_id,
        branch_id: value.branch_id,
        academic_cycle_id: value.academic_cycle_id,
        year_level: value.year_level,
        semester: value.semester,
      };
      notify?.("Academic profile saved.");
      onSaved?.(profile);
    } catch (saveError) { setError(saveError.message || "Could not save your academic profile."); }
    finally { setSaving(false); }
  }

  return <main className={`${styles.page} ${onboarding ? styles.onboarding : ""}`}>
    <section className={styles.card}>
      <span className={styles.icon}><GraduationCap size={24}/></span>
      <p className={styles.eyebrow}>{onboarding ? "LET’S SET UP YOUR SPACE" : "YOUR STUDIES"}</p>
      <h1>{onboarding ? "Choose your course & branch" : "My academic profile"}</h1>
      <p className={styles.copy}>{onboarding ? "Select your degree and branch to personalize your academic dashboard." : "Update your degree or branch. Your personal study data and progress will stay with your account."}</p>
      {loading ? <p role="status" className={styles.status}>Loading academic options…</p> : <form onSubmit={save}>
        <label>Degree<select required value={value.degree_id} onChange={(event) => setValue((current) => ({ ...current, degree_id: event.target.value, branch_id: "" }))}>
          <option value="">Choose a degree</option>{degrees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Branch<select required value={value.branch_id} disabled={!value.degree_id} onChange={(event) => setValue((old) => ({ ...old, branch_id: event.target.value }))}>
          <option value="">Choose a branch</option>{branchOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {!degrees.length && <p className={styles.hint}>No academic options are available yet. Ask a Super Admin to add degrees and branches to the catalog.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.submit} type="submit" disabled={saving || !degrees.length}>{saving ? "Saving…" : onboarding ? <>Continue to dashboard <ArrowRight size={17}/></> : <><Save size={16}/> Save profile</>}</button>
      </form>}
    </section>
  </main>;
}
