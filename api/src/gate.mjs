/**
 * The approval gate.
 *
 * Invariants this module exists to guarantee:
 *  - A gated tool call NEVER writes business data. It stores one `approvals`
 *    row (status pending) and returns approval_required.
 *  - Approve and Deny are the only transitions, and each is a single atomic
 *    pending -> executing / denied step. A second click or replay cannot run
 *    the action twice.
 *  - The server runs the stored action itself after a successful approve
 *    transition; the model is never asked to execute anything.
 *  - Denied, expired, unknown or already-used approvals change nothing.
 *  - Every terminal transition writes an audit_log row.
 *
 * Expiry is applied by this module (a sweeper / on-read check), never by a
 * MongoDB TTL index, so a pending row is marked `expired` and audited instead
 * of being silently deleted before its outcome is recorded.
 */
import { randomBytes } from "node:crypto";

const APPROVAL_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * How long a row may sit in `executing` before the sweeper calls it failed.
 * A crash between the atomic `pending -> executing` transition and the outcome
 * write would otherwise leave that approval unusable for ever: it is no longer
 * pending, so nothing retries it, and no card ever shows again.
 */
const EXECUTING_GRACE_MS = 2 * 60 * 1000;

function nowMs() {
  return Date.now();
}

function newApprovalId() {
  return `act_${randomBytes(6).toString("hex")}`;
}

/**
 * Create the gate against a Store.
 * @param {import("./store.mjs").Store} store
 * @param {(tool: string, args: object) => Promise<object>} executor
 *        runs a gated action. Called ONLY after a successful approve transition.
 * @param {(entry: object) => string} summarize
 *        builds the human-readable title/summary for a proposed action.
 */
export function createApprovalGate(store, executor, summarize) {
  /**
   * Expire one pending row if it has passed its TTL. Atomic; writes an audit
   * row only if this call is the one that flips it.
   */
  async function expireIfDue(id) {
    const res = await store.findOneAndUpdate(
      "approvals",
      { _id: id, status: "pending", expiresAt: { $lt: nowMs() } },
      { $set: { status: "expired", decidedAt: nowMs() } },
    );
    if (res.matched) {
      await writeAudit({ actor: "system", event: "approval.expired", approvalId: id });
      return true;
    }
    return false;
  }

  async function writeAudit(entry) {
    await store.insertOne("audit_log", {
      at: nowMs(),
      actor: entry.actor,
      event: entry.event,
      ...(entry.approvalId ? { approvalId: entry.approvalId } : {}),
      detail: entry.detail ?? "",
    });
  }

  return {
    /**
     * A gated tool was called. Validate, store a pending approval, write
     * nothing else, and return the approval_required payload for the agent.
     */
    async propose({ tool, args, risk }) {
      const { title, summary } = summarize(tool, args);
      const approval = {
        _id: newApprovalId(),
        tool,
        args,
        title,
        summary,
        risk: risk ?? "low",
        status: "pending",
        createdAt: nowMs(),
        expiresAt: nowMs() + APPROVAL_TTL_MS,
      };
      await store.insertOne("approvals", approval);
      return {
        status: "approval_required",
        approval: {
          id: approval._id,
          title: approval.title,
          tool: approval.tool,
          summary: approval.summary,
          risk: approval.risk,
        },
      };
    },

    /** Read one approval for the console card (expiring it first if due). */
    async get(id) {
      const doc = await store.findOne("approvals", { _id: id });
      if (!doc) return null;
      if (doc.status === "pending" && doc.expiresAt <= nowMs()) {
        await expireIfDue(id);
        return { ...doc, status: "expired" };
      }
      return doc;
    },

    async pendingList() {
      // Overdue rows are excluded so the console never shows a dead card. The
      // sweeper then flips them to `expired` and writes the audit entry.
      return store.find("approvals", {
        status: "pending",
        expiresAt: { $gte: nowMs() },
      });
    },

    /**
     * Approve: one atomic pending -> executing transition. Only if it matched
     * do we run the stored action and record the outcome.
     * @returns {Promise<{ok: boolean, code: string, result?: object, error?: string}>}
     */
    async approve(id, actor = "browser") {
      const doc = await store.findOne("approvals", { _id: id });
      if (!doc) return { ok: false, code: "not_found" };
      if (doc.expiresAt <= nowMs() && doc.status === "pending") {
        await expireIfDue(id);
        return { ok: false, code: "expired" };
      }

      const res = await store.findOneAndUpdate(
        "approvals",
        { _id: id, status: "pending" },
        { $set: { status: "executing", decidedAt: nowMs(), actor } },
      );
      if (!res.matched) {
        // Already denied, expired, executing or executed. Change nothing.
        return { ok: false, code: `already_${doc.status}` };
      }

      let result;
      let error;
      try {
        result = await executor(doc.tool, doc.args);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const status = error ? "failed" : "executed";
      await store.updateOne(
        "approvals",
        { _id: id, status: "executing" },
        { $set: { status, ...(error ? { error } : { result }) } },
      );
      await writeAudit({
        actor,
        event: `approval.${status}`,
        approvalId: id,
        detail: error ?? doc.title,
      });
      return error ? { ok: false, code: "failed", error } : { ok: true, code: "executed", result };
    },

    /**
     * Deny: the same atomic pattern, to `denied`. Writes nothing on the data
     * collections; only the approval row and an audit entry change.
     */
    async deny(id, actor = "browser") {
      const doc = await store.findOne("approvals", { _id: id });
      if (!doc) return { ok: false, code: "not_found" };
      if (doc.expiresAt <= nowMs() && doc.status === "pending") {
        await expireIfDue(id);
        return { ok: false, code: "expired" };
      }
      const res = await store.findOneAndUpdate(
        "approvals",
        { _id: id, status: "pending" },
        { $set: { status: "denied", decidedAt: nowMs(), actor } },
      );
      if (!res.matched) return { ok: false, code: `already_${doc.status}` };
      await writeAudit({ actor, event: "approval.denied", approvalId: id, detail: doc.title });
      return { ok: true, code: "denied" };
    },

    async activitySince(since = 0) {
      return store.find("audit_log", { at: { $gt: Number(since) || 0 } });
    },

    /**
     * Expire every overdue pending approval. This is the deliberate replacement
     * for a MongoDB TTL index: TTL would delete the row the moment it aged out,
     * destroying the record before its outcome (approved / denied / expired)
     * could ever be audited. Here the row survives and gets an audit entry.
     * Returns the number newly expired.
     */
    async sweep() {
      const overdue = await store.find("approvals", {
        status: "pending",
        expiresAt: { $lt: nowMs() },
      });
      let expired = 0;
      for (const row of overdue) {
        if (await expireIfDue(row._id)) expired++;
      }

      // Rows abandoned mid-execution (a crash or a killed process). Marked failed
      // with the reason, so the audit trail explains why the action never landed.
      const stuck = await store.find("approvals", {
        status: "executing",
        decidedAt: { $lt: nowMs() - EXECUTING_GRACE_MS },
      });
      for (const row of stuck) {
        const res = await store.findOneAndUpdate(
          "approvals",
          { _id: row._id, status: "executing" },
          {
            $set: {
              status: "failed",
              error: "The action was interrupted before it finished.",
            },
          },
        );
        if (res.matched) {
          await writeAudit({
            actor: "system",
            event: "approval.failed",
            approvalId: row._id,
            detail: "Interrupted while executing.",
          });
        }
      }

      return expired;
    },

    writeAudit,
  };
}
