import { useMemo } from "react";
import { useLocal } from "@/lib/settings/store";
import { playPcmStream, unlockSpeaker } from "@/lib/voice/speak";

export type VoiceEngine = "browser" | "kokoro";
export type AsrEngine = "cloud" | "local";
export type AgentProfile = { label: string };
export type VoiceSettings = {
  agent: string;
  engine: VoiceEngine;
  rate: number;
  standbyPause: number;
  browserVoice: string;
  kokoroUrl: string;
  kokoroVoice: string;
  asrEngine: AsrEngine;
  asrUrl: string;
  asrModel: string;
};

/**
 * The two agents this console can talk to.
 *
 * The roster is fixed here on purpose: each agent's behaviour lives in its
 * gateway workspace (`openclaw/agents/<id>/AGENTS.md` + `SOUL.md`), and its
 * tools are granted in `openclaw.patch.json5`. Adding an agent in the browser
 * could only produce a name the gateway has never heard of.
 */
export const AGENTS: Record<string, AgentProfile> = {
  cook: { label: "Cooksy Cook" },
  planner: { label: "Cooksy Planner" },
};

export function getAgents(): Record<string, AgentProfile> {
  return AGENTS;
}

export const ENGINE_LABEL: Record<VoiceEngine, string> = {
  browser: "Native · installed device voices",
  kokoro: "Kokoro · local/self-hosted TTS server",
};

const VOICE_KEY = "openclaw.voice";

/**
 * The ASR server the retired default pointed at. Nothing has ever listened on
 * that port, so every microphone turn failed with a bare network error.
 *
 * Settings persist in localStorage, so changing DEFAULT_VOICE alone would leave
 * existing consoles broken. This repairs the exact legacy value once and then
 * never runs again, so choosing "local" afterwards is still honoured.
 */
const LEGACY_ASR_URL = "http://localhost:8000/v1";
const ASR_REPAIR_KEY = "openclaw.asr.repaired";

function repairLegacyAsr(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(ASR_REPAIR_KEY)) return;
    const raw = window.localStorage.getItem(VOICE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<VoiceSettings> | null;
      if (saved?.asrEngine === "local" && saved.asrUrl === LEGACY_ASR_URL) {
        window.localStorage.setItem(VOICE_KEY, JSON.stringify({ ...saved, asrEngine: "cloud" }));
      }
    }
    window.localStorage.setItem(ASR_REPAIR_KEY, "1");
  } catch {
    /* Storage may be unavailable or hold a corrupt entry; the hook falls back to defaults. */
  }
}

repairLegacyAsr();

export const DEFAULT_VOICE: VoiceSettings = { agent: "cook", engine: "browser", rate: 1, standbyPause: 900, browserVoice: "", kokoroUrl: "http://localhost:8880", kokoroVoice: "af_heart", asrEngine: "cloud", asrUrl: "http://localhost:8000/v1", asrModel: "whisper-1" };

/**
 * Saved voice settings, with a stale agent id healed to the default.
 *
 * Settings live in localStorage, so anyone who used the retired roster still
 * has `agent: "general"` saved. Without this the first turn would route to an
 * agent the gateway does not have. The value is memoised because
 * useSyncExternalStore compares snapshots by identity.
 */
export function useVoiceSettings(): [VoiceSettings, (next: VoiceSettings | ((prev: VoiceSettings) => VoiceSettings)) => void] {
  const [stored, update] = useLocal(VOICE_KEY, DEFAULT_VOICE);
  const value = useMemo(
    () => (stored.agent in AGENTS ? stored : { ...stored, agent: DEFAULT_VOICE.agent }),
    [stored],
  );
  return [value, update];
}

function speakBrowser(text: string, v: VoiceSettings, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (!("speechSynthesis" in window)) return reject(new Error("This browser has no device voice."));
    const u = new SpeechSynthesisUtterance(text);
    u.rate = v.rate;
    const voice = speechSynthesis.getVoices().find((x) => x.name === v.browserVoice);
    if (voice) u.voice = voice;
    u.onend = () => resolve();
    u.onerror = (e) => (e.error === "interrupted" || e.error === "canceled" ? resolve() : reject(new Error(`Device voice failed: ${e.error}`)));
    signal?.addEventListener("abort", () => speechSynthesis.cancel(), { once: true });
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

async function speakKokoro(text: string, v: VoiceSettings, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${v.kokoroUrl.replace(/\/$/, "")}/v1/audio/speech`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: signal ?? null,
      body: JSON.stringify({ model: "kokoro", input: text, voice: v.kokoroVoice, speed: v.rate, response_format: "pcm", stream: true }),
    });
  } catch (e) {
    if (signal?.aborted) return;
    throw new Error(`Couldn't reach the Kokoro server at ${v.kokoroUrl}.`, { cause: e });
  }
  if (!res.ok) throw new Error(`Kokoro returned ${res.status}`);
  await playPcmStream(res, signal ? { signal } : {});
}

/** Speaks with the chosen engine only — a failure is reported, never silently swapped. */
export function speakWith(v: VoiceSettings, text: string, signal?: AbortSignal) {
  // Browsers gate audio on a user gesture, and the caller is as close to one as we get.
  unlockSpeaker();
  if (v.engine === "kokoro") return speakKokoro(text, v, signal);
  if (v.engine === "browser") return speakBrowser(text, v, signal);
  // A stale saved setting can still say "cloud", which no longer exists.
  return Promise.reject(new Error("Pick a voice engine in settings: device voices or Kokoro."));
}
