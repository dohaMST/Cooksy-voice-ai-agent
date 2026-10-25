/**
 * Browser-side Cooksy client.
 *
 * Everything here talks to this app's own routes (`/api/approvals`,
 * `/api/kitchen`), never to cooksy-api directly. That is what keeps the approver
 * token server-side: the browser has no credential for it at all.
 *
 * The `x-cooksy-console` header is required by those routes and also forces a
 * preflight for any cross-origin caller, which is refused.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalsPage, DecisionOutcome, KitchenData, KitchenView } from "./types";

const CONSOLE_HEADERS = { "x-cooksy-console": "1" } as const;
const POLL_MS = 2000;

async function failure(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* not JSON */
  }
  return fallback;
}

async function getApprovals(since: number): Promise<ApprovalsPage> {
  const response = await fetch(`/api/approvals?since=${Math.max(0, Math.floor(since))}`, {
    headers: CONSOLE_HEADERS,
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(await failure(response, "The approval queue could not be read."));
  return (await response.json()) as ApprovalsPage;
}

async function postDecision(id: string, decision: "approve" | "deny"): Promise<DecisionOutcome> {
  const response = await fetch("/api/approvals", {
    method: "POST",
    headers: { ...CONSOLE_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ id, decision }),
  });
  // 404/409 still carry a usable body describing why nothing happened.
  if (!response.ok && response.status >= 500) {
    throw new Error(await failure(response, "That decision could not be sent."));
  }
  return (await response.json()) as DecisionOutcome;
}

async function getKitchen(view: KitchenView): Promise<KitchenData> {
  const response = await fetch(`/api/kitchen?view=${view}`, {
    headers: CONSOLE_HEADERS,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await failure(response, "That list could not be read."));
  return (await response.json()) as KitchenData;
}

/**
 * Polls the approval queue.
 *
 * Polling, not a stream: the queue is authoritative in cooksy-api, the console is
 * only a viewer, and a dropped poll self-heals on the next tick.
 */
export function useApprovals(enabled = true) {
  const [page, setPage] = useState<ApprovalsPage>({ pending: [], decided: [], serverTime: 0 });
  const [error, setError] = useState<string | null>(null);
  const sinceRef = useRef(0);
  const aliveRef = useRef(true);

  const poll = useCallback(async () => {
    try {
      const next = await getApprovals(sinceRef.current);
      if (!aliveRef.current) return;
      sinceRef.current = next.serverTime;
      setPage(next);
      setError(null);
    } catch (cause) {
      if (!aliveRef.current) return;
      setError(cause instanceof Error ? cause.message : "The approval queue could not be read.");
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) return;
    void poll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    return () => {
      aliveRef.current = false;
      window.clearInterval(timer);
    };
  }, [enabled, poll]);

  /** Sends the decision, then re-polls immediately so the card reflects the stored record. */
  const decide = useCallback(
    async (id: string, decision: "approve" | "deny"): Promise<DecisionOutcome | null> => {
      try {
        const outcome = await postDecision(id, decision);
        await poll();
        return outcome;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That decision could not be sent.");
        return null;
      }
    },
    [poll],
  );

  return { pending: page.pending, decided: page.decided, error, decide };
}

/** Reads one kitchen list, with a manual refresh for after an approval runs. */
export function useKitchen(view: KitchenView, enabled = true) {
  const [data, setData] = useState<KitchenData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getKitchen(view);
      if (!aliveRef.current) return;
      setData(next);
      setError(null);
    } catch (cause) {
      if (!aliveRef.current) return;
      setError(cause instanceof Error ? cause.message : "That list could not be read.");
    }
  }, [view]);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) return;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [enabled, refresh]);

  // `data === null` means "not read yet", which the panels show as loading rather
  // than as an empty kitchen. Claiming a list is empty before reading it would be
  // the one lie this console must never tell.
  return { data, error, refresh };
}
