import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { createMongoStore } from "../src/stores/mongo.mjs";
import { createApprovalGate } from "../src/gate.mjs";
import { createExecutors } from "../src/executors.mjs";
import { summarize } from "../src/summarize.mjs";

/**
 * Integration tests against a REAL MongoDB.
 *
 * These exist because the in-memory store can only prove my implementation of
 * the gate's semantics. It cannot prove that MongoDB's findOneAndUpdate is
 * actually atomic, that a caller-supplied string _id round-trips, that the
 * indexes exist, or that nothing creates a TTL index on approvals.
 *
 * Skipped unless MONGO_URL is present, so `npm test` stays Docker-free:
 *   npm run test:integration
 */

const BASE_URL = process.env.MONGO_URL;
const TEST_DB = "cooksy_test";

function testUrl() {
  if (!BASE_URL) return null;
  const u = new URL(BASE_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

const url = testUrl();

async function dropTestDb() {
  const client = new MongoClient(BASE_URL);
  await client.connect();
  try {
    await client.db(TEST_DB).dropDatabase();
  } finally {
    await client.close();
  }
}

test(
  "mongo store",
  { skip: url ? false : "MONGO_URL not set — run `npm run test:integration`" },
  async (t) => {
    await dropTestDb();

    const store = createMongoStore({ url, dbName: TEST_DB });
    await store.init();

    const executors = createExecutors(store, {
      dataDir: "data-test",
      resolveRecipes: async (ids) => ids.map((id) => ({ id, name: `Recipe ${id}`, thumb: null })),
    });
    const gate = createApprovalGate(store, async (tool, args) => executors[tool](args), summarize);

    t.after(async () => {
      await store.close();
      await dropTestDb();
    });

    await t.test("indexes exist and none of them is a TTL index", async () => {
      const client = new MongoClient(BASE_URL);
      await client.connect();
      try {
        const db = client.db(TEST_DB);
        for (const name of [
          "pantry_items",
          "plan_entries",
          "shopping_items",
          "approvals",
          "audit_log",
        ]) {
          const idx = await db.collection(name).indexes();
          assert.ok(idx.length >= 1, `${name} should have at least the _id index`);
          const ttl = idx.filter((i) => "expireAfterSeconds" in i);
          assert.deepEqual(
            ttl,
            [],
            `${name} must have no TTL index — it would delete pending approvals before audit`,
          );
        }
      } finally {
        await client.close();
      }
    });

    await t.test("the unique index on plan_entries (date, meal) is enforced", async () => {
      await executors.plan_set_meal({ date: "2026-10-24", meal: "dinner", recipeId: "1" });
      // A second insert that bypasses the executor's replace check must fail.
      await assert.rejects(
        () =>
          store.insertOne("plan_entries", { date: "2026-10-24", meal: "dinner", recipeId: "2" }),
        /duplicate key/i,
      );
    });

    await t.test("propose writes no business data", async () => {
      const before = await store.count("pantry_items", {});
      const out = await gate.propose({
        tool: "pantry_update",
        args: { name: "garlic", quantity: 3, unit: "cloves" },
        risk: "low",
      });
      assert.equal(out.status, "approval_required");
      assert.equal(
        await store.count("pantry_items", {}),
        before,
        "propose must not write business data",
      );

      const row = await store.findOne("approvals", { _id: out.approval.id });
      assert.equal(row.status, "pending");
      assert.equal(row._id, out.approval.id, "string _id must round-trip unchanged");

      await gate.deny(out.approval.id, "browser");
    });

    await t.test("two concurrent approves: exactly one wins, action runs once", async () => {
      const out = await gate.propose({
        tool: "plan_set_meal",
        args: { date: "2026-10-27", meal: "lunch", recipeId: "52771", replace: true },
        risk: "low",
      });

      const [a, b] = await Promise.all([
        gate.approve(out.approval.id, "browser"),
        gate.approve(out.approval.id, "browser"),
      ]);

      assert.equal(
        [a.ok, b.ok].filter(Boolean).length,
        1,
        "Mongo findOneAndUpdate must make this a single winner",
      );
      assert.equal(
        await store.count("plan_entries", { date: "2026-10-27" }),
        1,
        "action ran exactly once",
      );
      assert.equal((await store.findOne("approvals", { _id: out.approval.id })).status, "executed");
    });

    await t.test("state survives a brand new store instance", async () => {
      const out = await gate.propose({
        tool: "pantry_update",
        args: { name: "survives-restart", quantity: 1, unit: "bag" },
        risk: "low",
      });

      // A separate connection: proof this is real durability, not process memory.
      const second = createMongoStore({ url, dbName: TEST_DB });
      await second.init();
      const secondGate = createApprovalGate(
        second,
        async (tool, args) =>
          createExecutors(second, {
            dataDir: "data-test",
            resolveRecipes: async (ids) =>
              ids.map((id) => ({ id, name: `Recipe ${id}`, thumb: null })),
          })[tool](args),
        summarize,
      );

      const found = await secondGate.get(out.approval.id);
      assert.equal(
        found.status,
        "pending",
        "the pending approval outlived the original connection",
      );

      const res = await secondGate.approve(out.approval.id, "browser");
      assert.equal(res.ok, true);
      assert.ok(
        await second.findOne("pantry_items", { name: "survives-restart" }),
        "the executed write is visible through a different connection",
      );
      await second.close();
    });

    await t.test("the sweeper expires overdue rows in the database", async () => {
      const out = await gate.propose({ tool: "shopping_build", args: {}, risk: "low" });
      await store.updateOne(
        "approvals",
        { _id: out.approval.id },
        { $set: { expiresAt: Date.now() - 1000 } },
      );

      assert.equal(await gate.sweep(), 1);
      const row = await store.findOne("approvals", { _id: out.approval.id });
      assert.equal(row.status, "expired", "the row survives and is marked expired, never deleted");
      assert.ok(row.decidedAt);
      assert.equal(
        (await store.find("audit_log", { approvalId: out.approval.id }))[0].event,
        "approval.expired",
      );
    });
  },
);
