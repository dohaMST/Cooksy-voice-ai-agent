/**
 * Kokoro answers with raw PCM chunks, so the console can start playing while the
 * rest of the sentence is still being synthesized. On a CPU that cannot keep up
 * with realtime that is the difference between hearing the reply in a second and
 * hearing it in twenty.
 */

/** Kokoro's PCM output: signed 16-bit little-endian, mono, 24 kHz. */
export const KOKORO_SAMPLE_RATE = 24000;

/**
 * Audio buffered before the first chunk plays. Synthesis can be slower than
 * playback on a CPU, so a short lead stops the reply from starting with a gap.
 */
const PREBUFFER_SECONDS = 0.8;

/** How often playback checks whether the queued audio has drained. */
const DRAIN_POLL_MS = 60;

/**
 * Turns a chunk of int16 PCM into float samples.
 *
 * Stream chunks are not guaranteed to end on a sample boundary, so an odd
 * trailing byte is carried into the next call instead of being dropped.
 */
export function decodePCM(pending: Uint8Array, incoming: Uint8Array) {
  const bytes = new Uint8Array(pending.length + incoming.length);
  bytes.set(pending);
  bytes.set(incoming, pending.length);
  const usable = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
  const samples = new Float32Array(usable / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return { samples, pending: bytes.slice(usable) };
}

let shared: AudioContext | null = null;

/** One context for the whole console, at Kokoro's rate so chunks need no resampling. */
function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!shared || shared.state === "closed")
    shared = new AudioContext({ sampleRate: KOKORO_SAMPLE_RATE });
  if (shared.state === "suspended") void shared.resume();
  return shared;
}

/**
 * Unlocks audio playback for the reply that follows the current gesture.
 *
 * Browsers only allow sound to start from a user gesture, so this runs on press
 * rather than when the answer is ready. It also resumes the device voice queue.
 */
export function unlockSpeaker(): void {
  if (typeof window === "undefined") return;
  ensureContext();
  try {
    window.speechSynthesis?.resume();
  } catch {
    /* This browser has no device voices; the chosen engine reports the failure. */
  }
}

/**
 * Plays a streamed PCM body as it arrives.
 *
 * Chunks are scheduled back to back. If synthesis falls behind playback the
 * queue drains, and the next chunk is scheduled from the current time instead of
 * overlapping - the reply pauses rather than glitching.
 */
export async function playPcmStream(
  response: Response,
  options: { signal?: AbortSignal; sampleRate?: number } = {},
): Promise<void> {
  const context = ensureContext();
  if (!context) throw new Error("This browser cannot play audio.");
  if (!response.body) throw new Error("Kokoro returned no audio.");

  // A suspended context never advances its clock, so the drain wait below would
  // never end. Fail loudly instead of hanging on "Playing...".
  if (context.state !== "running") await context.resume().catch(() => undefined);
  if (context.state !== "running")
    throw new Error("The browser blocked audio playback. Click the page and try again.");

  const rate = options.sampleRate ?? KOKORO_SAMPLE_RATE;
  const playing = new Set<AudioBufferSourceNode>();
  const queue: Float32Array[] = [];
  let buffered = 0;
  let started = false;
  let nextTime = 0;
  let endsAt = 0;

  const stopAll = () => {
    for (const source of playing) {
      try {
        source.stop();
      } catch {
        /* Already finished. */
      }
    }
    playing.clear();
  };

  const schedule = (samples: Float32Array) => {
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    if (nextTime < context.currentTime) nextTime = context.currentTime + 0.02;
    source.start(nextTime);
    nextTime += buffer.duration;
    endsAt = nextTime;
    playing.add(source);
    source.onended = () => playing.delete(source);
  };

  const flush = () => {
    for (const samples of queue) schedule(samples);
    queue.length = 0;
    buffered = 0;
  };

  const onAbort = () => stopAll();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const reader = response.body.getReader();
  let pending = new Uint8Array(0);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || options.signal?.aborted) break;
      const decoded = decodePCM(pending, value);
      pending = decoded.pending;
      if (!decoded.samples.length) continue;
      if (started) {
        schedule(decoded.samples);
        continue;
      }
      queue.push(decoded.samples);
      buffered += decoded.samples.length / rate;
      if (buffered >= PREBUFFER_SECONDS) {
        started = true;
        flush();
      }
    }
    if (!started && queue.length) {
      started = true;
      flush();
    }
  } finally {
    reader.releaseLock();
  }

  while (!options.signal?.aborted && context.state === "running" && context.currentTime < endsAt) {
    await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
  }
  options.signal?.removeEventListener("abort", onAbort);
}
