export type Choice = { id: string; label: string; value: string };
export type Nav = "back" | "cancel" | "home";
export const COMMAND_NAMES = ["set_view", "show_tab", "set_agent", "set_speaking_rate", "open_settings", "close_settings", "standby", "set_accent", "set_style"] as const;
export type Command = { name: (typeof COMMAND_NAMES)[number]; value: string };
export type ActionProposal = {
  id: string;
  title: string;
  tool: string;
  summary: string;
  risk?: "low" | "medium" | "high";
};
export type Screen = {
  text: string;
  choices: Choice[];
  navigation: Nav[];
  commands?: Command[];
  actionProposal?: ActionProposal | null;
};

const NAV_VALUES: Nav[] = ["back", "cancel", "home"];

/**
 * gpt-oss-120b emits U+202F (narrow no-break space) in number/unit strings such
 * as `2 l`. It survives JSON parsing, breaks word-splitting in paginate(), and
 * reads as a glitch in copy/paste and screen readers, so it is folded to a plain
 * space before any text is rendered or spoken.
 */
export function normalizeText(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, " ");
}

function parseActionProposal(raw: unknown): ActionProposal | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const id = typeof p["id"] === "string" && p["id"].trim() ? p["id"].trim().slice(0, 64) : "";
  const title = typeof p["title"] === "string" && p["title"].trim() ? p["title"].trim().slice(0, 120) : "";
  const tool = typeof p["tool"] === "string" && p["tool"].trim() ? p["tool"].trim().slice(0, 80) : "";
  const summary = typeof p["summary"] === "string" && p["summary"].trim() ? p["summary"].trim().slice(0, 500) : "";
  if (!id || !title || !tool || !summary) return undefined;
  const risk = p["risk"] === "low" || p["risk"] === "medium" || p["risk"] === "high" ? p["risk"] : undefined;
  return { id, title: normalizeText(title), tool: normalizeText(tool), summary: normalizeText(summary), ...(risk ? { risk } : {}) };
}

/** Validates planner output against the blueprint rules; returns null if invalid. */
export function parseScreen(raw: string): Screen | null {
  try {
    const data = JSON.parse(raw) as { kind?: unknown; screen?: { text?: unknown; choices?: unknown; navigation?: unknown }; action_proposal?: unknown };
    const proposal = parseActionProposal(data.action_proposal);
    // `kind` is a discriminator that carries no information: the shape already does.
    // gpt-oss omits it about half the time, so an absent value is accepted and only a
    // wrong one is refused.
    const kindOk = data.kind === undefined || data.kind === "screen" || data.kind === "action_proposal";
    if (!kindOk || proposal === undefined || !data.screen) return null;
    const text = typeof data.screen.text === "string" ? normalizeText(data.screen.text.trim()) : "";
    if (!text) return null;
    const seen = new Set<string>();
    const choices = (Array.isArray(data.screen.choices) ? data.screen.choices : [])
      .filter((c): c is Choice =>
        Boolean(c) && typeof c.id === "string" && /^[a-z][a-z0-9_]{0,31}$/.test(c.id) &&
        typeof c.label === "string" && c.label.length > 0 && c.label.length <= 40 &&
        typeof c.value === "string" && c.value.length > 0 && c.value.length <= 1000,
      )
      .map((c) => ({ ...c, label: normalizeText(c.label), value: normalizeText(c.value) }))
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    const navigation = [...new Set((Array.isArray(data.screen.navigation) ? data.screen.navigation : []) as Nav[])]
      .filter((n) => NAV_VALUES.includes(n));
    // Blueprint: choices + navigation must total four or fewer.
    const trimmedChoices = choices.slice(0, Math.max(0, 4 - navigation.length));
    const commands = (Array.isArray((data as { app_commands?: unknown }).app_commands) ? (data as { app_commands: unknown[] }).app_commands : [])
      .filter((c): c is Command => Boolean(c) && typeof c === "object" && COMMAND_NAMES.includes((c as Command).name) && typeof (c as Command).value === "string")
      .slice(0, 3);
    return { text, choices: trimmedChoices, navigation, commands, actionProposal: proposal };
  } catch {
    return null;
  }
}

