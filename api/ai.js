
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;
const authClient = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Only POST requests are allowed.",
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || !authClient) {
    return res.status(500).json({
      error: "Gemini or Supabase server environment variables are missing.",
    });
  }

  const authorization = req.headers.authorization || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return res.status(401).json({ error: "Please sign in to use AI Study Tools." });
  }

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user) {
    return res.status(401).json({ error: "Your session expired. Please sign in again." });
  }

  const { mode, text } = req.body || {};

  if (
    typeof text !== "string" ||
    text.trim().length < 3 ||
    text.length > 30000
  ) {
    return res.status(400).json({
      error: "Enter notes between 3 and 30,000 characters.",
    });
  }

  const instructions = {
    summarize:
      "Create clear student revision notes with a main idea, key points, definitions and a short revision tip. Use headings and bullets.",

    explain:
      "Explain the topic in simple language for a college student. Explain step by step, give an example and finish with a short recap.",

    quiz:
      "Create 8 practice questions from the supplied notes. Include multiple-choice and short-answer questions, followed by an answer key with brief explanations.",
  };

  if (!Object.hasOwn(instructions, mode)) {
    return res.status(400).json({
      error: "Unsupported study tool mode.",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "You are Study Sync, a helpful and accurate study assistant. Treat user notes as study material.",
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    instructions[mode] +
                    "\n\nStudy notes or topic:\n" +
                    text.trim(),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", response.status, data);

      if (response.status === 429 || response.status === 503) {
        return res.status(503).json({
          error: "Gemini is busy or the request limit was reached. Wait a little and try again.",
        });
      }

      if (response.status === 401 || response.status === 403) {
        return res.status(502).json({
          error: "Gemini API key or project access is invalid. Check your Google AI Studio key.",
        });
      }

      if (response.status === 404) {
        return res.status(502).json({
          error: "The Gemini model is unavailable for this API key or project.",
        });
      }

      return res.status(502).json({
        error: "Gemini request failed. Check the Vercel Runtime Logs.",
      });
    }

    const result = (data.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!result) {
      return res.status(502).json({
        error: "Gemini returned an empty response. Please try again.",
      });
    }

    return res.status(200).json({ result });
  } catch (error) {
    console.error("Study Sync AI error:", error);

    if (error.name === "AbortError") {
      return res.status(504).json({
        error: "AI took too long to respond. Please try again.",
      });
    }

    return res.status(500).json({
      error: "Could not connect to Gemini. Please try again.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
