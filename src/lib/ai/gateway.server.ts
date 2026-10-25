export const GATEWAY_BASE_URL = (
  process.env["OPENCLAW_GATEWAY_URL"] ||
  process.env["LOVABLE_GATEWAY_URL"] ||
  "http://localhost:18789"
).replace(/\/$/, "");

export const CHAT_MODEL = process.env["OPENCLAW_DEFAULT_MODEL"] || "openclaw/cook";

/** Maximum audio upload size (13 MB). */
export const MAX_AUDIO_BYTES = 13 * 1024 * 1024;

export function getApiKey(): string {
  // The gateway authenticates with the token from `openclaw config set gateway.auth.token`.
  // OPENCLAW_API_KEY is the older name; both are accepted so a stale .env still works.
  return process.env["OPENCLAW_GATEWAY_TOKEN"] || process.env["OPENCLAW_API_KEY"] || "";
}

export function getGatewayHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = getApiKey();
  return {
    ...(key ? { Authorization: `Bearer ${key}`, "Lovable-API-Key": key } : {}),
    ...extra,
  };
}
