import PDFParser from "pdf2json";

function unitNumber(token) {
  const value = token.toUpperCase();
  if (/^\d+$/.test(value)) return Number(value);
  const values = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };
  return values[value] || null;
}

export function parseSyllabusText(rawText, course) {
  const lines = String(rawText || "").replace(/\f/g, "\n").split(/\r?\n/)
    .map((line) => ({ indent: line.match(/^\s*/)?.[0].length || 0, text: line.replace(/[\u0000-\u001f\u007f]/g, " ").trim() }))
    .filter(({ text }) => text);
  const unitPattern = /^(?:UNIT|MODULE)\s+(XII|XI|IX|VIII|VII|VI|V|IV|III|II|I|\d{1,2})\s*[:.\-–—]?\s*(.*)$/i;
  const units = [];
  let current = null;
  for (const row of lines) {
    const line = row.text;
    const match = line.match(unitPattern);
    if (match) {
      const number = unitNumber(match[1]);
      if (!number || number > 24 || units.some((unit) => unit.number === number)) continue;
      current = { number, title: match[2].trim().slice(0, 160) || `Unit ${number}`, topics: [] };
      units.push(current);
      continue;
    }
    if (!current || line.length < 3 || line.length > 200) continue;
    if (/^(?:page\s+\d+|syllabus|course outcomes?|textbooks?|reference books?)\b/i.test(line)) continue;
    const subtopic = line.match(/^(?:\d+\.\d+|[a-z][.)])\s+(.+)$/i);
    if ((row.indent >= 2 || subtopic) && current.topics.length) {
      const title = (subtopic?.[1] || line).replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim();
      if (title.length >= 3 && title.length <= 200) current.topics.at(-1).subtopics.push(title);
      continue;
    }
    const bullets = line.split(/\s*[;•●▪]\s*/).map((item) => item.replace(/^(?:[-*•]|\d+[.)])\s*/, "").trim()).filter((item) => item.length >= 3 && item.length <= 200);
    for (const title of bullets) {
      if (!current.topics.some((topic) => topic.title.toLowerCase() === title.toLowerCase())) current.topics.push({ title, subtopics: [] });
    }
  }
  const verifiedUnits = units.filter((unit) => unit.topics.length);
  const normalizedText = String(rawText || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const canonicalSubject = course?.name || course?.title || course?.code || course?.course_code;
  const subjectTerms = canonicalSubject ? [String(canonicalSubject).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()] : [];
  return {
    subject_name: course?.name || course?.title || "",
    subject_found_in_pdf: subjectTerms.some((term) => term && normalizedText.includes(term)),
    units: verifiedUnits,
  };
}

export function syllabusExtractionIssue(outline, {
  selectedCourseId,
  sourceCourseId = selectedCourseId,
  extractionFailed = false,
} = {}) {
  if (typeof selectedCourseId !== "string" || !selectedCourseId
    || typeof sourceCourseId !== "string" || sourceCourseId !== selectedCourseId) {
    return "The uploaded PDF is not associated with the selected subject. Select the subject again and re-upload.";
  }
  if (extractionFailed) return "PDF text extraction failed. Use a readable, text-based PDF and try again.";
  if (!outline || typeof outline !== "object" || Array.isArray(outline)) {
    return "The PDF did not produce readable syllabus content.";
  }
  if (outline.subject_found_in_pdf !== true) {
    return "The PDF content does not match the selected subject. No syllabus topics were imported.";
  }
  if (!Array.isArray(outline.units) || outline.units.length === 0) {
    return "No readable syllabus units and topics were found in this PDF.";
  }
  for (const unit of outline.units) {
    if (!unit || typeof unit !== "object" || !Number.isInteger(Number(unit.number))
      || Number(unit.number) < 1 || Number(unit.number) > 24
      || typeof unit.title !== "string" || !unit.title.trim()
      || !Array.isArray(unit.topics) || unit.topics.length === 0) {
      return "The extracted syllabus contains incomplete unit metadata. No syllabus topics were imported.";
    }
    for (const topic of unit.topics) {
      if (!topic || typeof topic !== "object" || typeof topic.title !== "string" || topic.title.trim().length < 3
        || (topic.subtopics !== undefined && (!Array.isArray(topic.subtopics)
          || topic.subtopics.some((subtopic) => typeof subtopic !== "string" || subtopic.trim().length < 3)))) {
        return "The extracted syllabus contains missing or invalid topic metadata. No syllabus topics were imported.";
      }
    }
  }
  return null;
}

export function syllabusSourceKey(value) {
  // Extracted PDF metadata is untrusted: do not call replace() on it until
  // the value has been normalized to a string and checked for emptiness.
  const safeValue = typeof value === "string" ? value.trim() : "";
  const key = safeValue.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
  if (!key) throw Object.assign(new Error("The extracted syllabus contains a missing or invalid topic title."), { status: 422 });
  return key;
}

export function extractPdfText(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, true);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      parser.destroy();
      error ? reject(error) : resolve(value);
    };
    parser.once("pdfParser_dataError", (event) => finish(event?.parserError || new Error("PDF parsing failed.")));
    parser.once("pdfParser_dataReady", () => {
      try { finish(null, parser.getRawTextContent()); }
      catch (error) { finish(error); }
    });
    try { parser.parseBuffer(buffer, 1); } catch (error) { finish(error); }
  });
}

export async function extractSyllabusPdf(buffer, course) {
  return parseSyllabusText(await extractPdfText(buffer), course);
}
