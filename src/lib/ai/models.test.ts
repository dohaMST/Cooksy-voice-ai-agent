import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveGatewayModel } from "./models.ts";

describe("resolveGatewayModel", () => {
  it("maps an agent id to its gateway model", () => {
    assert.equal(resolveGatewayModel("cook"), "openclaw/cook");
    assert.equal(resolveGatewayModel("planner"), "openclaw/planner");
  });
  it("accepts an already-qualified gateway route unchanged", () => {
    assert.equal(resolveGatewayModel("openclaw/cook"), "openclaw/cook");
    assert.equal(resolveGatewayModel("openclaw/planner"), "openclaw/planner");
  });
  it("refuses the retired roster instead of swapping in another agent", () => {
    assert.equal(resolveGatewayModel("general"), null);
    assert.equal(resolveGatewayModel("ciso"), null);
    assert.equal(resolveGatewayModel("coder"), null);
  });
  it("refuses an unqualified model name and a missing pick", () => {
    assert.equal(resolveGatewayModel("openclaw/default"), null);
    assert.equal(resolveGatewayModel("gpt-5.6-terra"), null);
    assert.equal(resolveGatewayModel(undefined), null);
  });
});
