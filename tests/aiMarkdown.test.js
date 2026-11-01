import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import { defaultUrlTransform } from "react-markdown";

const rendererSource = await readFile(new URL("../src/components/AIStudyTools/AIResponseMarkdownRenderer.jsx", import.meta.url), "utf8");
const lazyRendererSource = await readFile(new URL("../src/components/AIStudyTools/AIResponseMarkdown.jsx", import.meta.url), "utf8");
const floatingSource = await readFile(new URL("../src/components/AIStudyTools/FloatingAIAssistant.jsx", import.meta.url), "utf8");
const studyToolsSource = await readFile(new URL("../src/components/AIStudyTools/AIStudyTools.jsx", import.meta.url), "utf8");
const mermaidSource = await readFile(new URL("../src/components/AIStudyTools/MermaidDiagram.jsx", import.meta.url), "utf8");

test("shared AI Markdown pipeline supports formatting, GFM tables and preserved line breaks", async () => {
  const markdown = "# Heading\n\n**bold** and *italic*\nnew line\n\n- bullet\n- item\n\n1. first\n2. second\n\n`inline code`\n\n```js\nconst ok = true;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[Link](https://example.com)";
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkBreaks);
  const tree = parser.runSync(parser.parse(markdown));
  const types = [];
  function visit(node) { types.push(node.type); for (const child of node.children || []) visit(child); }
  visit(tree);
  for (const type of ["heading", "strong", "emphasis", "list", "inlineCode", "code", "table", "link", "break"]) {
    assert.ok(types.includes(type), `expected parsed Markdown to include ${type}`);
  }
  assert.deepEqual(tree.children.filter((node) => node.type === "list").map((node) => node.ordered), [false, true]);
});

test("AI Markdown rendering is safe and used by both assistants", () => {
  assert.match(lazyRendererSource, /lazy\(\(\) => import\("\.\/AIResponseMarkdownRenderer\.jsx"\)\)/);
  assert.match(rendererSource, /import ReactMarkdown, \{ defaultUrlTransform \} from "react-markdown"/);
  assert.match(rendererSource, /skipHtml/);
  assert.match(rendererSource, /remarkPlugins=\{\[remarkGfm, remarkBreaks, remarkMath\]\}/);
  assert.match(rendererSource, /rehypeKatex, \{ trust: false/);
  assert.match(rendererSource, /urlTransform=\{defaultUrlTransform\}/);
  assert.doesNotMatch(rendererSource, /rehypeRaw|dangerouslySetInnerHTML/);
  assert.match(rendererSource, /img: \(\) => null/);
  assert.equal(defaultUrlTransform("javascript:alert(1)"), "");
  assert.equal(defaultUrlTransform("https://example.com"), "https://example.com");
  assert.match(floatingSource, /<AIResponseMarkdown content=\{message\.content\}/);
  assert.match(studyToolsSource, /<AIResponseMarkdown content=\{result\}/);
  assert.match(floatingSource, /message\.sources\?\.length/);
  assert.match(studyToolsSource, /sources\.join/);
});

test("safe KaTeX renderer processes inline and display math", () => {
  const parser = unified().use(remarkParse).use(remarkMath).use(remarkRehype).use(rehypeKatex, { trust: false, throwOnError: false });
  const tree = parser.runSync(parser.parse("Inline $x^2 + y^2$\n\n$$\nE = mc^2\n$$"));
  const classes = [];
  function visit(node) {
    const className = node.properties?.className;
    if (Array.isArray(className)) classes.push(...className);
    else if (typeof className === "string") classes.push(...className.split(/\s+/));
    for (const child of node.children || []) visit(child);
  }
  visit(tree);
  assert.ok(classes.includes("katex"));
  assert.ok(classes.includes("katex-display"));
});

test("Mermaid output uses strict security, safe SVG image rendering and expand controls", () => {
  assert.match(rendererSource, /language-mermaid/);
  assert.match(mermaidSource, /securityLevel: "strict"/);
  assert.match(mermaidSource, /htmlLabels: false/);
  assert.match(mermaidSource, /new Blob\(\[svg\], \{ type: "image\/svg\+xml" \}\)/);
  assert.match(mermaidSource, /URL\.revokeObjectURL/);
  assert.match(mermaidSource, /aria-label="Expand diagram"/);
  assert.match(mermaidSource, /aria-modal="true"/);
  assert.doesNotMatch(mermaidSource, /dangerouslySetInnerHTML/);
});
