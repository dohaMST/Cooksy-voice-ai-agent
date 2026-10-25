/**
 * cooksy-api — a small local API over MongoDB with the 11 tools and the
 * approval gate. Binds to 127.0.0.1 only.
 *
 * Two credentials on purpose:
 *   COOKSY_API_TOKEN       — the agent side (MCP server). Reads + propose-*.
 *   COOKSY_APPROVER_TOKEN  — the console server side. Approve + deny + reads.
 * The agent token is refused on approve and deny. The model never holds either.
 *
 * Configuration comes only from ./config.mjs, which fails loud at boot.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";
import { createApprovalGate } from "./gate.mjs";
import { createExecutors, weekStart, addDays } from "./executors.mjs";
import { summarize } from "./summarize.mjs";
import { validateArgs, toolByName, toolByRoute, TOOLS } from "./contract.mjs";
import * as mealdb from "./mealdb.mjs";

const HOST = "127.0.0.1";
const SWEEP_INTERVAL_MS = 60_000;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Build the app (routes + gate) against a Store. Exported so the tests can
 * drive it with no network listener and no live MongoDB.
 */
export function createApp({ store, agentToken, approverToken, dataDir = "data", resolveRecipes }) {
  const resolve = resolveRecipes ?? mealdb.lookupSummaries;
  const executors = createExecutors(store, { dataDir, resolveRecipes: resolve });
  const gate = createApprovalGate(
    store,
    async (tool, args) => {
      const fn = executors[tool];
      if (!fn) throw new Error(`No executor for ${tool}`);
      return fn(args);
    },
    summarize,
  );

  async function handle(req, res, url) {
    const method = req.method ?? "GET";
    const path = url.pathname.replace(/\/$/, "") || "/";

    // --- health: no auth, so a supervisor can probe liveness ---
    if (method === "GET" && path === "/health") {
      return json(res, 200, { ok: true, service: "cooksy-api", tools: TOOLS.length });
    }

    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const isAgent = Boolean(token) && constantTimeEqual(token, agentToken);
    const isApprover = Boolean(token) && constantTimeEqual(token, approverToken);

    if (!isAgent && !isApprover) {
      return json(res, 401, { error: "Missing or invalid token." });
    }

    // --- approver-only: the approval queue and the audit trail ---
    if (path === "/approvals" && method === "GET") {
      if (!isApprover) {
        return json(res, 403, { error: "The approval queue needs the approver token." });
      }
      const since = Number(url.searchParams.get("since") ?? 0) || 0;
      const [pending, decided] = await Promise.all([
        gate.pendingList(),
        since > 0
          ? store.find("approvals", {
              status: { $in: ["executed", "denied", "failed", "expired"] },
              decidedAt: { $gt: since },
            })
          : Promise.resolve([]),
      ]);
      // `serverTime` is what the client echoes back as `since` on the next poll.
      return json(res, 200, { pending, decided, serverTime: Date.now() });
    }

    let m = path.match(/^\/approvals\/([^/]+)$/);
    if (m && method === "GET") {
      if (!isApprover) {
        return json(res, 403, { error: "Approvals can only be read with the approver token." });
      }
      const doc = await gate.get(m[1]);
      return doc ? json(res, 200, doc) : json(res, 404, { error: "No such approval." });
    }

    m = path.match(/^\/approvals\/([^/]+)\/approve$/);
    if (m && method === "POST") {
      // The agent token must never reach this branch: approving is the human's
      // only job in the whole system.
      if (!isApprover) return json(res, 403, { error: "Only the console can approve." });
      const out = await gate.approve(m[1], "browser");
      return json(res, out.ok ? 200 : statusFor(out.code), out);
    }

    m = path.match(/^\/approvals\/([^/]+)\/deny$/);
    if (m && method === "POST") {
      if (!isApprover) return json(res, 403, { error: "Only the console can deny." });
      const out = await gate.deny(m[1], "browser");
      return json(res, out.ok ? 200 : statusFor(out.code), out);
    }

    if (path === "/activity" && method === "GET") {
      if (!isApprover) {
        return json(res, 403, { error: "The audit trail needs the approver token." });
      }
      const since = Number(url.searchParams.get("since") ?? 0);
      return json(res, 200, { events: await gate.activitySince(since) });
    }

    // --- reads: either token ---
    if (path === "/pantry" && method === "GET") {
      const name = url.searchParams.get("name");
      const filter = name ? { name: name.trim().toLowerCase() } : {};
      return json(res, 200, { items: await store.find("pantry_items", filter) });
    }

    if (path === "/plan" && method === "GET") {
      const from = url.searchParams.get("from") ?? weekStart();
      const to = url.searchParams.get("to") ?? addDays(from, 6);
      const entries = await store.find("plan_entries", { date: { $gte: from, $lte: to } });
      return json(res, 200, { from, to, entries });
    }

    if (path === "/shopping" && method === "GET") {
      return json(res, 200, { items: await store.find("shopping_items", {}) });
    }

    if (path === "/recipes/search" && method === "GET") {
      const query = url.searchParams.get("query") ?? "";
      const by = url.searchParams.get("by") ?? "name";
      const v = validateArgs(toolByName("recipes_search").input, { query, by });
      if (!v.ok) return json(res, 400, { error: v.error });
      try {
        return json(res, 200, { results: await mealdb.search(v.value.query, by) });
      } catch (e) {
        return json(res, 502, { error: e.message });
      }
    }

    m = path.match(/^\/recipes\/([^/]+)$/);
    if (m && method === "GET") {
      const v = validateArgs(toolByName("recipes_get").input, { id: m[1] });
      if (!v.ok) return json(res, 400, { error: v.error });
      try {
        return json(res, 200, await mealdb.get(v.value.id));
      } catch (e) {
        return json(res, 502, { error: e.message });
      }
    }

    // --- propose-*: the agent side. Gated, and writes only an approval row. ---
    if (method === "POST") {
      const def = toolByRoute("POST", path);
      if (def?.gated) {
        const body = await parseBody(req);
        const v = validateArgs(def.input, body);
        if (!v.ok) return json(res, 400, { error: v.error });
        const out = await gate.propose({ tool: def.name, args: v.value, risk: def.risk });
        return json(res, 200, out);
      }
    }

    return json(res, 404, { error: "No such route." });
  }

  return { gate, executors, handler: handle };
}

