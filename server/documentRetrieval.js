const COMMON_WORDS = new Set([
  "the", "and", "for", "that", "with", "from", "this", "what", "when", "where", "which", "who", "why", "how",
  "are", "was", "were", "does", "did", "can", "could", "would", "should", "about", "into", "their", "please",
]);

function termsFor(text, max = 6) {
  return [...new Set(String(text || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [])]
    .filter((term) => !COMMON_WORDS.has(term))
    .slice(0, max);
}

export function selectRelevantDocuments(documents, query, maxDocuments = 5) {
  const terms = termsFor(query, 20);
  return [...documents]
    .map((document, index) => {
      const metadata = `${document.name || ""} ${document.subject || ""}`.toLowerCase();
      return { document, index, score: terms.reduce((score, term) => score + (metadata.includes(term) ? 1 : 0), 0) };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxDocuments)
    .map(({ document }) => document);
}

export async function findRelevantDocumentChunks(admin, document, query, {
  allowBroadFallback = false,
  maxChunks = 4,
} = {}) {
  const terms = termsFor(query);
  const matches = await Promise.all(terms.map(async (term) => {
    const { data, error } = await admin
      .from("book_chunks")
      .select("page_number, content, book_name")
      .eq("user_id", document.user_id)
      .eq("storage_path", document.storage_path)
      .ilike("content", `%${term}%`)
      .limit(4);
    if (error) throw error;
    return data || [];
  }));

  const unique = new Map();
  for (const chunk of matches.flat()) unique.set(`${chunk.page_number}:${chunk.content}`, chunk);
  if (!unique.size && allowBroadFallback) {
    const { data, error } = await admin
      .from("book_chunks")
      .select("page_number, content, book_name")
      .eq("user_id", document.user_id)
      .eq("storage_path", document.storage_path)
      .order("page_number", { ascending: true })
      .limit(maxChunks);
    if (error) throw error;
    return data || [];
  }
  if (!unique.size) return [];

  return [...unique.values()]
    .map((chunk) => ({
      chunk,
      score: terms.reduce((score, term) => score + (chunk.content.toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.chunk.page_number - b.chunk.page_number)
    .slice(0, maxChunks)
    .map(({ chunk }) => chunk);
}
