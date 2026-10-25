import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { transcribeRecording } from "./agent.ts";

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
