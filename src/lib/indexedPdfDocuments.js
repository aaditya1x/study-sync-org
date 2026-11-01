export const MAX_SELECTED_DOCUMENTS = 4;

function documentPath(material) {
  return material?.path || material?.storage_path || "";
}

export function getIndexedPdfDocuments(materials = []) {
  const unique = new Map();
  for (const material of materials) {
    const path = documentPath(material);
    const indexed = material?.isIndexed === true || material?.is_indexed === true;
    const name = String(material?.name || "Study document");
    const type = String(material?.type || "").toLowerCase();
    const isPdf = name.toLowerCase().endsWith(".pdf") || type === "pdf" || type === "application/pdf";
    if (!path || !indexed || !isPdf) continue;
    if (!unique.has(path)) unique.set(path, { ...material, path, name });
  }
  return [...unique.values()];
}

export function toggleIndexedPdfSelection(selectedPaths, path, max = MAX_SELECTED_DOCUMENTS) {
  if (selectedPaths.includes(path)) return selectedPaths.filter((selected) => selected !== path);
  return selectedPaths.length < max ? [...selectedPaths, path] : selectedPaths;
}
