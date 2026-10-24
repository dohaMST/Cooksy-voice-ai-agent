---
name: shopping
description: "Show, build and export the shopping list from the week plan and the pantry. Use for: what do I need to buy, make my shopping list, export the list."
metadata: { "openclaw": { "emoji": "🛒" } }
---

# Shopping list

The list is what the planned recipes need, minus what the pantry already has.

## Tools
- `shopping_view` (read): the current list with quantities and checked items.
- `shopping_build` (gated): rebuild the list from the plan and the pantry. Replaces the unchecked items. Needs approval.
- `shopping_export` (gated): write the current list to a text file in the Cooksy data folder. Needs approval. It does not send anything to anyone.

## How to use
- Call `shopping_view` first. Say how many items and read out the first few, not all.
- To build: propose `shopping_build`, and say which days it covers.
- Where quantities cannot be added up (different units), keep them as separate lines. Do not convert silently.

## Never
- Never say the list was sent, emailed or shared. Only "exported to a file" after an approved `shopping_export`.
