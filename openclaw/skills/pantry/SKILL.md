---
name: pantry
description: "Check what food the household has, and propose changes to the pantry. Use for: what do I have, do we have X, running low, I bought/used X."
metadata: { "openclaw": { "emoji": "🫙" } }
---

# Pantry

The pantry is the household's real stock, stored in the local database.

## Tools
- `pantry_list` (read): all items, or filter by name. Each item has name, quantity, unit, optional best-before date.
- `pantry_update` (gated): add an item or change its quantity. Needs approval.
- `pantry_remove` (gated): remove an item. Needs approval.

## How to use
- Before suggesting a recipe, call `pantry_list`. Say which main ingredients the pantry already has.
- "Running low" means a quantity the tool reports as low. Do not guess a threshold.
- For "I bought two kilos of rice": propose `pantry_update` with the unit as the person said it.
- If the person gives no unit or quantity, ask one short question.

## Never
- Never claim an item is in stock without calling `pantry_list` first.
- Never remove an item unless the person asked to remove it.
