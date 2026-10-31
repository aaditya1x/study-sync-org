const FORMATS = {
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "ooxml", marker: "word/document.xml", root: "document", namespace: "http://schemas.openxmlformats.org/wordprocessingml/2006/main" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "ooxml", marker: "ppt/presentation.xml", root: "presentation", namespace: "http://schemas.openxmlformats.org/presentationml/2006/main" },
  txt: { mime: "text/plain", kind: "text" },
  jpg: { mime: "image/jpeg", kind: "jpeg" },
  jpeg: { mime: "image/jpeg", kind: "jpeg" },
  png: { mime: "image/png", kind: "png" },
  webp: { mime: "image/webp", kind: "webp" },
  gif: { mime: "image/gif", kind: "gif" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "ooxml", marker: "xl/workbook.xml", root: "workbook", namespace: "http://schemas.openxmlformats.org/spreadsheetml/2006/main" },
  csv: { mime: "text/csv", kind: "text" },
  pdf: { mime: "application/pdf", kind: "pdf" },
};

const MIME_ALIASES = {
  "image/jpg": "image/jpeg",
  "application/x-pdf": "application/pdf",
};
const OOXML_MAIN_PARTS = ["word/document.xml", "ppt/presentation.xml", "xl/workbook.xml"];
const OOXML_CONTENT_TYPES = {
  "word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  "ppt/presentation.xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  "xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
};
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

export function extensionOf(name = "") {
  return String(name).split(".").pop()?.toLowerCase() || "";
}

