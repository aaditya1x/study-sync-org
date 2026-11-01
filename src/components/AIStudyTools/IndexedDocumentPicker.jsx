import { useMemo, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import { getIndexedPdfDocuments, MAX_SELECTED_DOCUMENTS, toggleIndexedPdfSelection } from "../../lib/indexedPdfDocuments.js";
import styles from "./IndexedDocumentPicker.module.css";

export default function IndexedDocumentPicker({
  materials = [],
  selectedPaths = [],
  onChange = () => {},
  disabled = false,
  onOpenMaterials,
  idPrefix = "ai-document",
}) {
  const [query, setQuery] = useState("");
  const documents = useMemo(() => getIndexedPdfDocuments(materials), [materials]);
  const selected = documents.filter((document) => selectedPaths.includes(document.path));
  const visible = documents.filter((document) =>
    `${document.name} ${document.subject || ""}`.toLowerCase().includes(query.trim().toLowerCase()));

  function toggle(path) {
    if (disabled) return;
    onChange(toggleIndexedPdfSelection(selectedPaths, path, MAX_SELECTED_DOCUMENTS));
  }

  return (
    <section className={styles.picker} aria-label="Optional PDF context">
      <div className={styles.heading}>
        <div><strong>PDF context <span>Optional</span></strong><small>Only selected indexed PDFs are searched. Up to {MAX_SELECTED_DOCUMENTS} at a time.</small></div>
        {onOpenMaterials && <button type="button" className={styles.libraryLink} onClick={onOpenMaterials}>Study Materials</button>}
      </div>
      {selected.length > 0 && <div className={styles.selected} aria-label="Selected documents">
        {selected.map((document) => <span className={styles.chip} key={document.path}>{document.name}<button type="button" onClick={() => toggle(document.path)} disabled={disabled} aria-label={`Remove ${document.name}`}><X size={13}/></button></span>)}
      </div>}
      <label className={styles.search} htmlFor={`${idPrefix}-search`}><Search size={15}/><input id={`${idPrefix}-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search indexed PDFs" disabled={disabled} aria-label="Search indexed PDFs"/></label>
      {documents.length ? <div className={styles.list} role="group" aria-label="Indexed PDF selection">
        {visible.map((document, index) => {
          const id = `${idPrefix}-${index}`;
          const checked = selectedPaths.includes(document.path);
          return <label className={styles.option} key={document.path} htmlFor={id}>
            <input id={id} type="checkbox" checked={checked} onChange={() => toggle(document.path)} disabled={disabled || (!checked && selectedPaths.length >= MAX_SELECTED_DOCUMENTS)}/>
            <FileText size={15}/><span><strong>{document.name}</strong><small>{document.isShared || document.is_shared ? "Shared material" : document.subject || "Your library"}</small></span>
          </label>;
        })}
        {!visible.length && <p className={styles.empty}>No indexed PDFs match that search.</p>}
      </div> : <p className={styles.empty}>No indexed PDFs are available. General questions work without a document.</p>}
    </section>
  );
}
