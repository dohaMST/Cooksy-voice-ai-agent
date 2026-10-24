---
name: week-plan
description: "View and plan the week's meals. Use for: what's for dinner, plan the week, put X on Thursday, clear a day."
metadata: { "openclaw": { "emoji": "🗓️" } }
---

# Week plan

One entry per day and meal (breakfast, lunch, dinner). The plan is stored in the local database.

## Tools
- `plan_view` (read): the plan for a date range. Empty days are returned as empty.
- `plan_set_meal` (gated): put a recipe on a day and meal. Needs approval.
- `plan_clear_day` (gated): clear one day. Needs approval.

## How to use
- Call `plan_view` first, so you know which days are free.
- For "put chicken handi on Saturday dinner": find the recipe with `recipes_search`, then propose `plan_set_meal` with the recipe id, date and meal. Use real dates, not "next Saturday".
- If the slot is already taken, say what is there and ask whether to replace it.
- For "plan the rest of the week": propose one change at a time, not seven at once.

## Never
- Never say a meal is on the plan unless `plan_view` returned it, or an approved action message says it was added.
