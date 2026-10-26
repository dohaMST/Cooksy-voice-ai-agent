# Cooksy — a kitchen agents console

A voice and chat console for a kitchen, built on **OpenClaw**. Two agents share one kitchen:
**Cook** answers from what you actually have, **Planner** changes the pantry, the week plan and the
shopping list — and every change stops for your approval before it runs. You can type or hold the
mic and hear the answer back.

---

## What I built

- **Two agents, five skills.** `openclaw/agents/{cook,planner}` hold the personas and rules;
  `openclaw/skills/` holds the kitchen skills (pantry, recipes, week-plan, shopping, approvals).
  Cook gets the five read tools, Planner also gets the six that write.
- **A kitchen API with an approval gate** (`api/`): 11 tools over one MCP server, Mongo storage,
  TheMealDB as the recipe source, and a gate that turns every write into a pending approval.
- **A redesigned console**: `Talk` (conversation), `Kitchen` (pantry / week / shopping),
  `Run` (live turn + approval queue). Ember-glass visual language, its own landing page; the
  starter's spatial/WebXR room is gone.
- **Voice both ways**: microphone → Whisper transcript → agent → spoken reply (Kokoro, or the
  browser voice with no setup).
- **A conversation that survives** route changes and reloads (saved in this browser).

## The calls I made

1. **Two agents, not a crowd.** One reads, one writes. The split is visible in the UI and enforced
   by a per-agent tool allowlist, so "who can change my kitchen" is a one-line answer.
2. **The gate is the product, not the model.** A changing tool never writes: it stores one
   `approvals` row and returns `approval_required`. The server executes the stored action itself
   after a single atomic `pending → executing` transition, so a second click or a replay changes
   nothing; overdue approvals expire and leave a record instead of vanishing.
3. **Two credentials, on purpose.** The agent token can read and propose; only the console holds
   the approver token. Approving is the human's job, and it is unreachable from the model's side.
4. **Tools as a JSON contract.** `api/cooksy-tools.json` defines each tool's schema and route; the
   MCP server and the HTTP API are both generated from it, so a tool cannot exist in one and not
   the other.
5. **Plain prose with trailing markers instead of JSON screens.** OpenClaw always sends the agent's
   toolset, and the model answered "return JSON" by calling a tool literally named `JSON`, which
   Groq rejects. Prose plus `[[tab:…]]`-style markers removes that whole failure mode.
6. **Honest errors beat pretty ones.** Provider text is shown verbatim; the gateway's generic
   `internal error` is translated into what it usually means; a write that fails says so. Nothing
   is ever reported as done because it was attempted.
7. **The console writes the approval outcome into the chat.** The model is not part of the approval
   round-trip, so the console records "Added Egyptian Fatteh to lunch on Tue 27 Oct" from the
   stored approval and cooksy-api's own result — and jumps the Week tab to the week it changed.
8. **Per-browser state, no accounts.** Chat, voice, theme and agent choice live in `localStorage`.
   That keeps the app runnable with one command and no auth service.
9. **Scope cuts, stated rather than hidden.** The starter's headset room went; the shopping list is
   still dish-level (see Known limits); there is no purchased state yet.

## Where AI helped

I built this with an **AI coding agent (OpenCode)** as the pair — it wrote the bulk of the
implementation, the test suites and the first drafts of the docs, while I set the direction and
checked everything against the running system.

- **What the AI wrote:** cooksy-api and its approval gate, the MCP server, the console views and
  styling, the voice plumbing, and the unit tests (52 app + 50 api).
- **What I decided:** the domain, the rule that _no_ write executes without a human, the
  two-credential split, the tool surface, and the scope cuts. The gate is the security boundary, so
  I reviewed it line by line and made the AI prove each invariant with a test.
- **How it was used, not just that it was used:** spec first, then read every diff; every change had
  to pass `tsc`, `eslint`, `npm test` and the build, and then be exercised in the browser. The
  checks caught real things — a test that rotted with the calendar, a "thinking" panel that could
  never fill because the gateway sends no reasoning, an approval card offered for a slot that was
  already taken.
