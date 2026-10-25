/**
 * Server-only client for cooksy-api.
 *
 * This module holds BOTH tokens, so it must never be imported from a component
 * or a client route. The `.server.ts` suffix keeps it out of the browser bundle.
 *
 * Two credentials, deliberately separate:
 * - COOKSY_API_TOKEN      read-only tools (the same value the MCP server uses)
 * - COOKSY_APPROVER_TOKEN approve/deny — the console's alone. It is never put in
 *   ~/.openclaw/.env, because the gateway and every MCP process inherit that file.
 */
import {
  KITCHEN_VIEWS,
  type ApprovalRecord,
  type ApprovalsPage,
  type DecisionOutcome,
  type KitchenData,
  type KitchenView,
  type PantryItem,
  type PlanEntry,
  type ShoppingItem,
} from "./types";

export type {
  ApprovalRecord,
  ApprovalStatus,
  ApprovalsPage,
  DecisionOutcome,
  KitchenData,
  KitchenView,
  PantryItem,
  PlanEntry,
  ShoppingItem,
} from "./types";
export { KITCHEN_VIEWS };

/** An error safe to surface to the operator: message plus the status to answer with. */
export class CooksyError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "CooksyError";
    this.status = status;
  }
}

const BASE_URL = (process.env["COOKSY_API_URL"] || "http://127.0.0.1:4010").replace(/\/$/, "");
const READ_TIMEOUT_MS = 8_000;
const DECIDE_TIMEOUT_MS = 20_000;

/** Approval ids come from cooksy-api; anything else is refused before it reaches a URL. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

function token(kind: "agent" | "approver"): string {
  const name = kind === "agent" ? "COOKSY_API_TOKEN" : "COOKSY_APPROVER_TOKEN";
  const value = process.env[name] ?? "";
  if (!value) {
    throw new CooksyError(
      `${name} is not set, so the console cannot reach cooksy-api. Add it to .env and restart.`,
      500,
    );
  }
  return value;
}

async function call<T>(
  path: string,
  options: {
    kind: "agent" | "approver";
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
  },
): Promise<T> {
  const { kind, method = "GET", body, timeoutMs = READ_TIMEOUT_MS } = options;
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token(kind)}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof CooksyError) throw error;
    // Never let a raw fetch error reach the browser: it can carry local paths.
    throw new CooksyError(`Could not reach cooksy-api at ${BASE_URL}. Is it running?`, 502);
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const record =
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    const message =
      typeof record?.["error"] === "string"
        ? record["error"]
        : typeof record?.["code"] === "string"
          ? `cooksy-api refused: ${record["code"].replace(/_/g, " ")}.`
          : `cooksy-api answered ${response.status}.`;
    // Keep 4xx statuses (400 bad input, 401/403 auth, 404 missing) so callers can
    // tell "that approval is gone" apart from "the API is down".
    throw new CooksyError(
      message,
      response.status >= 400 && response.status < 500 ? response.status : 502,
    );
  }
  if (parsed === null) throw new CooksyError("cooksy-api returned an empty answer.", 502);
  return parsed as T;
}

/** One poll of the approval queue. */
export function listApprovals(since = 0): Promise<ApprovalsPage> {
  const at = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0;
  return call<ApprovalsPage>(`/approvals?since=${at}`, { kind: "approver" });
}

/** The stored record behind one approval id, or null when it does not exist. */
export async function getApproval(id: string): Promise<ApprovalRecord | null> {
  if (!ID_PATTERN.test(id)) return null;
  try {
    return await call<ApprovalRecord>(`/approvals/${encodeURIComponent(id)}`, { kind: "approver" });
  } catch (error) {
    if (error instanceof CooksyError && error.status === 404) return null;
    throw error;
  }
}

/** Approve or deny. Approving runs the stored action; denying touches nothing else. */
export async function decideApproval(
  id: string,
  decision: "approve" | "deny",
): Promise<DecisionOutcome> {
  if (!ID_PATTERN.test(id)) {
    return { ok: false, code: "invalid_id", error: "That approval id is not valid." };
  }
  try {
    return await call<DecisionOutcome>(`/approvals/${encodeURIComponent(id)}/${decision}`, {
      kind: "approver",
      method: "POST",
      body: {},
      timeoutMs: DECIDE_TIMEOUT_MS,
    });
  } catch (error) {
    // A 4xx means cooksy-api made a decision about this request (gone, expired,
    // already decided). That is a real outcome for the card to show, not a failure
    // of the console, so it is returned rather than thrown.
    if (error instanceof CooksyError && error.status >= 400 && error.status < 500) {
      return {
        ok: false,
        code: error.status === 404 ? "not_found" : "refused",
        error: error.message,
      };
    }
    throw error;
  }
}

/** Pantry, week plan or shopping list — read with the read-only token. */
export function readKitchen(view: KitchenView): Promise<KitchenData> {
  if (view === "plan") {
    return call<{ from: string; to: string; entries: PlanEntry[] }>("/plan", {
      kind: "agent",
    }).then(({ from, to, entries }) => ({ view: "plan" as const, from, to, entries }));
  }
  if (view === "shopping") {
    return call<{ items: ShoppingItem[] }>("/shopping", { kind: "agent" }).then(({ items }) => ({
      view: "shopping" as const,
      items,
    }));
  }
  return call<{ items: PantryItem[] }>("/pantry", { kind: "agent" }).then(({ items }) => ({
    view: "pantry" as const,
    items,
  }));
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * These routes act with the approver token, so they are console-only.
 *
 * A required custom header means a browser must preflight before it can call
 * them, and since no CORS headers are ever returned the preflight fails — so a
 * random page cannot POST an approval to this server. The Origin comparison is
 * defence in depth for anything that skips the preflight.
 */
export function assertConsoleRequest(request: Request): void {
  if (request.headers.get("x-cooksy-console") !== "1") {
    throw new CooksyError("This endpoint is for the console only.", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new CooksyError("Cross-origin approval requests are refused.", 403);
  }
}

/** Maps any failure to a JSON body the console can show, without leaking internals. */
export function errorResponse(error: unknown): Response {
  if (error instanceof CooksyError) return jsonResponse({ error: error.message }, error.status);
  return jsonResponse({ error: "Something went wrong talking to cooksy-api." }, 500);
}
