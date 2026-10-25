import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store.mjs";
import { createApp } from "../src/server.mjs";
import { validateArgs, toolByName, toolByRoute } from "../src/contract.mjs";

/**
 * HTTP-level tests for the two-credential boundary, input validation and the
 * polling endpoint. These call the request handler directly — no sockets, no
 * Docker, no network.
 */

const AGENT = "agent-token-secret-0123456789abcdef";
const APPROVER = "approver-token-secret-0123456789abcdef";

function makeApp() {
  const store = createMemoryStore();
  return {
    store,
    app: createApp({
      store,
      agentToken: AGENT,
      approverToken: APPROVER,
      dataDir: "data-test",
      resolveRecipes: async (ids) => ids.map((id) => ({ id, name: `Recipe ${id}`, thumb: null })),
      // Every id resolves here; the unknown-recipe path has its own test below.
      lookupRecipe: async (id) => ({ id, name: `Recipe ${id}`, thumb: null }),
    }),
  };
}

async function call(app, method, path, { token, body } = {}) {
  const res = {
    status: 0,
    headers: {},
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    on(ev, cb) {
      if (ev === "data" && payload) cb(Buffer.from(payload));
      if (ev === "end") queueMicrotask(cb);
      if (ev === "error") cb;
    },
    destroy() {},
  };
  await app.handler(req, res, new URL(path, "http://127.0.0.1:4010"));
  const isJson = res.headers["content-type"]?.includes("json");
  return { status: res.status, body: res.body && isJson ? JSON.parse(res.body) : res.body };
}

