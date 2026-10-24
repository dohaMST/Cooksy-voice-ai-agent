# OpenClaw setup for Cooksy

Prepared 2026-10-23 and executed 2026-10-24 on OpenClaw 2026.8.2. Facts below come from the installed OpenClaw docs and `openclaw config schema`, not from memory. Steps 1-9 have now been run on this machine.

## Status in this repository (2026-10-24)

- **Paths localised.** The four absolute paths the patch shipped with (cook workspace, planner workspace, MCP `args`, skills `extraDirs`) now point at `living-ai-talk/` on this machine; nothing under `~/Documents/Projects/` remains.
- **Renamed to Cooksy** throughout: agents `Cooksy Cook` / `Cooksy Planner`, MCP server `cooksy`, `COOKSY_API_URL`, `tools/cooksy-tools.json`.
- **`api/` is already built and tested** (`cooksy-api` + `api/mcp-server.mjs`; Phase 1 ended with 48 unit tests and 7 MongoDB integration tests green). **Step 6 below is therefore done** — the contract is `api/cooksy-tools.json`.
- **OpenClaw 2026.8.2 installed**, `@openclaw/groq-provider` installed (npm silently downgraded it from 2026.10.7 to the 2026.8.2 line), `GROQ_API_KEY` in `~/.openclaw/.env` — which is the only place the gateway reads it. A workspace `.env` such as this repo's is on OpenClaw's provider-credential blocklist and is ignored there, so the key has to exist in both places.
- **The Groq model refs needed one extra config block.** `config patch` validates model references through `resolveCanonicalPrimaryRef`, which only resolves providers declared under `models.providers`. The plugin's own catalog is not loaded on that path, so every `groq/...` ref failed as `Unknown model` even though `openclaw models set`, `models status` and the gateway all resolve the same refs. The patch now declares `models.providers.groq` (mirroring the plugin manifest, a runtime no-op) and validates. See the comment in `openclaw.patch.json5`.
- **The `COOKSY_AGENT` gap is closed, not patched around.** OpenClaw 2026.8.2 has no per-agent MCP scoping — `agents.entries.<id>.mcp` is rejected by the config schema — and MCP tools are namespaced `<server>__<tool>` across the whole gateway, so one server cannot present Cook's 5 tools and Planner's 11 at once. The split is enforced by per-agent `tools.alsoAllow`. `COOKSY_API_TOKEN` reaches the MCP process through `${COOKSY_API_TOKEN}` substitution from `~/.openclaw/.env`; the stored config keeps the literal placeholder, never the secret.
- **Verified live:** Cook's toolbelt is exactly `cooksy__pantry_list`, `cooksy__plan_view`, `cooksy__recipes_get`, `cooksy__recipes_search`, `cooksy__shopping_view` (plus OpenClaw's harmless `session_status`) — no gated tool, no `exec`, no file or web tool. Asked to change the plan it answered "the Planner handles that". Planner's gated call returned `approval_required` and left the plan empty.
- **Token budget is dominated by OpenClaw, not by us.** Measured prompt tokens for one Cook turn: 6,394 with all workspace files, 4,816 with `bootstrapMaxChars`/`bootstrapTotalMaxChars` at 1500, and 4,962 with the workspace gutted. The floor is OpenClaw's own system prompt plus the tool schemas, so the ~5,000-token target leaves almost no room for agent text; the patch uses 1500 to keep `IDENTITY.md` whole.
- **`?` in a reply is the model, not the transport.** gpt-oss-120b emits U+202F NARROW NO-BREAK SPACE in "2 l". The API body is pure ASCII. The console should normalise U+202F to a normal space when it renders.

## What is here
| Path | What |
|---|---|
| `openclaw.patch.json5` | gateway, two agents, our MCP server, skills folder. No secrets. |
| `agents/cook/`, `agents/planner/` | workspace files per agent (`AGENTS.md` = rules, `SOUL.md` = voice). Kept short because Groq's free tier is limited by tokens per day. |
| `skills/{pantry,recipes,week-plan,shopping,approvals}/SKILL.md` | when and how to use each tool |
| `tools/cooksy-tools.json` | the contract of the 11 tools (5 read, 6 gated) that the MCP server must implement |

## Models and voice (all free to start)
- Chat: `groq/openai/gpt-oss-120b`, fallback `groq/openai/gpt-oss-20b`. Needs the Groq plugin and `GROQ_API_KEY`.
- Speech to text: Whisper on Groq (`whisper-large-v3-turbo`, also OpenClaw's default for Groq audio), called from the console's server route with the same key. Reported free limit is 28,800 audio seconds a day (from a comparison site, not Groq's page; check it). Whisper is MIT licensed, so a local copy (speaches, optional profile in `docker-compose.yml`) is the free offline alternative.
- Text to speech: Kokoro in `docker-compose.yml`.

## Start-up order
1. `cp .env.example .env`, fill `MONGO_ROOT_PASSWORD` yourself. Then `docker compose up -d mongo`.
2. Install the Groq plugin: `openclaw plugins install @openclaw/groq-provider`, then put `GROQ_API_KEY=...` in `~/.openclaw/.env` (the gateway reads it from there). Do not paste the key in chat.
3. Validate the patch without writing: `openclaw config patch --file openclaw/openclaw.patch.json5 --dry-run`.
4. Apply it: `openclaw config patch --file openclaw/openclaw.patch.json5`. Then set the gateway token: `openclaw config set gateway.auth.token <a long random value>`.
5. Check agents and skills: `openclaw agents list`, `openclaw skills check --agent cook`.
6. ~~Build `api/` (cooksy-api and `api/mcp-server.mjs`) from `tools/cooksy-tools.json`.~~ **Done in Phase 1.**
7. `openclaw mcp probe cooksy` lists the real tool names. **Verified:** 11 tools, namespaced `cooksy__<tool>`, matching the contract one for one.
8. The patch already carries those names in `agents.entries.cook.tools.alsoAllow` (the 5 read tools) and `agents.entries.planner.tools.alsoAllow` (read plus the 6 gated tools). Re-apply the patch after any change here.
9. Run the gateway (`openclaw gateway`) and test `POST http://127.0.0.1:18789/v1/chat/completions` with the gateway token. **Verified:** `GET /v1/models` advertises `openclaw`, `openclaw/default`, `openclaw/main`, `openclaw/cook` and `openclaw/planner`, and `"model": "openclaw/cook"` routes to Cook.

## Safety choices
- Gateway bound to loopback with token auth. `exec` is denied; agents have no shell. The workspace folder is a working directory, not a sandbox, so file access is also kept off by the minimal tool profile — **verified from the agent's own tool list**, which contains no `exec`, file or web tool.
- OpenClaw has its own `approvals` setting for forwarding shell approvals to chat apps. We do not use it: our approval lives in the console and cooksy-api, so the card, the audit log and the database change stay together.
- Approve and Deny are not tools. Only the browser can call them, so the model cannot approve its own change.

## Not decided
- Whether a router agent is needed in front of Cook and Planner (current plan: the app switches agents with `set_agent`).
- Exact model fallback order after measuring Groq's daily token use. Measured so far: a Cook turn costs 4,816-6,394 prompt tokens depending on the bootstrap setting (plus 150-325 completion), with Groq prompt caching returning 1,024-2,048 cached tokens on repeat turns. Planner's gated turn measured 12,925 prompt / 1,557 completion, because it chains `recipes_search` and then `plan_set_meal`.
- `openai/gpt-oss-120b` handled tool calls correctly in every run — right tool, right arguments, `approval_required` passed through unchanged — so the 20b fallback and `qwen/qwen3.6-27b` were not needed.
