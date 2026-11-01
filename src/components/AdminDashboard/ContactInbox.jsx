import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import { learningRequest } from "../../lib/learningApi.js";
import styles from "./ContactInbox.module.css";

export default function ContactInbox() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(await learningRequest("admin-contacts") || []); }
    catch (failure) { setError(failure.message || "Contact messages could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  async function update(row, status) {
    setSaving(row.id); setError("");
    try { await learningRequest("set-contact-status", { id: row.id, status }); setRows((old) => old.map((item) => item.id === row.id ? { ...item, status } : item)); }
    catch (failure) { setError(failure.message || "Message status could not be updated."); }
    finally { setSaving(""); }
  }
  return <section className={styles.page}><header><div><p>PRIVATE SUPPORT INBOX</p><h3>Contact messages</h3><small>Visible only to active Super Admins. No automatic reply is sent.</small></div><button type="button" onClick={refresh} disabled={loading}><RefreshCw size={14}/> Refresh</button></header>{error && <p className={styles.error} role="alert">{error}</p>}{loading ? <p className={styles.empty}>Loading messages…</p> : rows.length ? <div className={styles.list}>{rows.map((row) => <article key={row.id}><div className={styles.top}><div><strong>{row.subject}</strong><small>{row.name} · <a href={`mailto:${encodeURIComponent(row.email)}`}>{row.email}</a> · {new Date(row.created_at).toLocaleString()}</small></div><select aria-label={`Status for ${row.subject}`} value={row.status} disabled={saving === row.id} onChange={(event) => update(row, event.target.value)}><option value="new">New</option><option value="reviewed">Reviewed</option><option value="closed">Closed</option></select></div><p>{row.message}</p><span><Mail size={13}/> {row.status}</span></article>)}</div> : <p className={styles.empty}>There are no contact messages yet.</p>}</section>;
}