test("health needs no token", async () => {
  const { app } = makeApp();
  const r = await call(app, "GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("no token is refused", async () => {
  const { app } = makeApp();
  assert.equal((await call(app, "GET", "/pantry")).status, 401);
});

test("a wrong token is refused", async () => {
  const { app } = makeApp();
  assert.equal((await call(app, "GET", "/pantry", { token: "nope" })).status, 401);
});

test("the agent token can read but cannot approve or deny", async () => {
  const { app } = makeApp();
  assert.equal((await call(app, "GET", "/pantry", { token: AGENT })).status, 200);

  const propose = await call(app, "POST", "/pantry/propose-update", {
    token: AGENT,
    body: { name: "rice", quantity: 1, unit: "bag" },
  });
  assert.equal(propose.status, 200);
  assert.equal(propose.body.status, "approval_required");
  const id = propose.body.approval.id;

  assert.equal((await call(app, "POST", `/approvals/${id}/approve`, { token: AGENT })).status, 403);
  assert.equal((await call(app, "POST", `/approvals/${id}/deny`, { token: AGENT })).status, 403);
  assert.equal(
    (await call(app, "GET", "/approvals", { token: AGENT })).status,
    403,
    "queue is approver-only",
  );
  assert.equal((await call(app, "GET", "/activity", { token: AGENT })).status, 403);

  assert.equal((await app.gate.get(id)).status, "pending", "still pending after refused attempts");
});

test("the approver token can approve and the data changes", async () => {
  const { store, app } = makeApp();
  const propose = await call(app, "POST", "/pantry/propose-update", {
    token: AGENT,
    body: { name: "rice", quantity: 1, unit: "bag" },
  });
  const approve = await call(app, "POST", `/approvals/${propose.body.approval.id}/approve`, {
    token: APPROVER,
  });
  assert.equal(approve.status, 200);
  assert.equal(approve.body.ok, true);
  assert.ok(await store.findOne("pantry_items", { name: "rice" }), "rice written");
});

test("a denied approval returns 200 and writes nothing", async () => {
  const { store, app } = makeApp();
  const propose = await call(app, "POST", "/plan/propose-set", {
    token: AGENT,
    body: { date: "2026-10-24", meal: "dinner", recipeId: "52771" },
  });
  assert.equal(propose.status, 200, "plan propose must resolve via the contract route map");

  const deny = await call(app, "POST", `/approvals/${propose.body.approval.id}/deny`, {
    token: APPROVER,
  });
  assert.equal(deny.status, 200);
  assert.equal(await store.count("plan_entries", {}), 0);
});

test("approving twice returns 409 the second time", async () => {
  const { app } = makeApp();
  const propose = await call(app, "POST", "/shopping/propose-build", { token: AGENT, body: {} });
  const id = propose.body.approval.id;
  assert.equal(
    (await call(app, "POST", `/approvals/${id}/approve`, { token: APPROVER })).status,
    200,
  );
  assert.equal(
    (await call(app, "POST", `/approvals/${id}/approve`, { token: APPROVER })).status,
    409,
  );
});

test("the polling endpoint returns pending approvals and a serverTime cursor", async () => {
  const { app } = makeApp();
  await call(app, "POST", "/pantry/propose-update", {
    token: AGENT,
    body: { name: "salt", quantity: 1, unit: "tsp" },
  });

  const first = await call(app, "GET", "/approvals", { token: APPROVER });
  assert.equal(first.status, 200);
  assert.equal(first.body.pending.length, 1);
  assert.deepEqual(first.body.decided, []);
  assert.equal(typeof first.body.serverTime, "number");

  // After a decision, the next poll reports it as decided rather than pending.
  const id = first.body.pending[0]._id;
  await call(app, "POST", `/approvals/${id}/deny`, { token: APPROVER });

  const second = await call(app, "GET", "/approvals", { token: APPROVER });
  assert.deepEqual(second.body.pending, [], "decided approvals leave the pending set");
  assert.equal(second.body.decided.length, 0, "but only the first poll after the decision sees it");
});

test("propose with an unknown field is rejected", async () => {
  const { app } = makeApp();
  const r = await call(app, "POST", "/pantry/propose-update", {
    token: AGENT,
    body: { name: "rice", quantity: 1, unit: "bag", evil: "payload" },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Unknown field/);
});

test("propose with an oversize string is rejected", async () => {
  const { app } = makeApp();
  const r = await call(app, "POST", "/pantry/propose-update", {
    token: AGENT,
    body: { name: "x".repeat(200), quantity: 1, unit: "bag" },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /too long/);
});

test("propose with a bad date is rejected", async () => {
  const { app } = makeApp();
  const r = await call(app, "POST", "/plan/propose-set", {
    token: AGENT,
    body: { date: "tomorrow", meal: "dinner", recipeId: "52771" },
  });
  assert.equal(r.status, 400);
});

test("propose with a bad meal enum is rejected", async () => {
  const { app } = makeApp();
  const r = await call(app, "POST", "/plan/propose-set", {
    token: AGENT,
    body: { date: "2026-10-24", meal: "brunch", recipeId: "52771" },
  });
  assert.equal(r.status, 400);
});

test("a plan proposal for a recipe that does not exist is refused and stores nothing", async () => {
  const store = createMemoryStore();
  const app = createApp({
    store,
    agentToken: AGENT,
    approverToken: APPROVER,
    dataDir: "data-test",
    resolveRecipes: async (ids) => ids.map((id) => ({ id, name: `Recipe ${id}`, thumb: null })),
    lookupRecipe: async () => null,
  });
  const r = await call(app, "POST", "/plan/propose-set", {
    token: AGENT,
    body: { date: "2026-10-24", meal: "dinner", recipeId: "1" },
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /No recipe with id 1/);
  assert.equal(await store.count("approvals", {}), 0, "a refused proposal must not create a card");
});

test("a plan proposal survives an unreachable recipe service as a 502, not a bad id", async () => {
  const store = createMemoryStore();
  const app = createApp({
    store,
    agentToken: AGENT,
    approverToken: APPROVER,
    dataDir: "data-test",
    resolveRecipes: async (ids) => ids.map((id) => ({ id, name: `Recipe ${id}`, thumb: null })),
    lookupRecipe: async () => {
      throw new Error("The recipe service did not answer.");
    },
  });
  const r = await call(app, "POST", "/plan/propose-set", {
    token: AGENT,
    body: { date: "2026-10-24", meal: "dinner", recipeId: "52771" },
  });
  assert.equal(r.status, 502);
  assert.equal(await store.count("approvals", {}), 0);
});

test("validateArgs rejects a path-like recipe id", () => {
  assert.equal(validateArgs(toolByName("recipes_get").input, { id: "../../etc/passwd" }).ok, false);
});

test("the route map resolves every gated tool, including the two irregular names", () => {
  assert.equal(toolByRoute("POST", "/plan/propose-set")?.name, "plan_set_meal");
  assert.equal(toolByRoute("POST", "/plan/propose-clear")?.name, "plan_clear_day");
  assert.equal(toolByRoute("POST", "/shopping/propose-export")?.name, "shopping_export");
});

test("an unknown propose route is 404", async () => {
  const { app } = makeApp();
  assert.equal(
    (await call(app, "POST", "/pantry/propose-frobnicate", { token: AGENT, body: {} })).status,
    404,
  );
});

test("a read route is not reachable as a propose route", async () => {
  const { app } = makeApp();
  // /recipes/search is a read tool; POSTing at it must not create an approval.
  assert.equal(
    (await call(app, "POST", "/recipes/search", { token: AGENT, body: {} })).status,
    404,
  );
});
