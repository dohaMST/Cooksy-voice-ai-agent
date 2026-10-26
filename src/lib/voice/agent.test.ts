import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { streamAgentAnswer, transcribeRecording } from "./agent.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replaces fetch with a stub that answers every call with the same response. */
function stubFetch(handler: () => Response): { url: string } {
  const seen = { url: "" };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.url = String(input);
    return handler();
  }) as typeof fetch;
  return seen;
}

function recording() {
  return new File([new Uint8Array([1, 2, 3])], "note.wav", { type: "audio/wav" });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("transcribeRecording", () => {
  it("returns the transcript and reports it once", async () => {
    const seen = stubFetch(() => json({ text: "  two lemons  " }));
    const heard: string[] = [];
    const text = await transcribeRecording(recording(), (t) => heard.push(t));
    assert.equal(text, "two lemons");
    assert.deepEqual(heard, ["two lemons"]);
    assert.equal(seen.url, "/api/transcribe");
  });

  it("refuses an empty transcript", async () => {
    stubFetch(() => json({ text: "   " }));
    await assert.rejects(
      () => transcribeRecording(recording(), () => {}),
      /didn't hear any speech/,
    );
  });

  it("surfaces the server's error message instead of a blank failure", async () => {
    stubFetch(() =>
      json({ error: "Speech recognition is not configured. Set GROQ_API_KEY." }, 400),
    );
    await assert.rejects(() => transcribeRecording(recording(), () => {}), /not configured/);
  });
});

/** One SSE frame per entry, the way the console route re-emits provider events. */
function sse(frames: unknown[]): Response {
  return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const noop = () => {};

describe("streamAgentAnswer", () => {
  it("reports the provider's real reason instead of a blank stream failure", async () => {
    stubFetch(() =>
      sse([{ type: "error", error: "API rate limit reached. Please try again later." }]),
    );
    await assert.rejects(
      () =>
        streamAgentAnswer([{ role: "user", text: "what is in the pantry" }], {
          onThinking: noop,
          onAnswer: noop,
        }),
      /rate limit/,
    );
  });

  it("falls back to a plain failure when the error carries nothing to show", async () => {
    stubFetch(() => sse([{ type: "error", error: {} }]));
    await assert.rejects(
      () =>
        streamAgentAnswer([{ role: "user", text: "hello" }], {
          onThinking: noop,
          onAnswer: noop,
        }),
      /agent stream failed/,
    );
  });

  it("explains the gateway's generic internal error instead of echoing it", async () => {
    stubFetch(() =>
      sse([{ type: "error", error: { message: "internal error", type: "api_error" } }]),
    );
    await assert.rejects(
      () =>
        streamAgentAnswer([{ role: "user", text: "add 1kg banana" }], {
          onThinking: noop,
          onAnswer: noop,
        }),
      /quota|rate limit|openclaw logs/,
    );
  });
});
