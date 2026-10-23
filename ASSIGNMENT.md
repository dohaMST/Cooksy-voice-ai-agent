# AI & Agent Engineering Assignment — Doha Mastor

**Build something worth talking to. Make it look like yours.**

We're handing you the same starting project we gave our other candidates — a working voice console
that can listen, think out loud, and show its work. Your brief has two parts: **give it a brain** and
**make it look completely different**.

The original brief we gave the other candidates is in `ORIGINAL-ASSIGNMENT/` for context. Read it
if you want background, but your rules are below.

---

## 1. What you will build

### Part A — Your own agents

The starter has four example agents in the dropdown (OpenClaw orchestrator, CISO, Project planner,
Engineering lead). **Delete all of them.** Register your own agents in `src/lib/settings/voice.ts`
and build whatever you find genuinely useful — a research assistant, a trip planner, a code
reviewer, a language tutor, a game master, anything. There is no single right answer.

Use OpenClaw as your agent framework. Your agents live in the `openclaw/` folder.

### Part B — Your own frontend

The starter UI is reference code, not a template to keep. **Redesign it.** Change the layout, the
colour scheme, the typography, the component structure — everything visible. When we open it, it
should feel nothing like the starter.

The internals you keep (the voice plumbing, the approval panel, the `/api/agent` bridge) are the
floor, not the ceiling.

---

## 2. Voice talk AI — required

Voice in and voice out must work. Here is the stack we recommend:

### Listening (speech → text)
- The starter already records audio with the browser mic (`getUserMedia` / `AudioContext` in
  `src/lib/voice/record-wav.ts`) and sends it to `/api/transcribe`.
- That route posts to any Whisper-compatible server. You point it with `OPENCLAW_GATEWAY_URL`.
- **Local options:** `faster-whisper` (Python, tiny model runs on CPU) or the `speaches` Docker
  image (`ghcr.io/speaches-ai/speaches:latest-cpu`).
- **Cloud options:** any OpenAI-compatible `/v1/audio/transcriptions` endpoint (OpenAI, Groq, etc.).

### Speaking (text → speech)
- **Baseline:** the starter already uses the Web Speech API (`speechSynthesis`) — free, no setup.
- **Better quality:** Kokoro or Piper running locally, or a cloud TTS endpoint behind
  `OPENCLAW_SPEECH_MODEL` / `OPENCLAW_SPEECH_VOICE` in your `.env`.
- **Optional:** Web Audio API for visualisation; Silero VAD for hands-free mode.

You do not have to build the voice stack from scratch — the starter routes are already wired.
Configure them, or swap them out. Either is fine.

---

## 3. What stays, what goes

| Keep (working infrastructure) | Replace (your work) |
|---|---|
| `/api/agent` bridge | All 4 dropdown agents |
| `/api/transcribe` and `/api/speak` routes | The `unified-plan.yaml` example plan |
| The approval panel | The layout, colours, typography |
| `openclaw/` folder structure | The starter components and screens |
| The OpenClaw gateway wiring | The `AGENTS` roster in `voice.ts` |

When in doubt: if it is content or design, make it yours. If it is plumbing, keep it.

---

## 4. Rules

- **Use AI tools.** We expect it. Note in your README where they helped.
- **No fake results.** If something fails, show the real error. Never silently swap in mock data.
- **Risky actions wait.** Anything consequential — a write, a send, a delete — must pause and ask
  a human first. The approval panel is already there; wire your agent to it.
- **No fake voice.** Voice in and voice out must actually work end to end.

---

## 5. Deadline

A weekend is the expected scope. A small, sharp, working system beats a large half-finished one.

---

## 6. What to send

- Your code (repo link or zip).
- The `openclaw/` folder with your agents and skills so we can run them.
- A short README: what you built, the calls you made, and where AI helped.

---

## 7. What happens next

We will sit down together and walk through what you built — your choices, your trade-offs, and a
small live extension. It is a conversation, not a test. You will hear back from us either way.

---

## Appendix — the agent contract

*Skip this until you have started. Come back when you are wiring the agent.*

### Plain replies

Your agent can return plain text and the console will show it as-is.

### Interactive screens

To drive the console's buttons, choices and voice, return a JSON screen:

```json
{
  "kind": "screen",
  "screen": {
    "text": "What the agent says out loud",
    "choices": [
      { "id": "yes", "label": "Yes", "value": "Yes, go ahead" },
      { "id": "no",  "label": "No",  "value": "Cancel" }
    ],
    "navigation": ["home"]
  }
}
```

### Approval panel

To pause before a risky action, include an `action_proposal` in the screen:

```json
{
  "kind": "screen",
  "screen": { "text": "I am about to send this email. Approve?" },
  "action_proposal": {
    "id": "act_abc123",
    "title": "Send email to team",
    "summary": "Sends the draft to all@company.com.",
    "tool": "email.send",
    "risk": "medium"
  }
}
```

The console shows the Approve / Deny card automatically. Your `/api/agent` route receives the
decision and acts on it (or does nothing).

### App commands

To switch the active agent from inside a response:

```json
{ "app_commands": [{ "name": "set_agent", "value": "your-agent-id" }] }
```