- **Where I overrode it:** it initially reported a model failure as "The agent stream failed" and a
  missing approval as if one existed; both now surface the real reason, and the console warns
  instead of pretending. An AI-written claim is only kept once the running app agrees with it.

---

## Run it

Five steps, in this order — each line says what breaks without it.

```bash
# 1. Environment. cooksy-api refuses to boot on a placeholder value.
cp .env.example .env

# 2. Mongo (127.0.0.1:27018) and Kokoro TTS (127.0.0.1:8880).
docker compose up -d

# 3. Kitchen API + approval gate (127.0.0.1:4010). Kitchen and Run answer 502 without it.
cd api && npm start

# 4. OpenClaw gateway (127.0.0.1:18789). Every turn fails without it.
#    It takes ~60-70 s to bind; `openclaw gateway status` can say "stopped" while the port is up.
openclaw gateway

# 5. The console (http://localhost:8080).
npm install
npm run dev
```

`/` is the landing page, `/console` is the console. The one-time gateway setup (agents, MCP server,
skills, model refs) is in `openclaw/README.md`.

```bash
npm run typecheck && npm test && npm run lint && npm run build   # app: 52 tests
cd api && npm test                                              # kitchen API: 51 tests, 1 skipped (Mongo)
```

## Map

| Path                                                         | What lives there                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `src/routes/console.tsx`                                     | The console: views, turn lifecycle, approval decisions, persistence |
| `src/routes/api/agent.ts`                                    | One turn to the gateway as `openclaw/<agent>`, streamed back        |
| `src/routes/api/kitchen.ts`, `approvals.ts`, `transcribe.ts` | Server routes; no token ever reaches the browser                    |
| `src/components/console-panels.tsx`                          | Approval card, pantry/week/shopping lists                           |
| `src/lib/cooksy/`                                            | Console↔API client, week maths, outcome wording                     |
| `api/`                                                       | Mongo store, 11-tool contract, approval gate, MCP server            |
| `openclaw/`                                                  | Gateway config, both agent workspaces, skills                       |

## Known limits

- **The shopping list is dish-level.** `shopping_build` lists the planned recipes, not their
  ingredients, and one row per meal, so the same dish twice appears twice. TheMealDB already
  returns ingredients; merging them is the next change, not something this build does.
- **Nothing can be marked bought.** `shopping_items.checked` exists and renders, but no tool or
  button writes it, so "items still to buy" counts everything.
- **Planner's reliability follows the model.** On the free tier's weaker fallback it sometimes
  describes an approval instead of making one; the console then refuses to show a card and says so
  ("nothing reached the approval queue"), rather than inventing one.
- **The agent is not told the outcome of an approval.** The console decides against cooksy-api and
  writes the result into the chat itself; the next turn sees that line, and the prompt forbids the
  agent from claiming a change on its own.
- **Free-tier quota is real.** A Cook turn is ~5–6k prompt tokens, a Planner turn that chains two
  tools ~13k; the free daily budget is a short conversation. Groq's Dev tier removes the cap.
- **No login.** Server routes require an `x-cooksy-console` header plus the approver token held
  server-side; that stops a stray page from approving, it is not user authentication.
- **State is per browser.** Chat (last 60 messages), voice, theme and agent choice live in
  `localStorage`; another browser starts empty. Settings → Run options → Conversation clears it.
- **`openclaw/openclaw.patch.json5` has absolute paths** for this machine: run
  `node scripts/localize-openclaw.mjs` after cloning elsewhere (`--check` fails if it still points
  outside the checkout). `npm test` needs Node 22.6+ (TypeScript via type stripping).

## Secrets

`.env` and `openclaw/.env` hold a live Groq key, the gateway token, the Mongo password and both
Cooksy tokens. Both files are gitignored and absent from history, but they are **not** safe to ship:
strip them before zipping, and rotate anything that has left your machine.
