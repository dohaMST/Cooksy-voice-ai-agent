import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, matches } from "../src/stores/memory.mjs";
import { createExecutors } from "../src/executors.mjs";

/**
 * Store-semantics tests.
 *
 * The regression these exist for: `matches` originally handled only $gt / $lt /
 * $in. The plan query uses $gte / $lte, so an unsupported operator was skipped
 * and the range filter matched EVERY document — the week plan would silently
 * return all plan entries ever written. Unsupported operators now throw.
 */

const docs = [
  { date: "2026-10-19", meal: "dinner" },
  { date: "2026-10-22", meal: "lunch" },
  { date: "2026-10-25", meal: "dinner" },
  { date: "2026-11-02", meal: "breakfast" },
];

test("$gte and $lte select a real range, not everything", () => {
  const hit = docs.filter((d) => matches(d, { date: { $gte: "2026-10-19", $lte: "2026-10-25" } }));
  assert.equal(hit.length, 3, "must exclude 2026-11-02");
});

test("a range filter that excludes everything returns nothing", () => {
  const hit = docs.filter((d) => matches(d, { date: { $gte: "2027-01-01", $lte: "2027-01-07" } }));
  assert.equal(hit.length, 0);
});

test("$gt and $lt remain exclusive", () => {
  assert.equal(docs.filter((d) => matches(d, { date: { $gt: "2026-10-19" } })).length, 3);
  assert.equal(docs.filter((d) => matches(d, { date: { $lt: "2026-10-19" } })).length, 0);
});

test("$in matches membership and rejects non-members", () => {
  assert.equal(docs.filter((d) => matches(d, { meal: { $in: ["dinner"] } })).length, 2);
  assert.equal(docs.filter((d) => matches(d, { meal: { $in: ["brunch"] } })).length, 0);
});

test("an unknown operator throws instead of matching everything", () => {
  assert.throws(
    () => matches(docs[0], { date: { $ne: "2026-10-19" } }),
    /Unsupported filter operator "\$ne"/,
  );
});

test("equality and multiple fields combine as AND", () => {
  assert.equal(docs.filter((d) => matches(d, { meal: "dinner" })).length, 2);
  assert.equal(docs.filter((d) => matches(d, { meal: "dinner", date: "2026-10-19" })).length, 1);
});

test("an unknown update operator throws", async () => {
  const store = createMemoryStore();
  await store.insertOne("pantry_items", { name: "rice" });
  await assert.rejects(
    () => store.updateOne("pantry_items", { name: "rice" }, { $inc: { quantity: 1 } }),
    /Unsupported update operator/,
  );
});

test("the /plan query shape returns only the requested week", async () => {
  const store = createMemoryStore();
  const executors = createExecutors(store, {
    dataDir: "data-test",
    resolveRecipes: async (ids) => ids.map((id) => ({ id, name: `Recipe ${id}`, thumb: null })),
  });

  for (const date of ["2026-10-19", "2026-10-25", "2026-11-02"]) {
    await executors.plan_set_meal({ date, meal: "dinner", recipeId: "52771" });
  }

  const week = await store.find("plan_entries", {
    date: { $gte: "2026-10-19", $lte: "2026-10-25" },
  });
  assert.equal(week.length, 2, "the 2026-11-02 entry must not leak into this week");
});

test("shopping_build skips items already in the pantry", async () => {
  const store = createMemoryStore();
  const executors = createExecutors(store, {
    dataDir: "data-test",
    resolveRecipes: async (ids) => ids.map((id) => ({ id, name: "Recipe One", thumb: null })),
  });

  // The range is pinned: `shopping_build({})` defaults to the week containing
  // *today*, so a fixed plan date falls out of range once the calendar moves on
  // and the test fails for the wrong reason (it did, the day after it was written).
  const week = { from: "2026-10-19", to: "2026-10-25" };

  await executors.plan_set_meal({ date: "2026-10-20", meal: "dinner", recipeId: "1" });
  await executors.pantry_update({ name: "recipe one", quantity: 1, unit: "item" });
  await executors.shopping_build(week);

  assert.equal(
    await store.count("shopping_items", {}),
    0,
    "pantry item must not appear on the list",
  );

  await executors.pantry_remove({ name: "recipe one" });
  await executors.shopping_build(week);
  assert.equal(await store.count("shopping_items", {}), 1, "now it should appear");
});
