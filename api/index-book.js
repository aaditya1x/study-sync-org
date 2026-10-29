
import { createClient } from "@supabase/supabase-js";
import PDFParser from "pdf2json";
import { logApiFailure, missingServerEnv, readServerEnv, reportMissingServerEnv } from "../server/apiDiagnostics.js";

const supabaseUrl = readServerEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
const anonKey = readServerEnv(
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
);
const serviceKey = readServerEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");

const authClient =
  supabaseUrl && anonKey
    ? createClient(supabaseUrl, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

const admin =
  supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

function splitIntoChunks(text, maxLength = 1400) {
  const words = text.split(/\s+/);
  const chunks = [];
  let current = "";

  for (const word of words) {
    if ((current + " " + word).trim().length > maxLength) {
      if (current.trim()) chunks.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

function extractPdfPages(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser(null, true);
    let settled = false;

    parser.once("pdfParser_dataError", (event) => {
      if (settled) return;
      settled = true;
      const error = event?.parserError || event;
      parser.destroy();
      reject(error instanceof Error ? error : new Error("PDF text extraction failed."));
    });

    parser.once("pdfParser_dataReady", (document) => {
      if (settled || !document) return;
      settled = true;

      const extracted = parser.getRawTextContent();
      const pageBreak = /\r?\n-+Page \(\d+\) Break-+\r?\n/g;
      const matches = [...extracted.matchAll(pageBreak)];
      const pages = [];
      let offset = 0;

      for (const match of matches) {
        pages.push(extracted.slice(offset, match.index).trim());
        offset = match.index + match[0].length;
      }

      if (pages.length < (document.Pages || []).length) {
        pages.push(extracted.slice(offset).trim());
      }

      parser.destroy();
      if (pages.length !== (document.Pages || []).length) {
        reject(new Error("PDF parser returned an unexpected page count."));
        return;
      }

      resolve(pages);
    });

    try {
      parser.parseBuffer(buffer, 1);
    } catch (error) {
      if (!settled) {
        settled = true;
        parser.destroy();
        reject(error);
      }
    }
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Only POST requests are allowed.",
    });
  }

  const missing = missingServerEnv({
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: anonKey,
    SUPABASE_SECRET_KEY: serviceKey,
  });
  if (missing.length || !authClient || !admin) {
    if (!missing.length) missing.push("SUPABASE_URL (valid URL)");
    return reportMissingServerEnv(res, "PDF indexing", missing);
  }

  // Require a real Supabase Auth access token.
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      error: "Please log in before indexing a PDF.",
    });
  }

  let user;
  let authError;
  try {
    const { data, error } = await authClient.auth.getUser(match[1]);
    user = data?.user;
    authError = error;
  } catch (error) {
    logApiFailure("supabase_auth_unavailable", error, { route: "/api/index-book" });
    return res.status(503).json({ code: "AUTH_SERVICE_UNAVAILABLE", error: "Supabase authentication is temporarily unavailable. Try again shortly." });
  }

  if (authError || !user) {
    return res.status(401).json({
      error: "Your session is invalid or expired. Please log in again.",
    });
  }

  const { storage_path } = req.body || {};

  if (
    typeof storage_path !== "string" ||
    !storage_path.trim() ||
    storage_path.startsWith("/") ||
    storage_path.split("/").includes("..")
  ) {
    return res.status(400).json({
      error: "A valid storage_path is required.",
    });
  }

  let failureStage = "material_lookup_failed";
  try {
    // Verify that this file belongs to the authenticated user.
    const { data: material, error: materialError } = await admin
      .from("study_materials")
      .select("name, subject, storage_path, user_id, type")
      .eq("storage_path", storage_path)
      .eq("user_id", user.id)
      .maybeSingle();

    if (materialError) {
      logApiFailure("material_lookup_failed", materialError, { route: "/api/index-book" });
      return res.status(500).json({
        error: "Could not verify file ownership.",
      });
    }

    if (!material) {
      return res.status(404).json({
        error: "File not found for your account.",
      });
    }

    if (
      material.type?.toLowerCase() !== "pdf" &&
      !material.name.toLowerCase().endsWith(".pdf")
    ) {
      return res.status(400).json({
        error: "Only PDF files can be indexed.",
      });
    }

    failureStage = "storage_download_failed";
    const { data: file, error: downloadError } = await admin.storage
      .from("study-materials")
      .download(storage_path);

    if (downloadError || !file) {
      logApiFailure("storage_download_failed", downloadError, { route: "/api/index-book" });
      return res.status(502).json({
        code: "PDF_STORAGE_RETRIEVAL_FAILED",
        error: "Could not download the PDF from Storage.",
      });
    }

    if (file.size > 50 * 1024 * 1024) {
      return res.status(413).json({
        error: "PDF exceeds the 50 MB indexing limit.",
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.subarray(0, 5).toString() !== "%PDF-") {
      return res.status(400).json({
        error: "The selected file is not a valid PDF.",
      });
    }


    failureStage = "pdf_text_extraction_failed";
    const pages = await extractPdfPages(buffer);


    const rows = [];

    pages.forEach((pageText, index) => {
      for (const content of splitIntoChunks(pageText)) {
        rows.push({
          user_id: user.id,
          storage_path,
          book_name: material.name,
          subject: material.subject,
          page_number: index + 1,
          content,
        });
      }
    });

    if (!rows.length) {
      return res.status(422).json({
        error:
          "No selectable text was found. This may be a scanned PDF and require OCR.",
      });
    }

    failureStage = "chunk_persistence_failed";
    // Remove only this user's previous index for this file.
    const { error: deleteError } = await admin
      .from("book_chunks")
      .delete()
      .eq("user_id", user.id)
      .eq("storage_path", storage_path);

    if (deleteError) throw deleteError;

    for (let i = 0; i < rows.length; i += 100) {
      const { error: insertError } = await admin
        .from("book_chunks")
        .insert(rows.slice(i, i + 100));

      if (insertError) throw insertError;
    }

    const { error: updateError } = await admin
      .from("study_materials")
      .update({ is_indexed: true })
      .eq("user_id", user.id)
      .eq("storage_path", storage_path);

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      book_name: material.name,
      pages_processed: pages.length,
      chunks_saved: rows.length,
    });
  } catch (error) {
    logApiFailure(failureStage, error, { route: "/api/index-book" });

    return res.status(500).json({
      code: failureStage.toUpperCase(),
      error: failureStage === "pdf_text_extraction_failed"
        ? "Could not extract text from this PDF. It may be damaged or image-only."
        : "PDF indexing failed. Check the Vercel Function Logs.",
    });
  }
}
