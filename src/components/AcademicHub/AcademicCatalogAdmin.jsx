import { useState } from "react";
import { CalendarDays, GraduationCap, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabase.js";
import styles from "./AcademicCatalogAdmin.module.css";

const emptyDraft = { degreeName: "", branchName: "", degree_id: "", label: "", starts_on: "", ends_on: "" };

export default function AcademicCatalogAdmin({ catalog, onCatalogChange, notify }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function startEdit(kind, item) {
    setEditing({ kind, id: item.id });
    setDraft(kind === "degree"
      ? { ...emptyDraft, degreeName: item.name }
      : kind === "branch"
        ? { ...emptyDraft, branchName: item.name, degree_id: item.degree_id }
        : { ...emptyDraft, label: item.label, starts_on: item.starts_on || "", ends_on: item.ends_on || "" });
    setError("");
  }

  function reset() {
    setEditing(null);
    setDraft(emptyDraft);
    setError("");
  }

  async function save(event, kind) {
    event.preventDefault();
    const value = kind === "cycle" ? draft.label.trim() : kind === "branch" ? draft.branchName.trim() : draft.degreeName.trim();
    if (!value) return;
    if (kind === "branch" && !draft.degree_id) {
      setError("Choose the degree this branch belongs to.");
      return;
    }
    if (!supabase) return;
    setBusy(true);
    setError("");
    const table = kind === "degree" ? "academic_degrees" : kind === "branch" ? "academic_branches" : "academic_cycles";
    const payload = kind === "cycle"
      ? { label: value, starts_on: draft.starts_on || null, ends_on: draft.ends_on || null }
      : kind === "branch"
        ? { name: value, degree_id: draft.degree_id }
        : { name: value };
    try {
      let result;
      if (editing?.kind === kind) {
        result = await supabase.from(table).update(payload).eq("id", editing.id).select("*").single();
      } else {
        result = await supabase.from(table).insert(payload).select("*").single();
      }
      if (result.error) throw result.error;
      const key = kind === "degree" ? "degrees" : kind === "branch" ? "branches" : "cycles";
      onCatalogChange((current) => {
        const rows = current[key].filter((item) => item.id !== result.data.id);
        return { ...current, [key]: [...rows, result.data].sort((a, b) => (a.name || a.label).localeCompare(b.name || b.label)) };
      });
      notify?.(`${kind === "cycle" ? "Academic cycle" : kind} ${editing ? "updated" : "added"}.`);
      reset();
    } catch (saveError) {
      setError(saveError.message || "The catalog change was rejected.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind, item) {
    if (!supabase || !window.confirm(`Delete ${kind === "cycle" ? item.label : item.name}? It can only be removed if no records depend on it.`)) return;
    setBusy(true);
    setError("");
    const table = kind === "degree" ? "academic_degrees" : kind === "branch" ? "academic_branches" : "academic_cycles";
    const key = kind === "degree" ? "degrees" : kind === "branch" ? "branches" : "cycles";
    try {
      const { error: deleteError } = await supabase.from(table).delete().eq("id", item.id);
      if (deleteError) throw deleteError;
      onCatalogChange((current) => ({ ...current, [key]: current[key].filter((row) => row.id !== item.id) }));
      if (editing?.id === item.id) reset();
      notify?.(`${kind === "cycle" ? "Academic cycle" : kind} deleted.`);
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete this catalog entry.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.panel} aria-labelledby="catalog-admin-heading">
    <div className={styles.heading}><span><GraduationCap size={18}/></span><div><p>ADMINISTRATION</p><h2 id="catalog-admin-heading">Academic catalog</h2><small>Manage degrees, branches and academic cycles available to students.</small></div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.columns}>
      <section className={styles.column}>
        <h3>Degrees</h3>
        <form onSubmit={(event) => save(event, "degree")}><input value={draft.degreeName} onChange={(event) => setDraft((current) => ({ ...current, degreeName: event.target.value }))} placeholder="Degree name" maxLength={120} aria-label="Degree name" required/><button disabled={busy}><Plus size={14}/>{editing?.kind === "degree" ? "Save" : "Add"}</button></form>
        <ul>{catalog.degrees.map((item) => <li key={item.id}><span>{item.name}</span><button type="button" onClick={() => startEdit("degree", item)} aria-label={`Edit ${item.name}`}><Pencil size={14}/></button><button type="button" onClick={() => remove("degree", item)} disabled={busy} aria-label={`Delete ${item.name}`}><Trash2 size={14}/></button></li>)}</ul>
      </section>
      <section className={styles.column}>
        <h3>Branches</h3>
        <form onSubmit={(event) => save(event, "branch")}><select value={draft.degree_id} onChange={(event) => setDraft((current) => ({ ...current, degree_id: event.target.value }))} aria-label="Degree for branch" required><option value="">Choose degree</option>{catalog.degrees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input value={draft.branchName} onChange={(event) => setDraft((current) => ({ ...current, branchName: event.target.value }))} placeholder="Branch name" maxLength={120} aria-label="Branch name" required/><button disabled={busy || !catalog.degrees.length}><Plus size={14}/>{editing?.kind === "branch" ? "Save" : "Add"}</button></form>
        <ul>{catalog.branches.map((item) => <li key={item.id}><span>{item.name}<small>{catalog.degrees.find((degree) => degree.id === item.degree_id)?.name || "Degree unavailable"}</small></span><button type="button" onClick={() => startEdit("branch", item)} aria-label={`Edit ${item.name}`}><Pencil size={14}/></button><button type="button" onClick={() => remove("branch", item)} disabled={busy} aria-label={`Delete ${item.name}`}><Trash2 size={14}/></button></li>)}</ul>
      </section>
      <section className={styles.column}>
        <h3>Academic cycles</h3>
        <form className={styles.cycleForm} onSubmit={(event) => save(event, "cycle")}><input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="e.g. 2026–2027" maxLength={80} aria-label="Academic cycle label" required/><input type="date" value={draft.starts_on} onChange={(event) => setDraft((current) => ({ ...current, starts_on: event.target.value }))} aria-label="Cycle start date"/><input type="date" value={draft.ends_on} onChange={(event) => setDraft((current) => ({ ...current, ends_on: event.target.value }))} aria-label="Cycle end date"/><button disabled={busy}><Plus size={14}/>{editing?.kind === "cycle" ? "Save" : "Add"}</button></form>
        <ul>{catalog.cycles.map((item) => <li key={item.id}><span>{item.label}<small>{item.starts_on || item.ends_on ? `${item.starts_on || "Start unset"} – ${item.ends_on || "End unset"}` : "Dates not set"}</small></span><button type="button" onClick={() => startEdit("cycle", item)} aria-label={`Edit ${item.label}`}><Pencil size={14}/></button><button type="button" onClick={() => remove("cycle", item)} disabled={busy} aria-label={`Delete ${item.label}`}><Trash2 size={14}/></button></li>)}</ul>
      </section>
    </div>
    {editing && <button type="button" className={styles.cancel} onClick={reset}><X size={14}/> Cancel editing {editing.kind}</button>}
    <p className={styles.note}><CalendarDays size={14}/>Catalog changes are enforced by Supabase RLS. Referenced entries cannot be deleted while academic profiles or subjects use them.</p>
  </section>;
}
