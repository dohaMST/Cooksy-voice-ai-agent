import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_VERSION, fromStored, MAX_MESSAGES, MAX_TEXT, toStored } from "./persist.ts";

const turn = (id: string, text = "hello", at = 0) => ({ id, role: "user" as const, text, at });

test("a round trip keeps the fields the console renders", () => {
  const messages = [
    { id: "1", role: "user" as const, text: "add 1kg banana", at: 10, liked: false },
    {
      id: "2",
      role: "assistant" as const,
      text: "Added 1 kg of banana.",
      at: 20,
      sender: "Kitchen",
      system: true,
      steps: [{ label: "Agent", at: 20 }],
    },
  ];
  const restored = fromStored(toStored(messages));
  assert.deepEqual(restored, [
    { id: "1", role: "user", text: "add 1kg banana", at: 10 },
    {
      id: "2",
      role: "assistant",
      text: "Added 1 kg of banana.",
      at: 20,
      sender: "Kitchen",
      system: true,
      steps: [{ label: "Agent", at: 20 }],
    },
  ]);
});

test("reasoning is not stored because it is never populated", () => {
  const stored = toStored([{ ...turn("1"), reasoning: "thinking about it" } as never]);
  assert.equal("reasoning" in (stored.messages[0] ?? {}), false);
});

test("a long chat keeps the newest messages", () => {
  const messages = Array.from({ length: MAX_MESSAGES + 12 }, (_, i) => turn(String(i)));
  const stored = toStored(messages);
  assert.equal(stored.messages.length, MAX_MESSAGES);
  assert.equal(stored.messages[0]?.id, "12");
  assert.equal(stored.messages.at(-1)?.id, String(MAX_MESSAGES + 11));
});

test("a huge answer is capped, and says so", () => {
  const long = "x".repeat(MAX_TEXT + 500);
  const stored = toStored([turn("1", long)]);
  assert.equal(stored.messages[0]?.text.length, MAX_TEXT + 1);
  assert.ok(stored.messages[0]?.text.endsWith("…"));
});

test("nothing stored yet, or junk, restores as an empty chat", () => {
  for (const raw of [undefined, null, {}, [], "nope", 42, { v: 1 }, { v: 2, messages: [] }]) {
    assert.deepEqual(fromStored(raw), [], `raw=${JSON.stringify(raw)}`);
  }
});

test("a corrupt row is dropped instead of crashing the console", () => {
  const raw = {
    v: CHAT_VERSION,
    messages: [
      turn("1"),
      { id: 2, role: "user", text: "no id", at: 0 },
      { id: "3", role: "system", text: "wrong role", at: 0 },
      { id: "4", role: "assistant", text: "no timestamp" },
      turn("5"),
    ],
  };
  assert.deepEqual(
    fromStored(raw).map((m) => m.id),
    ["1", "5"],
  );
});

test("a stored chat is capped again on the way in", () => {
  const raw = {
    v: CHAT_VERSION,
    messages: Array.from({ length: MAX_MESSAGES + 5 }, (_, i) =>
      turn(String(i), "x".repeat(MAX_TEXT + 10)),
    ),
  };
  const restored = fromStored(raw);
  assert.equal(restored.length, MAX_MESSAGES);
  assert.equal(restored.at(-1)?.text.length, MAX_TEXT + 1);
});
