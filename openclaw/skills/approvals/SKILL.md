---
name: approvals
description: "How to ask the person before changing anything. Use whenever a tool returns approval_required, or before any change to the pantry, plan or list."
metadata: { "openclaw": { "emoji": "✋" } }
---

# Approvals

Changes never run on their own. The person decides.

## What happens

1. You call a gated tool, for example `plan_set_meal`.
2. The tool does not change anything. It returns `status: "approval_required"` with `approval: { id, title, tool, summary, risk }`.
3. You answer in one plain spoken sentence saying the change is waiting for the cook to approve or deny. The console builds the card from its own queue, so you do not send ids, fields or JSON.
4. The person taps Approve or Deny. The server runs the change itself on Approve. You are not sent the outcome, so you cannot report it unless the person tells you.

## Rules

- Never invent, repeat or promise an approval. The console shows the real one.
- One proposal at a time. Wait for the person before proposing the next change.
- Say what will change in one plain sentence. Never say "done": you are not told when the action runs.
- If the person says it was denied, expired or failed, accept that and offer one alternative. Do not retry the same change.
- Reading tools never need approval. Do not ask for approval to read.
