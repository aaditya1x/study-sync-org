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
  const subjectTerms = [course?.name, course?.title, course?.code, course?.course_code].filter(Boolean).map((term) => String(term).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  return {
    subject_name: course?.name || course?.title || "",
    subject_found_in_pdf: subjectTerms.some((term) => term && normalizedText.includes(term)),
    units: verifiedUnits,
  };
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
