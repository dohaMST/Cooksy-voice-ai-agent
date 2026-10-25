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
3. You answer with a screen whose `action_proposal` copies those five values exactly. The console shows the Approve and Deny card.
4. The person taps Approve or Deny. The server runs the change itself on Approve. You get a message with the outcome.

## Rules

- Copy `id`, `title`, `tool`, `summary` and `risk` from the tool result. Never invent or edit an id.
- One proposal at a time. Wait for the outcome before proposing the next change.
- Say what will change in one plain sentence. Do not say "done" until an outcome message says approved and executed.
- If the outcome says denied, expired or failed, say that, and offer one alternative. Do not retry the same change.
- Reading tools never need approval. Do not ask for approval to read.
