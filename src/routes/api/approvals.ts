import { createFileRoute } from "@tanstack/react-router";
import {
  CooksyError,
  assertConsoleRequest,
  decideApproval,
  errorResponse,
  jsonResponse,
  listApprovals,
} from "@/lib/cooksy/cooksy.server";

/** A decision is one word; anything else is refused before it reaches cooksy-api. */
type Decision = "approve" | "deny";

function readDecision(body: unknown): { id: string; decision: Decision } {
  if (!body || typeof body !== "object") throw new CooksyError("Send { id, decision }.", 400);
  const { id, decision } = body as { id?: unknown; decision?: unknown };
  if (typeof id !== "string" || !id.trim()) throw new CooksyError("An approval id is required.", 400);
  if (decision !== "approve" && decision !== "deny") {
    throw new CooksyError('decision must be "approve" or "deny".', 400);
  }
  return { id: id.trim(), decision };
}

export const Route = createFileRoute("/api/approvals")({
  server: {
    handlers: {
      /** One poll. The browser never sees a token, and never talks to cooksy-api directly. */
      GET: async ({ request }: { request: Request }) => {
        try {
          assertConsoleRequest(request);
          const since = Number(new URL(request.url).searchParams.get("since") ?? 0);
          return jsonResponse(await listApprovals(since));
        } catch (error) {
          return errorResponse(error);
        }
      },

      /** Approve or deny the stored action. The agent token cannot reach this branch. */
      POST: async ({ request }: { request: Request }) => {
        try {
          assertConsoleRequest(request);
          let body: unknown = null;
          try {
            body = await request.json();
          } catch {
            throw new CooksyError("Send { id, decision }.", 400);
          }
          const { id, decision } = readDecision(body);
          const outcome = await decideApproval(id, decision);
          if (outcome.ok) return jsonResponse(outcome, 200);
          if (outcome.code === "not_found") return jsonResponse(outcome, 404);
          // A failed execution was still recorded, so the decision itself succeeded.
          if (outcome.code === "failed") return jsonResponse(outcome, 200);
          return jsonResponse(outcome, 409);
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