function startsWith(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function checkMime(declaredMime, expectedMime) {
  if (!declaredMime) return;
  const normalized = MIME_ALIASES[declaredMime.toLowerCase()] || declaredMime.toLowerCase();
  if (normalized !== expectedMime) throw new Error("The selected file's MIME type does not match its extension and content.");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readZipEntry(file, entry) {
  if (!entry || entry.uncompressedSize > 25 * 1024 * 1024) return null;
  const compressed = await file.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize).arrayBuffer();
  let bytes;
  if (entry.method === 0) bytes = new Uint8Array(compressed);
  else {
    if (typeof DecompressionStream === "undefined") return null;
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { return null; }
  }
  return bytes.length === entry.uncompressedSize && crc32(bytes) === entry.crc ? bytes : null;
}

async function validateOoxml(file, format) {
  const maxTail = Math.min(file.size, 65557);
  const tailStart = file.size - maxTail;
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tailView.getUint32(i, true) === ZIP_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return false;

  const disk = tailView.getUint16(eocd + 4, true);
  const centralDisk = tailView.getUint16(eocd + 6, true);
  const diskEntries = tailView.getUint16(eocd + 8, true);
  const totalEntries = tailView.getUint16(eocd + 10, true);
  const centralSize = tailView.getUint32(eocd + 12, true);
  const centralOffset = tailView.getUint32(eocd + 16, true);
  const commentLength = tailView.getUint16(eocd + 20, true);
  const absoluteEocd = tailStart + eocd;
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) return false;
  if (eocd + 22 + commentLength !== tail.length || centralOffset + centralSize !== absoluteEocd || centralSize > 5 * 1024 * 1024) return false;

  const central = new Uint8Array(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names = new Set();
  const entries = new Map();
  let cursor = 0;
  try {
    for (let entry = 0; entry < totalEntries; entry += 1) {
      if (cursor + 46 > central.length || view.getUint32(cursor, true) !== ZIP_CENTRAL) return false;
      const flags = view.getUint16(cursor + 8, true);
      const method = view.getUint16(cursor + 10, true);
      const checksum = view.getUint32(cursor + 16, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const entryCommentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      const end = cursor + 46 + nameLength + extraLength + entryCommentLength;
      if (end > central.length || (flags & 1) !== 0 || (method !== 0 && method !== 8) || localOffset + 30 > file.size) return false;
      const name = decoder.decode(central.subarray(cursor + 46, cursor + 46 + nameLength));
      if (names.has(name)) return false;
      names.add(name);

      const localHeader = new Uint8Array(await file.slice(localOffset, localOffset + 30).arrayBuffer());
      if (localHeader.length !== 30 || new DataView(localHeader.buffer).getUint32(0, true) !== ZIP_LOCAL) return false;
      const localView = new DataView(localHeader.buffer);
      if (localView.getUint16(6, true) !== flags || localView.getUint16(8, true) !== method) return false;
      const localNameLength = localView.getUint16(26, true);
      const localExtraLength = localView.getUint16(28, true);
      const localNameBytes = new Uint8Array(await file.slice(localOffset + 30, localOffset + 30 + localNameLength).arrayBuffer());
      if (decoder.decode(localNameBytes) !== name || localOffset + 30 + localNameLength + localExtraLength + compressedSize > centralOffset) return false;
      entries.set(name, { method, crc: checksum, compressedSize, uncompressedSize, dataOffset: localOffset + 30 + localNameLength + localExtraLength });
      cursor = end;
    }
  } catch {
    return false;
  }
  if (cursor !== central.length || !names.has("[Content_Types].xml") || !names.has("_rels/.rels") || !names.has(format.marker)) return false;
  if (names.has("word/vbaProject.bin") || names.has("ppt/vbaProject.bin") || names.has("xl/vbaProject.bin")) return false;
  if (OOXML_MAIN_PARTS.filter((part) => names.has(part)).length !== 1) return false;
  const contentTypesBytes = await readZipEntry(file, entries.get("[Content_Types].xml"));
  const relationshipsBytes = await readZipEntry(file, entries.get("_rels/.rels"));
  const mainPartBytes = await readZipEntry(file, entries.get(format.marker));
  if (!contentTypesBytes || !relationshipsBytes || !mainPartBytes) return false;
  try {
    const contentTypes = decoder.decode(contentTypesBytes);
    const relationships = decoder.decode(relationshipsBytes);
    const mainPart = decoder.decode(mainPartBytes);
    const expectedType = OOXML_CONTENT_TYPES[format.marker];
    const partName = format.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const typeName = expectedType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const correctOverride = new RegExp(`<Override\\b(?=[^>]*\\bPartName=[\"']/${partName}[\"'])(?=[^>]*\\bContentType=[\"']${typeName}[\"'])[^>]*>`, "i").test(contentTypes);
    const targetPath = format.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasOfficeRelationship = new RegExp(`<Relationship\\b(?=[^>]*\\bType=[\"'][^\"']*\\/officeDocument[\"'])(?=[^>]*\\bTarget=[\"']\\/?${targetPath}[\"'])(?![^>]*\\bTargetMode=[\"']External[\"'])[^>]*>`, "i").test(relationships);
    const rootMatch = mainPart.match(/^\s*(?:<\?xml[^>]*>\s*)?<([\w.-]+:)?([\w.-]+)\b([^>]*)>/i);
    let hasExpectedRoot = false;
    if (rootMatch && rootMatch[2] === format.root) {
      const prefix = rootMatch[1]?.slice(0, -1);
      const namespacePattern = prefix
        ? new RegExp(`\\bxmlns:${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=[\"']${format.namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`)
        : new RegExp(`\\bxmlns=[\"']${format.namespace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\"']`);
      hasExpectedRoot = namespacePattern.test(rootMatch[3]);
    }
    return correctOverride && hasOfficeRelationship && hasExpectedRoot;
  } catch {
    return false;
  }
}

async function validateText(file) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, "");
    const startsWithActiveMarkup = /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html|<html\b|<svg\b|<script\b|<\?xml[^>]*>\s*<svg\b)/i.test(text);
    const containsActiveMarkup = /<\s*(?:script|svg|iframe|object|embed)\b/i.test(text);
    const hasBinaryControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text);
    return !startsWithActiveMarkup && !containsActiveMarkup && !hasBinaryControls;
  } catch {
    return false;
  }
}

export async function validateMaterialFile(file) {
  const extension = extensionOf(file?.name);
  if (extension === "doc" || extension === "ppt") {
    throw new Error(`Legacy .${extension.toUpperCase()} files cannot be reliably verified. Save the file as ${extension.toUpperCase()}X and try again.`);
  }
  const format = FORMATS[extension];
  if (!format) throw new Error("This file type is not supported.");
  checkMime(file.type, format.mime);

  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 65536)).arrayBuffer());
  let valid = false;
  switch (format.kind) {
    case "pdf": {
      const header = new TextDecoder().decode(head.subarray(0, 1024));
      const markerAt = header.indexOf("%PDF-");
      valid = markerAt >= 0 && /^[\s\uFEFF]*$/.test(header.slice(0, markerAt));
      break;
    }
    case "png": valid = startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); break;
    case "jpeg": valid = startsWith(head, [0xff, 0xd8, 0xff]); break;
    case "gif": valid = startsWith(head, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(head, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); break;
    case "webp": valid = startsWith(head, [0x52, 0x49, 0x46, 0x46]) && new TextDecoder().decode(head.subarray(8, 12)) === "WEBP"; break;
    case "ooxml": valid = startsWith(head, [0x50, 0x4b, 0x03, 0x04]) && await validateOoxml(file, format); break;
    case "text": valid = await validateText(file); break;
    default: valid = false;
  }
  if (!valid) throw new Error("The file content does not match its extension. HTML, SVG, executable, and mismatched files are not accepted.");
  return { extension, mime: format.mime };
}

