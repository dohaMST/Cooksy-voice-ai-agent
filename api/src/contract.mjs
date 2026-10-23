/**
 * Loads the tool contract and validates tool arguments against each tool's
 * JSON-schema subset (type, required, properties, additionalProperties, enum,
 * pattern, maxLength, minimum, format:date). Unknown fields are rejected.
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../zafran-tools.json", import.meta.url), "utf8");
const contract = JSON.parse(raw);

export const TOOLS = contract.tools;
export const BROWSER_ONLY_ROUTES = contract.browserOnlyRoutes;

const byName = new Map(TOOLS.map((t) => [t.name, t]));
export function toolByName(name) {
  return byName.get(name);
}
export const GATED = TOOLS.filter((t) => t.gated);
export const READ_ONLY = TOOLS.filter((t) => !t.gated);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate an arguments object against a tool's input schema.
 * Returns { ok: true, value } or { ok: false, error }. Never throws.
 */
export function validateArgs(schema, input) {
  const value = input ?? {};
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Arguments must be an object." };
  }
  const props = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const key of Object.keys(value)) {
    if (!(key in props)) {
      return { ok: false, error: `Unknown field "${key}".` };
    }
  }
  for (const key of required) {
    if (value[key] === undefined || value[key] === null) {
      return { ok: false, error: `Missing required field "${key}".` };
    }
  }

  const out = {};
  for (const [key, def] of Object.entries(props)) {
    if (value[key] === undefined) continue;
    const err = checkField(key, def, value[key]);
    if (err) return { ok: false, error: err };
    out[key] = value[key];
  }
  return { ok: true, value: out };
}

function checkField(key, def, val) {
  if (def.type === "string") {
    if (typeof val !== "string") return `"${key}" must be a string.`;
    if (def.maxLength && val.length > def.maxLength) {
      return `"${key}" is too long (max ${def.maxLength}).`;
    }
    if (def.pattern && !new RegExp(def.pattern).test(val)) {
      return `"${key}" does not match the required format.`;
    }
    if (def.format === "date" && !DATE_RE.test(val)) {
      return `"${key}" must be a date like 2026-10-23.`;
    }
  } else if (def.type === "number") {
    if (typeof val !== "number" || Number.isNaN(val)) return `"${key}" must be a number.`;
    if (def.minimum !== undefined && val < def.minimum) {
      return `"${key}" must be at least ${def.minimum}.`;
    }
  } else if (def.type === "boolean") {
    if (typeof val !== "boolean") return `"${key}" must be true or false.`;
  } else if (def.enum) {
    if (!def.enum.includes(val)) {
      return `"${key}" must be one of: ${def.enum.join(", ")}.`;
    }
  }
  return null;
}
