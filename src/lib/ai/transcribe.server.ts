import { MAX_AUDIO_BYTES } from "./gateway.server";

/**
 * Transcription is not part of the OpenClaw gateway: `/v1/audio/*` returns 404
 * there. Speech-to-text goes to an OpenAI-compatible server instead, which is
 * Groq Whisper by default. The key stays on this side of the wire.
 *
 * Whisper answers once, so there is no partial transcript to stream; callers
 * get the finished string.
 */
const STT_BASE_URL = (process.env["STT_BASE_URL"] || "https://api.groq.com/openai/v1").replace(
  /\/$/,
  "",
);
const STT_MODEL = process.env["STT_MODEL"] || "whisper-large-v3-turbo";
const STT_KEY = process.env["GROQ_API_KEY"] || process.env["STT_API_KEY"] || "";

/** Upstream error text, capped so a proxy error page can never flood the console. */
async function upstreamError(response: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") detail = body.error;
    else if (
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
    )
      detail = body.error.message;
  } catch {
    detail = "";
  }
  const trimmed = detail.trim().slice(0, 300);
  return trimmed
    ? `Speech recognition failed: ${trimmed}`
    : `Speech recognition failed with ${response.status}.`;
}

export async function transcribe(file: File, signal?: AbortSignal): Promise<string> {
  if (!file.size || file.size > MAX_AUDIO_BYTES) throw new Error("Invalid audio file size");
  if (!file.type.startsWith("audio/")) throw new Error("Unexpected media MIME type");
  if (!STT_KEY) throw new Error("Speech recognition is not configured. Set GROQ_API_KEY.");

  const form = new FormData();
  form.append("model", STT_MODEL);
  form.append("file", file, file.name);
  form.append("response_format", "json");

  const response = await fetch(`${STT_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${STT_KEY}` },
    body: form,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(await upstreamError(response));

  const data = (await response.json()) as { text?: unknown };
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) throw new Error("No speech was recognised in that recording.");
  return text;
}
