import test from "node:test";
import assert from "node:assert/strict";
import {
  createMaterialMetadata,
  createPreviewLifecycle,
  mapMaterialRecord,
  materialLinkState,
  nextMaterialSharingValue,
  resolveMaterialLinkRequests,
  validateMaterialFile,
} from "../src/components/MaterialsPanel/fileValidation.js";

function makeFile(name, type, bytes) {
  const blob = new Blob([Array.isArray(bytes) ? new Uint8Array(bytes) : bytes], { type });
  Object.defineProperty(blob, "name", { value: name });
  return blob;
}

const encoder = new TextEncoder();
function concat(...parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function put16(view, offset, value) { view.setUint16(offset, value, true); }
function put32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function zipFixture(paths, { compressed = false, contentTypeOverride } = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const mainPart = paths.find((path) => ["word/document.xml", "ppt/presentation.xml", "xl/workbook.xml"].includes(path));
  const contentTypeByPart = {
    "word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    "ppt/presentation.xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
    "xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  };
  for (const path of paths) {
    const name = encoder.encode(path);
    const rootByPart = {
      "word/document.xml": ['w:document', "http://schemas.openxmlformats.org/wordprocessingml/2006/main"],
      "ppt/presentation.xml": ['p:presentation', "http://schemas.openxmlformats.org/presentationml/2006/main"],
      "xl/workbook.xml": ['workbook', "http://schemas.openxmlformats.org/spreadsheetml/2006/main"],
    };
    const [root, namespace] = rootByPart[mainPart] || [];
    const content = path === "[Content_Types].xml"
      ? `<Types><Override PartName="/${mainPart}" ContentType="${contentTypeOverride || contentTypeByPart[mainPart]}"/></Types>`
      : path === "_rels/.rels"
        ? `<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${mainPart}"/></Relationships>`
        : path === mainPart
          ? `<${root} xmlns${root.includes(":") ? `:${root.split(":")[0]}` : ""}="${namespace}"/>`
          : "<fixture/>";
    const data = encoder.encode(content);
    const packedData = compressed ? await deflateRaw(data) : data;
    const method = compressed ? 8 : 0;
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    put32(localView, 0, 0x04034b50); put16(localView, 4, 20); put16(localView, 8, method); put32(localView, 14, checksum);
    put32(localView, 18, packedData.length); put32(localView, 22, data.length); put16(localView, 26, name.length);
    local.set(name, 30); local.set(packedData, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    put32(centralView, 0, 0x02014b50); put16(centralView, 4, 20); put16(centralView, 6, 20); put16(centralView, 10, method);
    put32(centralView, 16, checksum); put32(centralView, 20, packedData.length); put32(centralView, 24, data.length);
    put16(centralView, 28, name.length); put32(centralView, 42, offset); central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralDirectory = concat(...centralParts);
  const eocd = new Uint8Array(22);
  const endView = new DataView(eocd.buffer);
  put32(endView, 0, 0x06054b50); put16(endView, 8, paths.length); put16(endView, 10, paths.length);
  put32(endView, 12, centralDirectory.length); put32(endView, 16, offset);
  return concat(...localParts, centralDirectory, eocd);
}
function officeEntries(mainPart) { return ["[Content_Types].xml", "_rels/.rels", mainPart]; }
function material(name, url = "signed-preview") { return { name, url }; }
function responseFor(blob) { return { ok: true, blob: async () => blob }; }

test("accepts PDF and common raster image signatures", async () => {
  assert.equal((await validateMaterialFile(makeFile("notes.pdf", "application/pdf", "%PDF-1.7\n"))).mime, "application/pdf");
  assert.equal((await validateMaterialFile(makeFile("photo.png", "image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).mime, "image/png");
  assert.equal((await validateMaterialFile(makeFile("photo.jpg", "image/jpeg", [0xff, 0xd8, 0xff, 0xd9]))).mime, "image/jpeg");
});

test("rejects legacy DOC/PPT based only on ambiguous OLE signatures", async () => {
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  await assert.rejects(validateMaterialFile(makeFile("notes.doc", "application/msword", ole)), /cannot be reliably verified/);
  await assert.rejects(validateMaterialFile(makeFile("slides.ppt", "application/vnd.ms-powerpoint", ole)), /cannot be reliably verified/);
});

test("accepts structurally consistent DOCX and PPTX ZIP packages", async () => {
  assert.equal((await validateMaterialFile(makeFile("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", await zipFixture(officeEntries("word/document.xml"))))).extension, "docx");
  assert.equal((await validateMaterialFile(makeFile("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", await zipFixture(officeEntries("ppt/presentation.xml"))))).extension, "pptx");
  await assert.rejects(validateMaterialFile(makeFile("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", await zipFixture(officeEntries("ppt/presentation.xml")))));
});

test("validates compressed OOXML entries and checks their declared main type", async () => {
  const docx = await zipFixture(officeEntries("word/document.xml"), { compressed: true });
  assert.equal((await validateMaterialFile(makeFile("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx))).extension, "docx");
  const wrongType = await zipFixture(officeEntries("word/document.xml"), {
    compressed: true,
    contentTypeOverride: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  });
  await assert.rejects(validateMaterialFile(makeFile("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", wrongType)));
});

test("rejects HTML and SVG disguised as supported formats", async () => {
  await assert.rejects(validateMaterialFile(makeFile("notes.pdf", "application/pdf", "<!doctype html><script>alert(1)</script>")));
  await assert.rejects(validateMaterialFile(makeFile("image.png", "image/png", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")));
  await assert.rejects(validateMaterialFile(makeFile("readme.txt", "text/plain", "<!-- comment --><html><body>active</body></html>")));
});

test("accepts plain text and CSV while rejecting invalid encoding and controls", async () => {
  assert.equal((await validateMaterialFile(makeFile("notes.txt", "text/plain", "Study notes — week 1\n"))).mime, "text/plain");
  assert.equal((await validateMaterialFile(makeFile("data.csv", "text/csv", "name,score\nAda,100\n"))).mime, "text/csv");
  await assert.rejects(validateMaterialFile(makeFile("bad.txt", "text/plain", [0x61, 0x00, 0x62])));
  await assert.rejects(validateMaterialFile(makeFile("bad.csv", "text/csv", [0xff, 0xfe, 0xfd])));
});

test("rejects declared MIME mismatches and executable signatures", async () => {
  await assert.rejects(validateMaterialFile(makeFile("photo.png", "image/jpeg", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), /MIME type does not match/);
  await assert.rejects(validateMaterialFile(makeFile("notes.pdf", "application/pdf", [0x4d, 0x5a, 0x90, 0x00])));
  await assert.rejects(validateMaterialFile(makeFile("program.exe", "application/octet-stream", [0x4d, 0x5a, 0x90, 0x00])), /not supported/);
});

test("preview lifecycle revokes replaced and closed Blob URLs", async () => {
  const revoked = [];
  let created = 0;
  const lifecycle = createPreviewLifecycle({
    fetchImpl: async () => responseFor(new Blob(["%PDF-1.7\n"], { type: "application/pdf" })),
    createUrl: () => `blob:test-${++created}`,
    revokeUrl: (url) => revoked.push(url),
  });
  await lifecycle.open(material("first.pdf"));
  await lifecycle.open(material("second.pdf"));
  assert.deepEqual(revoked, ["blob:test-1"]);
  lifecycle.close();
  assert.deepEqual(revoked, ["blob:test-1", "blob:test-2"]);
  lifecycle.dispose();
});

test("preview lifecycle revokes its URL if a state callback throws after creation", async () => {
  const revoked = [];
  const lifecycle = createPreviewLifecycle({
    fetchImpl: async () => responseFor(new Blob(["%PDF-1.7\n"], { type: "application/pdf" })),
    createUrl: () => "blob:callback-error",
    revokeUrl: (url) => revoked.push(url),
    onChange: ({ status }) => { if (status === "ready") throw new Error("render failed"); },
  });
  await lifecycle.open(material("notes.pdf"));
  assert.deepEqual(revoked, ["blob:callback-error"]);
  lifecycle.dispose();
});

test("pending preview after unmount neither creates URLs nor updates state", async () => {
  let resolveFetch;
  const changes = [];
  let created = 0;
  const lifecycle = createPreviewLifecycle({
    fetchImpl: () => new Promise((resolve) => { resolveFetch = resolve; }),
    createUrl: () => { created += 1; return "blob:late"; },
    onChange: (change) => changes.push(change.status),
  });
  const pending = lifecycle.open(material("pending.pdf"));
  lifecycle.dispose();
  resolveFetch(responseFor(new Blob(["%PDF-1.7\n"], { type: "application/pdf" })));
  await pending;
  assert.deepEqual(changes, ["loading"]);
  assert.equal(created, 0);
});

test("stale pending preview is ignored after a replacement request", async () => {
  const pending = [];
  const changes = [];
  let created = 0;
  const lifecycle = createPreviewLifecycle({
    fetchImpl: () => new Promise((resolve) => pending.push(resolve)),
    createUrl: () => `blob:replacement-${++created}`,
    onChange: ({ status, material: current }) => changes.push(`${status}:${current.name}`),
  });
  const oldRequest = lifecycle.open(material("old.pdf"));
  const newRequest = lifecycle.open(material("new.pdf"));
  pending[1](responseFor(new Blob(["%PDF-1.7\n"], { type: "application/pdf" })));
  await newRequest;
  pending[0](responseFor(new Blob(["%PDF-1.7\n"], { type: "application/pdf" })));
  await oldRequest;
  assert.equal(created, 1);
  assert.deepEqual(changes, ["loading:old.pdf", "loading:new.pdf", "ready:new.pdf"]);
  lifecycle.dispose();
});

test("preview fetch failures produce an error without a Blob URL", async () => {
  const changes = [];
  const lifecycle = createPreviewLifecycle({ fetchImpl: async () => { throw new Error("signed URL unavailable"); }, onChange: (change) => changes.push(change) });
  await lifecycle.open(material("failed.pdf"));
  assert.equal(changes.at(-1).status, "error");
  lifecycle.dispose();
});

test("attachment signing failure never falls back to the inline preview URL", () => {
  assert.deepEqual(materialLinkState("inline-signed-url", "", "attachment-signing-failed"), {
    url: "inline-signed-url",
    downloadUrl: "",
    downloadError: "Download unavailable: a safe attachment link could not be created.",
  });
  assert.equal(materialLinkState("", "", "").downloadUrl, "");
});

test("preview signing failure preserves an independently available attachment URL", async () => {
  const links = await resolveMaterialLinkRequests(
    Promise.resolve({ data: null, error: new Error("preview signing failed") }),
    Promise.resolve({ data: { signedUrl: "attachment-url" }, error: null }),
  );
  assert.equal(links.previewUrl, "");
  assert.equal(links.downloadUrl, "attachment-url");
  assert.ok(links.previewError);
});

test("attachment signing rejection returns no unsafe inline fallback", async () => {
  const links = await resolveMaterialLinkRequests(
    Promise.resolve({ data: { signedUrl: "inline-url" }, error: null }),
    Promise.reject(new Error("attachment signing failed")),
  );
  assert.equal(links.previewUrl, "inline-url");
  assert.equal(links.downloadUrl, "");
  assert.ok(links.downloadError);
});

test("new metadata preserves existing schema keys and defaults to private", () => {
  assert.deepEqual(createMaterialMetadata({ userId: "u1", name: "notes.pdf", subject: "Math", size: 20, storagePath: "u1/uuid-notes.pdf", courseId: "c1" }), {
    user_id: "u1", name: "notes.pdf", subject: "Math", size: 20, type: "PDF", storage_path: "u1/uuid-notes.pdf", course_id: "c1", is_shared: false,
  });
});

test("existing material rows retain their storage path, metadata, and sharing state", () => {
  const mapped = mapMaterialRecord({
    storage_path: "u1/old-path.pdf", name: "old.pdf", subject: "Physics", size: 128,
    type: "PDF", created_at: "2026-01-01T00:00:00Z", is_indexed: true, is_shared: true,
    user_id: "u1", course_id: "course-1",
  }, "preview-url", "", "attachment-url");
  assert.equal(mapped.path, "u1/old-path.pdf");
  assert.equal(mapped.id, "u1/old-path.pdf");
  assert.equal(mapped.isShared, true);
  assert.equal(mapped.isIndexed, true);
  assert.equal(mapped.courseId, "course-1");
  assert.equal(mapped.url, "preview-url");
  assert.equal(mapped.downloadUrl, "attachment-url");
});

test("explicit sharing control toggles private and shared states", () => {
  assert.equal(nextMaterialSharingValue(false), true);
  assert.equal(nextMaterialSharingValue(true), false);
});