export function createMaterialMetadata({ userId, name, subject, size, storagePath, courseId }) {
  return {
    user_id: userId,
    name,
    subject: subject || "",
    size,
    type: extensionOf(name).toUpperCase(),
    storage_path: storagePath,
    course_id: courseId || null,
    is_shared: false,
  };
}

export function mapMaterialRecord(item, signedUrl = "", storageError = "", downloadUrl = "", downloadError = "") {
  return {
    id: item.storage_path,
    name: item.name,
    subject: item.subject || "",
    size: Number(item.size) || 0,
    type: item.type || extensionOf(item.name).toUpperCase(),
    addedAt: item.created_at,
    isIndexed: Boolean(item.is_indexed),
    isShared: item.is_shared === true,
    userId: item.user_id,
    indexError: "",
    ...materialLinkState(signedUrl, downloadUrl, downloadError),
    path: item.storage_path,
    courseId: item.course_id || null,
    storageError,
  };
}

export function materialLinkState(previewUrl, attachmentUrl, attachmentError) {
  return {
    url: previewUrl || "",
    downloadUrl: attachmentError ? "" : attachmentUrl || "",
    downloadError: attachmentError ? "Download unavailable: a safe attachment link could not be created." : "",
  };
}

export async function resolveMaterialLinkRequests(previewRequest, attachmentRequest) {
  const results = await Promise.allSettled([previewRequest, attachmentRequest]);
  const preview = results[0].status === "fulfilled" ? results[0].value : null;
  const attachment = results[1].status === "fulfilled" ? results[1].value : null;
  return {
    previewUrl: preview?.error || results[0].status === "rejected" ? "" : preview?.data?.signedUrl || "",
    previewError: preview?.error || (results[0].status === "rejected" ? results[0].reason : null),
    downloadUrl: attachment?.error || results[1].status === "rejected" ? "" : attachment?.data?.signedUrl || "",
    downloadError: attachment?.error || (results[1].status === "rejected" ? results[1].reason : null),
  };
}

export function nextMaterialSharingValue(isShared) {
  return !isShared;
}

export function createPreviewLifecycle({
  fetchImpl = fetch,
  createUrl = (blob) => URL.createObjectURL(blob),
  revokeUrl = (url) => URL.revokeObjectURL(url),
  onChange = () => {},
}) {
  let active = true;
  let sequence = 0;
  let activeUrl = "";

  function releaseActiveUrl() {
    if (activeUrl) revokeUrl(activeUrl);
    activeUrl = "";
  }

  return {
    async open(material) {
      const request = ++sequence;
      if (!active) return;
      releaseActiveUrl();
      onChange({ status: "loading", material });
      try {
        const response = await fetchImpl(material.url);
        if (!response.ok) throw new Error("The preview could not be loaded. Download the file to open it.");
        const blob = await response.blob();
        if (!active || request !== sequence) return;
        const namedBlob = new Blob([blob], { type: blob.type });
        Object.defineProperty(namedBlob, "name", { value: material.name });
        const verified = await validateMaterialFile(namedBlob);
        if (!active || request !== sequence) return;
        if (!["pdf", "png", "jpg", "jpeg", "webp", "gif"].includes(verified.extension)) {
          throw new Error("Preview is unavailable for this format. Download the file to open it.");
        }
        const url = createUrl(new Blob([blob], { type: verified.mime }));
        if (!active || request !== sequence) {
          revokeUrl(url);
          return;
        }
        releaseActiveUrl();
        activeUrl = url;
        onChange({ status: "ready", material: { ...material, previewUrl: url } });
      } catch (error) {
        if (active && request === sequence) {
          releaseActiveUrl();
          onChange({ status: "error", material, error });
        }
      }
    },
    close() {
      sequence += 1;
      releaseActiveUrl();
    },
    dispose() {
      active = false;
      sequence += 1;
      releaseActiveUrl();
    },
  };
}
