import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store.mjs";
import { createApprovalGate } from "../src/gate.mjs";
import { createExecutors } from "../src/executors.mjs";
import { summarize } from "../src/summarize.mjs";

/**
 * Gate tests. These drive the gate directly against the in-memory store, so
 * they run with no Docker, no MongoDB and no network. They assert on DATA —
 * that business collections are unchanged — not only on a returned code.
 */

function makeGate() {
  const store = createMemoryStore();
  const executors = createExecutors(store, {
    dataDir: "data-test",
    resolveRecipes: async (ids) => ids.map((id) => ({ id, name: `Recipe ${id}`, thumb: null })),
  });
  const gate = createApprovalGate(
    store,
    async (tool, args) => {
      const fn = executors[tool];
      if (!fn) throw new Error(`No executor for ${tool}`);
      return fn(args);
    },
    summarize,
  );
  return { store, gate, executors };
}

async function counts(store) {
  return {
    pantry: await store.count("pantry_items", {}),
    plan: await store.count("plan_entries", {}),
    shopping: await store.count("shopping_items", {}),
  };
}

test("propose does not change any data collection", async () => {
  const { store, gate } = makeGate();
  await store.insertOne("pantry_items", { name: "rice", quantity: 1, unit: "bag" });
  const before = await counts(store);

  const out = await gate.propose({
    tool: "pantry_update",
    args: { name: "chicken", quantity: 2, unit: "kg" },
    risk: "low",
  });

  assert.deepEqual(await counts(store), before, "business collections changed on propose");
  assert.equal(out.status, "approval_required");
  assert.equal(out.approval.tool, "pantry_update");
  assert.ok(out.approval.id);
  assert.equal(out.approval.risk, "low");

  const row = await store.findOne("approvals", { _id: out.approval.id });
  assert.equal(row.status, "pending");
  assert.deepEqual(row.args, { name: "chicken", quantity: 2, unit: "kg" });
});

test("approve runs the stored action and writes data + audit", async () => {
  const { store, gate } = makeGate();
  const out = await gate.propose({
    tool: "pantry_update",
    args: { name: "chicken", quantity: 2, unit: "kg" },
    risk: "low",
  });

  const res = await gate.approve(out.approval.id, "browser");
  assert.equal(res.ok, true);
  assert.equal(res.code, "executed");

  const item = await store.findOne("pantry_items", { name: "chicken" });
  assert.ok(item, "pantry item was written");
  assert.equal(item.quantity, 2);
  assert.equal((await store.findOne("approvals", { _id: out.approval.id })).status, "executed");
  assert.equal(
    (await store.find("audit_log", { approvalId: out.approval.id }))[0].event,
    "approval.executed",
  );
});

test("a second approve of the same id does not run the action twice", async () => {
  const { store, gate } = makeGate();
  const out = await gate.propose({
    tool: "plan_set_meal",
    args: { date: "2026-10-24", meal: "dinner", recipeId: "52771" },
    risk: "low",
  });

  assert.equal((await gate.approve(out.approval.id, "browser")).ok, true);
  const before = await counts(store);
  const second = await gate.approve(out.approval.id, "browser");

  assert.equal(second.ok, false, "second approve must be refused");
  assert.equal(second.code, "already_executed");
  assert.deepEqual(await counts(store), before, "second approve must not change data");
  assert.equal(await store.count("plan_entries", {}), 1);
});

test("two simultaneous approves run the action exactly once", async () => {
  const { store, gate } = makeGate();
  const out = await gate.propose({
    tool: "plan_set_meal",
    args: { date: "2026-10-25", meal: "dinner", recipeId: "52771" },
    risk: "low",
  });

  const [a, b] = await Promise.all([
    gate.approve(out.approval.id, "browser"),
    gate.approve(out.approval.id, "browser"),
  ]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "exactly one approve should win");
  assert.equal(await store.count("plan_entries", {}), 1, "action ran once");
});

test("deny then approve is refused and changes nothing", async () => {
  const { store, gate } = makeGate();
  const out = await gate.propose({
    tool: "pantry_update",
    args: { name: "salt", quantity: 1, unit: "tsp" },
    risk: "low",
  });

  assert.equal((await gate.deny(out.approval.id, "browser")).ok, true);
  const before = await counts(store);
  const approve = await gate.approve(out.approval.id, "browser");

  assert.equal(approve.ok, false);
  assert.equal(approve.code, "already_denied");
  assert.deepEqual(await counts(store), before);
  assert.equal(await store.count("pantry_items", {}), 0);
});

