import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeText, parseReply, parseScreen, stripMarkers } from "./screen.ts";

describe("parseScreen", () => {
  it("accepts a screen without the redundant kind discriminator", () => {
    const screen = parseScreen(JSON.stringify({ screen: { text: "Hello!", choices: [] }, app_commands: [] }));
    assert.equal(screen?.text, "Hello!");
  });

  it("still refuses a wrong kind", () => {
    assert.equal(parseScreen(JSON.stringify({ kind: "error", screen: { text: "x", choices: [] } })), null);
  });

  it("refuses prose and malformed JSON", () => {
    assert.equal(parseScreen("Sure, here is your pantry."), null);
    assert.equal(parseScreen("{not json"), null);
  });

  it("keeps a proposal only when every field the card needs is present", () => {
    const full = parseScreen(JSON.stringify({
      screen: { text: "Waiting for approval.", choices: [] },
      action_proposal: { id: "a1", title: "Add milk", tool: "cooksy__pantry_update", summary: "Adds 2 l of milk", risk: "low" },
    }));
    assert.equal(full?.actionProposal?.id, "a1");
    assert.equal(full?.actionProposal?.risk, "low");

    const partial = parseScreen(JSON.stringify({
      screen: { text: "Waiting for approval.", choices: [] },
      action_proposal: { id: "a1", title: "Add milk" },
    }));
    // An incomplete proposal is invalid output, not a silently half-rendered card.
    assert.equal(partial, null);
  });

  it("folds the narrow no-break space gpt-oss emits into a plain space", () => {
    assert.equal(normalizeText("add 2\u202fl of milk"), "add 2 l of milk");
    const screen = parseScreen(JSON.stringify({ screen: { text: "Use 2\u202fl of milk", choices: [] } }));
    assert.equal(screen?.text, "Use 2 l of milk");
  });
});

describe("parseReply", () => {
  it("treats plain prose as a complete answer", () => {
    const screen = parseReply("Your pantry has whole milk, eggs and rice.");
    assert.equal(screen.text, "Your pantry has whole milk, eggs and rice.");
    assert.deepEqual(screen.choices, []);
    assert.equal(screen.commands, undefined);
  });

  it("lifts a trailing console marker out of the spoken text", () => {
    const { text, commands } = stripMarkers("Here is your list.\n\n[[tab:kitchen]]");
    assert.equal(text, "Here is your list.");
    assert.deepEqual(commands, [{ name: "show_tab", value: "kitchen" }]);
  });

  it("refuses markers the console does not implement", () => {
    const { text, commands } = stripMarkers("Done. [[tab:nope]] [[rate:9]] [[agent:intruder]]");
    assert.equal(text, "Done.");
    // set_agent is passed through here and validated against the roster on apply.
    assert.deepEqual(commands.filter((c) => c.name !== "set_agent"), []);
  });

  it("still honours a structured screen when the model volunteers one", () => {
    const screen = parseReply(JSON.stringify({ screen: { text: "Hello!", choices: [] } }));
    assert.equal(screen.text, "Hello!");
  });

  it("never returns an empty screen", () => {
    assert.equal(parseReply("").text.length > 0, true);
    assert.equal(parseReply("[[tab:talk]]").text.length > 0, true);
  });
});
