import { useEffect, useId, useState } from "react";
import { Expand, X } from "lucide-react";
import styles from "./MermaidDiagram.module.css";

let mermaidPromise;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", htmlLabels: false, maxTextSize: 12000, maxEdges: 100 });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export default function MermaidDiagram({ source }) {
  const reactId = useId();
  const diagramId = `campusflow-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    let nextUrl = "";
    setImageUrl("");
    setError(false);
    if (source.length > 12000) {
      setError(true);
      return () => { active = false; };
    }
    loadMermaid()
      .then((mermaid) => mermaid.render(diagramId, source))
      .then(({ svg }) => {
        if (!active) return;
        nextUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setImageUrl(nextUrl);
      })
      .catch(() => { if (active) setError(true); });
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [diagramId, source]);

  useEffect(() => {
    if (!expanded) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  return <figure className={styles.figure}>
    {imageUrl
      ? <img className={styles.diagram} src={imageUrl} alt="AI generated study diagram" />
      : <p className={styles.status} role="status">{error ? "This diagram could not be rendered safely." : "Rendering diagram…"}</p>}
    {imageUrl && <button type="button" className={styles.expand} onClick={() => setExpanded(true)} aria-label="Expand diagram"><Expand size={15}/> Expand diagram</button>}
    {expanded && imageUrl && <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Expanded study diagram" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>
      <div className={styles.expandedPanel}>
        <button type="button" className={styles.close} onClick={() => setExpanded(false)} aria-label="Close expanded diagram"><X size={20}/></button>
        <img className={styles.expandedDiagram} src={imageUrl} alt="Expanded AI generated study diagram" />
      </div>
    </div>}
  </figure>;
}