test("deny writes only the approval row and an audit entry", async () => {
  const { store, gate } = makeGate();
  const out = await gate.propose({
    tool: "plan_clear_day",
    args: { date: "2026-10-26" },
    risk: "medium",
  });
  const before = await counts(store);
  await gate.deny(out.approval.id, "browser");
  assert.deepEqual(await counts(store), before);
  assert.equal((await store.findOne("approvals", { _id: out.approval.id })).status, "denied");
  assert.equal(
    (await store.find("audit_log", { approvalId: out.approval.id }))[0].event,
    "approval.denied",
  );
});

test("unknown approval id is refused and changes nothing", async () => {
  const { store, gate } = makeGate();
  const before = await counts(store);
  const res = await gate.approve("act_does_not_exist", "browser");
  assert.equal(res.ok, false);
  assert.equal(res.code, "not_found");
  assert.deepEqual(await counts(store), before);
});

test("an expired approval cannot be executed and is marked expired", async () => {
  const { store, gate } = makeGate();
  const out = await gate.propose({
    tool: "pantry_update",
    args: { name: "pepper", quantity: 1, unit: "tsp" },
    risk: "low",
  });
  await store.updateOne(
    "approvals",
    { _id: out.approval.id },
    { $set: { expiresAt: Date.now() - 1000 } },
  );

  const before = await counts(store);
  const res = await gate.approve(out.approval.id, "browser");

  assert.equal(res.ok, false);
  assert.equal(res.code, "expired");
  assert.deepEqual(await counts(store), before, "expired approval must not write data");
  assert.equal((await store.findOne("approvals", { _id: out.approval.id })).status, "expired");
});

test("a failing executor sets failed, writes an audit row and no data", async () => {
  const store = createMemoryStore();
  const gate = createApprovalGate(
    store,
    async () => {
      throw new Error("boom");
    },
    summarize,
  );

  const out = await gate.propose({
    tool: "pantry_remove",
    args: { name: "ghost" },
    risk: "medium",
  });
  const res = await gate.approve(out.approval.id, "browser");

  assert.equal(res.ok, false);
  assert.equal(res.code, "failed");
  assert.equal(res.error, "boom");
  const row = await store.findOne("approvals", { _id: out.approval.id });
  assert.equal(row.status, "failed");
  assert.equal(row.error, "boom");
  assert.equal(
    (await store.find("audit_log", { approvalId: out.approval.id }))[0].event,
    "approval.failed",
  );
});

test("the sweeper expires overdue rows and audits them", async () => {
  const { store, gate } = makeGate();
  const out = await gate.propose({ tool: "shopping_build", args: {}, risk: "low" });
  await store.updateOne(
    "approvals",
    { _id: out.approval.id },
    { $set: { expiresAt: Date.now() - 1000 } },
  );

  assert.equal(await gate.sweep(), 1, "sweeper should expire one row");

  const row = await store.findOne("approvals", { _id: out.approval.id });
  assert.equal(row.status, "expired");
  assert.ok(row.decidedAt, "decidedAt recorded");
  assert.equal(
    (await store.find("audit_log", { approvalId: out.approval.id }))[0].event,
    "approval.expired",
  );
  assert.equal(await gate.sweep(), 0, "sweeping twice must not double-count");
});

test("pendingList hides overdue rows and never exposes dead cards", async () => {
  const { store, gate } = makeGate();
  const live = await gate.propose({ tool: "shopping_build", args: {}, risk: "low" });
  const dead = await gate.propose({ tool: "shopping_build", args: {}, risk: "low" });
  await store.updateOne(
    "approvals",
    { _id: dead.approval.id },
    { $set: { expiresAt: Date.now() - 1 } },
  );

  const pending = await gate.pendingList();
  assert.equal(pending.length, 1);
  assert.equal(pending[0]._id, live.approval.id);
});

test("gate expires a pending approval lazily on read", async () => {
  const { store, gate } = makeGate();
  const out = await gate.propose({ tool: "shopping_build", args: {}, risk: "low" });
  await store.updateOne(
    "approvals",
    { _id: out.approval.id },
    { $set: { expiresAt: Date.now() - 1000 } },
  );

  assert.equal((await gate.get(out.approval.id)).status, "expired");
  assert.equal(
    (await store.find("audit_log", { approvalId: out.approval.id }))[0].event,
    "approval.expired",
    "expiry is audited, never silent",
  );
});
