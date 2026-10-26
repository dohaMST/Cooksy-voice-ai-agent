import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionFocus, describeDecision } from "./outcome.ts";
import type { ApprovalRecord, DecisionOutcome } from "./types.ts";

function record(tool: string, args: Record<string, unknown> = {}): ApprovalRecord {
  return {
    _id: "act_1",
    tool,
    args,
    title: `Test ${tool}`,
    summary: "",
    risk: "low",
    status: "pending",
    createdAt: 0,
    expiresAt: 0,
  };
}

const ok = (result: unknown): DecisionOutcome => ({ ok: true, code: "executed", result });

test("a planned meal is announced with its day and slot", () => {
  const row = record("plan_set_meal", { date: "2026-10-27", meal: "lunch", recipeId: "53031" });
  assert.equal(
    describeDecision(
      row,
      "approve",
      ok({ date: "2026-10-27", meal: "lunch", recipeName: "Egyptian Fatteh" }),
    ),
    "Added Egyptian Fatteh to lunch on Tue 27 Oct.",
  );
});

test("a replaced meal says swapped, not added", () => {
  const row = record("plan_set_meal", {
    date: "2026-10-27",
    meal: "lunch",
    recipeId: "53031",
    replace: true,
  });
  assert.equal(
    describeDecision(
      row,
      "approve",
      ok({ date: "2026-10-27", meal: "lunch", recipeName: "Egyptian Fatteh" }),
    ),
    "Swapped lunch on Tue 27 Oct to Egyptian Fatteh.",
  );
});

test("a cleared day reports how many meals went", () => {
  assert.equal(
    describeDecision(
      record("plan_clear_day", { date: "2026-10-28" }),
      "approve",
      ok({ cleared: "2026-10-28", removed: 2 }),
    ),
    "Cleared Wed 28 Oct — 2 meals removed.",
  );
  assert.equal(
    describeDecision(
      record("plan_clear_day", { date: "2026-10-28" }),
      "approve",
      ok({ cleared: "2026-10-28", removed: 0 }),
    ),
    "Cleared Wed 28 Oct — nothing was planned.",
  );
});

test("pantry writes name the item and the amount", () => {
  assert.equal(
    describeDecision(
      record("pantry_update", { name: "lemon", quantity: 1.5, unit: "kg" }),
      "approve",
      ok({ name: "lemon", quantity: 1.5, unit: "kg" }),
    ),
    "Pantry updated — 1.5 kg of lemon.",
  );
  assert.equal(
    describeDecision(
      record("pantry_remove", { name: "lemons" }),
      "approve",
      ok({ removed: "lemons" }),
    ),
    "Removed lemons from the pantry.",
  );
});

test("shopping writes report the resulting list size", () => {
  assert.equal(
    describeDecision(record("shopping_build"), "approve", ok({ added: 3 })),
    "Shopping list rebuilt — 3 items to buy.",
  );
  assert.equal(
    describeDecision(record("shopping_build"), "approve", ok({ added: 0 })),
    "Shopping list rebuilt — nothing needs buying.",
  );
  assert.equal(
    describeDecision(record("shopping_export"), "approve", ok({ count: 7, file: "x" })),
    "Shopping list exported — 7 items.",
  );
});

test("a failed write is reported as failed, never as done", () => {
  const outcome: DecisionOutcome = {
    ok: false,
    code: "failed",
    error: 'No pantry item called "basil".',
  };
  assert.equal(
    describeDecision(record("pantry_remove", { name: "basil" }), "approve", outcome),
    'Approved, but the write failed: No pantry item called "basil".',
  );
});

test("denying says nothing was changed", () => {
  assert.equal(
    describeDecision(record("plan_set_meal"), "deny", { ok: true, code: "denied" }),
    "Denied — nothing was changed.",
  );
});

test("a decided plan write focuses the week it landed in", () => {
  const row = record("plan_set_meal", { date: "2026-10-27", meal: "lunch", recipeId: "53031" });
  assert.deepEqual(decisionFocus(row, ok({ date: "2026-10-27", meal: "lunch" })), {
    tab: "plan",
    date: "2026-10-27",
  });
  assert.deepEqual(
    decisionFocus(record("pantry_remove", { name: "lemons" }), ok({ removed: "lemons" })),
    {
      tab: "pantry",
      date: null,
    },
  );
  assert.deepEqual(decisionFocus(record("shopping_build"), ok({ added: 1 })), {
    tab: "shopping",
    date: null,
  });
  assert.equal(decisionFocus(row, { ok: false, code: "expired" }), null);
});
