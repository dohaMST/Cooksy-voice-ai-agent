/**
 * Chat history kept in this browser.
 *
 * The console holds the transcript in React state, which vanished on every route
 * change and reload. This module is the storage contract only: pure functions over
 * plain data, so the trimming and the validation can be tested without a browser.
 *
 * What is deliberately NOT stored: `reasoning` (OpenClaw never sends one, so it is
 * always empty) — everything else survives, including the console-written
 * approval outcomes (`system: true`) because they are part of the record.
 */
import type { Screen } from "../voice/screen.ts";

export const CHAT_KEY = "openclaw.chat.v1";
export const CHAT_VERSION = 1;
/** A chat longer than this is trimmed from the front; the newest message always survives. */
export const MAX_MESSAGES = 60;
/** One answer cannot be longer than this before storage; the bubble itself is untouched. */
export const MAX_TEXT = 4000;

export type StoredStep = {
  label: string;
  detail?: string;
  at: number;
  tone?: "ok" | "warn" | "error";
};

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  sender?: string;
  system?: boolean;
  liked?: boolean;
  screen?: Screen;
  steps?: StoredStep[];
};

export type StoredChat = {
  v: number;
  messages: StoredMessage[];
};

/** Everything the console keeps in memory, trimmed down to what is worth restoring. */
export function toStored(messages: StoredMessage[]): StoredChat {
  const kept = messages.slice(-MAX_MESSAGES).map((message) => {
    const stored: StoredMessage = {
      id: message.id,
      role: message.role,
      text: message.text.length > MAX_TEXT ? `${message.text.slice(0, MAX_TEXT)}…` : message.text,
      at: message.at,
    };
    if (message.sender) stored.sender = message.sender;
    if (message.system) stored.system = true;
    if (message.liked) stored.liked = true;
    if (message.screen) stored.screen = message.screen;
    if (message.steps?.length) stored.steps = message.steps;
    return stored;
  });
  return { v: CHAT_VERSION, messages: kept };
}

function isMessage(value: unknown): value is StoredMessage {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["id"] === "string" &&
    entry["id"].length > 0 &&
    (entry["role"] === "user" || entry["role"] === "assistant") &&
    typeof entry["text"] === "string" &&
    typeof entry["at"] === "number" &&
    Number.isFinite(entry["at"])
  );
}

/**
 * Reads whatever localStorage returned. Anything unrecognised is dropped rather
 * than repaired: half a transcript is worse than an empty one, and a corrupt row
 * must never take the console down.
 */
export function fromStored(raw: unknown): StoredMessage[] {
  if (!raw || typeof raw !== "object") return [];
  const chat = raw as Record<string, unknown>;
  if (chat["v"] !== CHAT_VERSION) return [];
  const messages = chat["messages"];
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(isMessage)
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      ...message,
      text: message.text.length > MAX_TEXT ? `${message.text.slice(0, MAX_TEXT)}…` : message.text,
    }));
}