/** Removes ```json fences some models wrap around the screen object. */
export function cleanRaw(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
}

const TAB_VALUES = ["talk", "kitchen", "plan", "run"] as const;

/** `[[tab:kitchen]]` and friends: the only way the agent drives the console. */
const MARKER = /\[\[(tab|agent|rate|settings|standby):([a-z0-9._-]+)\]\]/gi;

/**
 * Pulls trailing control markers out of a spoken answer.
 *
 * Markers are text, not JSON, on purpose: OpenClaw's chat endpoint always carries
 * the agent's toolset, and gpt-oss answers any "return JSON" instruction by trying
 * to call a tool literally named `JSON`, which the provider rejects.
 */
export function stripMarkers(raw: string): { text: string; commands: Command[] } {
  const commands: Command[] = [];
  const text = raw
    .replace(MARKER, (_match, kind: string, rawValue: string) => {
      const value = rawValue.toLowerCase();
      if (kind === "tab" && (TAB_VALUES as readonly string[]).includes(value)) {
        commands.push({ name: "show_tab", value });
      } else if (kind === "agent") {
        commands.push({ name: "set_agent", value });
      } else if (kind === "rate" && Number(value) >= 0.5 && Number(value) <= 2) {
        commands.push({ name: "set_speaking_rate", value });
      } else if (kind === "settings" && (value === "open" || value === "close")) {
        commands.push({ name: value === "open" ? "open_settings" : "close_settings", value: "" });
      } else if (kind === "standby" && (value === "on" || value === "off")) {
        commands.push({ name: "standby", value });
      }
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: normalizeText(text), commands };
}

/**
 * Turns one agent reply into a screen.
 *
 * A structured JSON screen is still honoured if the model volunteers one, but it is
 * never required: prose is the contract, so a plain answer is a complete answer.
 */
export function parseReply(raw: string): Screen {
  const cleaned = cleanRaw(raw);
  const structured = cleaned.startsWith("{") ? parseScreen(cleaned) : null;
  if (structured) return structured;
  const { text, commands } = stripMarkers(cleaned);
  return {
    text: text || "I did not get an answer that time. Try asking again.",
    choices: [],
    navigation: [],
    ...(commands.length ? { commands } : {}),
  };
}

/** Best-effort extraction of screen.text from a partially streamed JSON object. */
export function partialText(raw: string): string {
  const body = raw.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/)?.[1];
  if (!body) return "";
  try {
    return normalizeText(JSON.parse(`"${body.replace(/\\$/, "")}"`) as string);
  } catch {
    return normalizeText(body);
  }
}

export const NAV_LABEL: Record<Nav, string> = { back: "Back", cancel: "Cancel", home: "Home" };

export function spokenScreen(screen: Screen): string {
  const options = [...screen.choices.map((c) => c.label), ...screen.navigation.map((n) => NAV_LABEL[n])];
  if (!options.length) return screen.text;
  return `${screen.text} ${options.map((label, i) => `${i + 1}, ${label}.`).join(" ")}`;
}

/** Blueprint: local page budget, measured in UTF-16 units (Telegram max is 4096 characters). */
export const PAGE_BUDGET = 3500;

/** Splits text into pages at paragraph, sentence, or word breaks, never mid code point. Nothing is dropped. */
export function paginate(text: string, budget = PAGE_BUDGET): string[] {
  const pages: string[] = [];
  let rest = text.trim();
  while (rest.length > budget) {
    const window = rest.slice(0, budget);
    let cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
    if (cut < budget * 0.5) cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! ")) + 1;
    if (cut < budget * 0.5) cut = window.lastIndexOf(" ");
    if (cut <= 0) {
      cut = budget;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // keep surrogate pairs together
    }
    pages.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pages.push(rest);
  return pages.length ? pages : [""];
}
