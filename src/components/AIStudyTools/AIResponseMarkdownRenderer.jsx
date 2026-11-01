import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import MermaidDiagram from "./MermaidDiagram.jsx";
import styles from "./AIResponseMarkdown.module.css";

export default function AIResponseMarkdown({ content, className = "" }) {
  if (typeof content !== "string") return null;

  return <div className={`${styles.markdown} ${className}`.trim()}>
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
      rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false, strict: "warn" }]]}
      urlTransform={defaultUrlTransform}
      components={{
        a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        img: () => null,
        code: ({ node, className, children, ...props }) => {
          if (/(^|\s)language-mermaid(\s|$)/.test(className || "")) {
            return <MermaidDiagram source={String(children).replace(/\n$/, "")} />;
          }
          return <code className={`${className || ""} ${styles.code}`} {...props}>{children}</code>;
        },
        pre: ({ node, ...props }) => <pre className={styles.pre} {...props} />,
        table: ({ node, ...props }) => <div className={styles.tableWrap}><table {...props} /></div>,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>;
}