function statusFor(code) {
  switch (code) {
    case "not_found":
      return 404;
    case "expired":
      return 410;
    case "failed":
      return 500;
    default:
      return 409; // already_denied / already_executed / already_executing
  }
}

/**
 * Start a real HTTP listener and the expiry sweeper.
 * @param {ReturnType<import("./config.mjs").loadConfig>} config
 */
export async function startServer(config) {
  const store = await createStore(config);
  const app = createApp({
    store,
    agentToken: config.agentToken,
    approverToken: config.approverToken,
    dataDir: config.dataDir,
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    app.handler(req, res, url).catch((e) => json(res, 500, { error: e.message }));
  });

  await new Promise((r) => server.listen(config.port, HOST, r));

  const sweep = () =>
    app.gate.sweep().catch((e) => process.stderr.write(`sweep failed: ${e.message}\n`));
  await sweep(); // clear anything that aged out while the API was down
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.();

  async function close() {
    clearInterval(timer);
    await new Promise((r) => server.close(r));
    await store.close();
  }

  return { server, close, app, store, port: config.port };
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  const { loadConfig } = await import("./config.mjs");
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    // Fail loud: never boot half-configured.
    process.stderr.write(`cooksy-api config error: ${e.message}\n`);
    process.exit(1);
  }
  try {
    const { close } = await startServer(config);
    const target = config.store === "mongo" ? `mongo, db=${config.mongo.dbName}` : "memory";
    process.stdout.write(`cooksy-api listening on http://${HOST}:${config.port} (${target})\n`);
    const shutdown = async () => {
      await close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (e) {
    process.stderr.write(`cooksy-api failed to start: ${e.message}\n`);
    process.exit(1);
  }
}
