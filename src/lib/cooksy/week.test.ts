import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRange, weekRange } from "./week.ts";

/** Sunday 25 October 2026, the last day of the week that starts on the 19th. */
const SUNDAY = new Date(2026, 9, 25);

test("weekRange starts on Monday and ends on Sunday", () => {
  assert.deepEqual(weekRange(0, SUNDAY), { from: "2026-10-19", to: "2026-10-25" });
});

test("a Monday is already the first day of its own week", () => {
  assert.deepEqual(weekRange(0, new Date(2026, 9, 26)), { from: "2026-10-26", to: "2026-11-01" });
});

test("offset weeks move by whole weeks and cross month boundaries", () => {
  assert.deepEqual(weekRange(1, SUNDAY), { from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(weekRange(-1, SUNDAY), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(weekRange(10, SUNDAY), { from: "2026-12-28", to: "2027-01-03" });
});

test("formatRange shortens a shared month and names both when it straddles", () => {
  assert.equal(formatRange("2026-10-19", "2026-10-25"), "19 – 25 Oct");
  assert.equal(formatRange("2026-10-26", "2026-11-01"), "26 Oct – 1 Nov");
});

test("formatRange falls back to the raw dates instead of inventing one", () => {
  assert.equal(formatRange("bad", "2026-11-01"), "bad → 2026-11-01");
});
