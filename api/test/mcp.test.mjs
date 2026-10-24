import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * MCP stdio handshake tests.
 *
 * These prove the tool server speaks the protocol and enforces the roster,
 * without OpenClaw and without cooksy-api being up: COOKSY_API_URL points at a
 * dead port, so anything that needs the API fails visibly instead of passing by
 * accident.
 */

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "mcp-server.mjs");

function session(extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      COOKSY_API_TOKEN: "test-token-0123456789abcdef",
      COOKSY_API_URL: "http://127.0.0.1:9",
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pending = new Map();
  let nextId = 0;
  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}; stderr=${stderr}`));
      }, 5000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  return { child, request, stderr: () => stderr, close: () => child.kill() };
}

test("initialize reports the cooksy server", async (t) => {
  const s = session();
  t.after(() => s.close());
  const res = await s.request("initialize");
  assert.equal(res.result.serverInfo.name, "cooksy");
  assert.ok(res.result.capabilities.tools, "advertises the tools capability");
});

test("tools/list exposes all 11 contract tools when no agent is pinned", async (t) => {
  const s = session();
  t.after(() => s.close());
  const res = await s.request("tools/list");
  assert.equal(res.result.tools.length, 11);
  const names = res.result.tools.map((tool) => tool.name);
  assert.ok(names.includes("pantry_list"));
  assert.ok(names.includes("shopping_export"));
});

test("no approve or deny tool exists, under any name", async (t) => {
  const s = session();
  t.after(() => s.close());
  const names = (await s.request("tools/list")).result.tools.map((tool) => tool.name);
  // Approval must stay unreachable from the agent side.
  assert.deepEqual(names.filter((n) => /approve|deny/i.test(n)), []);
});

test("every advertised tool carries a JSON input schema", async (t) => {
  const s = session();
  t.after(() => s.close());
  for (const tool of (await s.request("tools/list")).result.tools) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} needs an object schema`);
    assert.ok(tool.description?.length > 10, `${tool.name} needs a real description`);
  }
});

test("COOKSY_AGENT=cook gets the read tools only", async (t) => {
  const s = session({ COOKSY_AGENT: "cook" });
  t.after(() => s.close());
  const names = (await s.request("tools/list")).result.tools.map((tool) => tool.name);
  assert.deepEqual(names.sort(), [
    "pantry_list",
    "plan_view",
    "recipes_get",
    "recipes_search",
    "shopping_view",
  ]);
});

test("COOKSY_AGENT=planner gets everything", async (t) => {
  const s = session({ COOKSY_AGENT: "planner" });
  t.after(() => s.close());
  assert.equal((await s.request("tools/list")).result.tools.length, 11);
});

test("a pinned agent is refused a tool it does not hold", async (t) => {
  const s = session({ COOKSY_AGENT: "cook" });
  t.after(() => s.close());
  const res = await s.request("tools/call", {
    name: "pantry_update",
    arguments: { name: "rice", quantity: 1, unit: "bag" },
  });
  assert.equal(res.result.isError, true, "cook must not be able to call a gated write tool");
  assert.match(res.result.content[0].text, /does not hold/);
});

test("an unknown tool is a protocol error, not a silent success", async (t) => {
  const s = session();
  t.after(() => s.close());
  const res = await s.request("tools/call", { name: "delete_everything", arguments: {} });
  assert.equal(res.error.code, -32602);
});

test("an unknown method is reported as not found", async (t) => {
  const s = session();
  t.after(() => s.close());
  assert.equal((await s.request("resources/list")).error.code, -32601);
});

test("a missing agent token stops the server instead of starting a broken one", async () => {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, COOKSY_API_TOKEN: "", COOKSY_API_URL: "http://127.0.0.1:9" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => {
    stderr += c;
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 1, "should exit non-zero");
  assert.match(stderr, /COOKSY_API_TOKEN is required/);
});
