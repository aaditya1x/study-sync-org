import { lazy, Suspense } from "react";

const MarkdownRenderer = lazy(() => import("./AIResponseMarkdownRenderer.jsx"));

export default function AIResponseMarkdown(props) {
  return <Suspense fallback={<div role="status" aria-live="polite">Formatting AI response…</div>}>
    <MarkdownRenderer {...props} />
  </Suspense>;
}
