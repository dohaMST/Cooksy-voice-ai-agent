#!/usr/bin/env node
/**
 * cooksy MCP server (stdio).
 *
 * Exposes the tools from ../cooksy-tools.json to the OpenClaw gateway and
 * forwards each call to cooksy-api with the AGENT token.
 *
 * There is deliberately NO approve and NO deny tool here. Approval is an HTTP
 * route that only the console server can reach with the approver token, so the
 * model cannot approve its own proposal — not by calling a tool, and not by
 * forging a route, because it never holds the approver token.
 *
 * Protocol: JSON-RPC 2.0 over stdio, one JSON object per line (MCP stdio
 * transport). Implements initialize / tools/list / tools/call.
 *
 * COOKSY_AGENT (optional) narrows this process to one agent's tools: "cook"
 * gets the read tools only, "planner" gets everything. Set it per agent in the
 * gateway config so enforcement happens here, not by asking the model politely.
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";

const API_URL = (process.env.COOKSY_API_URL ?? "http://127.0.0.1:4010").replace(/\/$/, "");
const API_TOKEN = process.env.COOKSY_API_TOKEN ?? "";
const AGENT = process.env.COOKSY_AGENT ?? null;

if (!API_TOKEN) {
  // Fail loud: a tool server that 401s on every call is worse than no server.
  process.stderr.write("COOKSY_API_TOKEN is required.\n");
  process.exit(1);
}

const contract = JSON.parse(readFileSync(new URL("./cooksy-tools.json", import.meta.url), "utf8"));
const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "cooksy", version: "1.0.0" };

/** Tools this process may expose. */
function heldTools() {
  if (!AGENT) return contract.tools;
  return contract.tools.filter((t) => t.agents.includes(AGENT));
}

function toMcpTool(t) {
  return { name: t.name, description: t.description, inputSchema: t.input };
}

async function callApi(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${API_TOKEN}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Turn a tool call into its cooksy-api request, driven by the contract route.
 * Path params are substituted first; anything left becomes the query string on
 * a GET, or the JSON body on a POST.
 */
async function invoke(tool, args) {
  const [method, pattern] = tool.route.split(" ");
  const params = Object.keys(args ?? {}).filter((k) => pattern.includes(`:${k}`));
  const path = pattern.replace(/:([A-Za-z_]+)/g, (_, key) => encodeURIComponent(args[key]));

  if (method === "GET") {
    const rest = Object.fromEntries(
      Object.entries(args ?? {}).filter(([k]) => !params.includes(k)),
    );
    const qs = new URLSearchParams(rest).toString();
    return callApi("GET", qs ? `${path}?${qs}` : path);
  }
  return callApi("POST", path, args);
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const replyError = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return; // ignore non-JSON noise on the wire
  }
  const { id, method, params } = msg;

  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") return reply(id, {});

  if (method === "tools/list") {
    return reply(id, { tools: heldTools().map(toMcpTool) });
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const tool = contract.tools.find((t) => t.name === name);
    if (!tool) return replyError(id, -32602, `Unknown tool: ${name}`);
    if (AGENT && !tool.agents.includes(AGENT)) {
      return reply(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `The ${AGENT} agent does not hold "${name}".` }),
          },
        ],
        isError: true,
      });
    }
    try {
      const { ok, status, data } = await invoke(tool, args);
      // approval_required is a SUCCESSFUL outcome: the gated call did its job
      // by creating a pending approval. The agent copies it into its reply.
      reply(id, {
        content: [{ type: "text", text: JSON.stringify(data) }],
        isError: !ok,
      });
      void status;
    } catch (e) {
      reply(id, {
        content: [{ type: "text", text: JSON.stringify({ error: e.message }) }],
        isError: true,
      });
    }
    return;
  }

  if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
});
