/**
 * zafran-api — a small local API over MongoDB with the 11 tools and the
 * approval gate. Binds to 127.0.0.1 only.
 *
 * Two credentials on purpose:
 *   ZAFRAN_API_TOKEN       — the agent side (MCP server). Reads + propose-*.
 *   ZAFRAN_APPROVER_TOKEN  — the console server side. Approve + deny + reads.
 * The agent token is refused on approve and deny. The model never holds either.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createMemoryStore, createMongoStore } from "./store.mjs";
import { createApprovalGate } from "./gate.mjs";
import { createExecutors, weekStart, addDays } from "./executors.mjs";
import { summarize } from "./summarize.mjs";
import { validateArgs, toolByName, TOOLS } from "./contract.mjs";
import * as mealdb from "./mealdb.mjs";

const HOST = "127.0.0.1";

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

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
 * Build the app (routes + gate) against a Store. Exported so tests can drive
 * it without a network listener or a live MongoDB.
 */
export function createApp({ store, agentToken, approverToken, dataDir = "data", resolveRecipes }) {
  const executors = createExecutors(store, { dataDir, resolveRecipes });
  const gate = createApprovalGate(store, async (tool, args) => {
    const fn = executors[tool];
    if (!fn) throw new Error(`No executor for ${tool}`);
    return fn(args);
  }, summarize);

  async function handle(req, res, url) {
    const method = req.method ?? "GET";
    const path = url.pathname.replace(/\/$/, "") || "/";

    // --- health (no auth) ---
    if (method === "GET" && path === "/health") {
      return json(res, 200, { ok: true, service: "zafran-api", tools: TOOLS.length });
    }

    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const isAgent = token && constantTimeEqual(token, agentToken);
    const isApprover = token && constantTimeEqual(token, approverToken);

    if (!isAgent && !isApprover) return json(res, 401, { error: "Missing or invalid token." });

    // --- browser/approver-only: approve and deny ---
    if (path === "/approvals" && method === "GET") {
      requireApprover();
      return json(res, 200, { approvals: await gate.pendingList() });
    }
    let m = path.match(/^\/approvals\/([^/]+)$/);
    if (m && method === "GET") {
      if (!isApprover) return json(res, 403, { error: "Approvals can only be read with the approver token." });
      const doc = await gate.get(m[1]);
      return doc ? json(res, 200, doc) : json(res, 404, { error: "No such approval." });
    }
    m = path.match(/^\/approvals\/([^/]+)\/approve$/);
    if (m && method === "POST") {
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
      requireApprover();
      const since = Number(url.searchParams.get("since") ?? 0);
      return json(res, 200, { events: await gate.activitySince(since) });
    }

    // --- reads (either token) ---
    if (path === "/pantry" && method === "GET") {
      const name = url.searchParams.get("name");
      const filter = name ? { name: name.trim().toLowerCase() } : {};
      return json(res, 200, { items: await store.find("pantry_items", filter) });
    }
    if (path === "/plan" && method === "GET") {
      const from = url.searchParams.get("from") ?? weekStart();
      const to = url.searchParams.get("to") ?? addDays(from, 6);
      return json(res, 200, { from, to, entries: await store.find("plan_entries", { date: { $gte: from, $lte: to } }) });
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

    // --- propose-* (agent side): gated, writes only an approval row ---
    m = path.match(/^\/([a-z_]+)\/propose-([a-z-]+)$/);
    if (m && method === "POST") {
      const tool = `${m[1]}_${m[2].replace(/-/g, "_")}`;
      const def = toolByName(tool);
      if (!def || !def.gated) return json(res, 404, { error: "Unknown tool." });
      const body = await parseBody(req);
      const v = validateArgs(def.input, body);
      if (!v.ok) return json(res, 400, { error: v.error });
      const out = await gate.propose({ tool, args: v.value, risk: def.risk });
      return json(res, 200, out);
    }

    return json(res, 404, { error: "No such route." });

    function requireApprover() {
      /* already validated above */
    }
  }

  return {
    gate,
    executors,
    async fetch(request) {
      const url = new URL(request.url, `http://${HOST}`);
      const resHeaders = {};
      const res = {
        writeHead(status, headers = {}) {
          Object.assign(resHeaders, headers);
          this.status = status;
          return this;
        },
        end(payload) {
          this.body = payload;
          this.finished = true;
        },
      };
      await handle(request, res, url);
      return new Response(res.body ?? null, { status: res.status ?? 200, headers: resHeaders });
    },
    handler: handle,
  };
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

/** Start a real HTTP listener. Used by `npm start`. */
export async function startServer(opts) {
  const app = createApp(opts);
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    app.handler(req, res, url).catch((e) => json(res, 500, { error: e.message }));
  });
  const port = Number(opts.port ?? 4010);
  await new Promise((r) => server.listen(port, HOST, r));
  return { server, port, app };
}
