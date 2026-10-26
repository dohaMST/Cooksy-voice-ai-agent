import { createParser } from "eventsource-parser";

export type Turn = { role: "user" | "assistant"; text: string };

export async function readSse(response: Response, onEvent: (data: string) => void) {
  if (!response.body) throw new Error("Empty response stream");
  const parser = createParser({ onEvent: (event) => onEvent(event.data) });
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      parser.feed(next.value);
    }
    parser.reset({ consume: true });
  } finally {
    reader.releaseLock();
  }
}

export async function readError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* ignore */
  }
  return fallback;
}

/** Uploads the recording and returns the finished transcript. */
export async function transcribeRecording(
  file: File,
  onPartial: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: form,
    ...(signal ? { signal } : {}),
  });
  if (!response.ok)
    throw new Error(await readError(response, "Could not understand that recording"));

  const data = (await response.json()) as { text?: unknown };
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) throw new Error("I didn't hear any speech in that recording");
  onPartial(text);
  return text;
}

/**
 * The gateway's OpenAI-compatible stream answers any failed run with a hardcoded
 * `{"message":"internal error","type":"api_error"}` chunk (OpenClaw 2026.8.2), so
 * the provider's real reason — a 429, a quota — never reaches the browser. Say
 * that plainly instead of repeating two words that explain nothing.
 */
const GENERIC_GATEWAY_FAILURE = /^(internal error|internal server error|agent run failed)$/i;
const GENERIC_GATEWAY_HINT =
  'The gateway failed this turn with a generic "internal error" and did not pass on the provider\'s reason — usually an exhausted Groq quota. Check `openclaw logs`, then retry.';

/** The server's own reason for a failed stream, when it sent one. */
function streamFailure(payload: { error?: unknown }): string {
  let message = "";
  if (typeof payload.error === "string") message = payload.error;
  else if (payload.error && typeof payload.error === "object") {
    const inner = (payload.error as { message?: unknown }).message;
    if (typeof inner === "string") message = inner;
  }
  const trimmed = message.trim();
  if (!trimmed) return "The agent stream failed";
  return GENERIC_GATEWAY_FAILURE.test(trimmed) ? GENERIC_GATEWAY_HINT : trimmed;
}

/** Streams the agent answer, reporting reasoning summary text and answer deltas separately. */
export async function streamAgentAnswer(
  turns: Turn[],
  handlers: { onThinking: (text: string) => void; onAnswer: (text: string) => void },
  signal?: AbortSignal,
  model?: string,
): Promise<string> {
  const response = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turns, model }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(await readError(response, "The agent could not answer"));

  let answer = "";
  let thinking = "";
  await readSse(response, (data) => {
    const payload = JSON.parse(data) as {
      type?: string;
      delta?: string;
      text?: string;
      error?: unknown;
    };
    if (payload.error || payload.type === "error") {
      // The server forwards the provider's own reason (a rate limit, a rejected tool
      // payload). Swallowing it made a 429 read as "The agent stream failed".
      throw new Error(streamFailure(payload));
    }
    if (payload.type === "response.reasoning_summary_text.delta" && payload.delta) {
      thinking += payload.delta;
      handlers.onThinking(thinking);
    }
    if (payload.type === "response.output_text.delta" && payload.delta) {
      answer += payload.delta;
      handlers.onAnswer(answer);
    }
    if (payload.type === "response.output_text.done" && typeof payload.text === "string") {
      answer = payload.text;
      handlers.onAnswer(answer);
    }
  });
  const final = answer.trim();
  if (!final) throw new Error("The agent returned an empty answer");
  return final;
}
