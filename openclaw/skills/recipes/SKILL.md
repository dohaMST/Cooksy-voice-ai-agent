---
name: recipes
description: "Find recipes and read their ingredients and steps. Use for: what can I make, a recipe for X, how do I cook X, ideas with chicken."
metadata: { "openclaw": { "emoji": "🍲" } }
---

# Recipes

Recipes come from TheMealDB, a free recipe database, through the cooksy tools.

## Tools

- `recipes_search` (read): search by dish name, main ingredient, or category. Returns names, photo, id.
- `recipes_get` (read): full recipe by id: ingredients with measures, steps, category, area.

## How to use

- "What can I make?": call `pantry_list`, then `recipes_search` on the main ingredients the person has. Offer two or three, not ten.
- Read ingredients and steps from `recipes_get`. Do not add ingredients that are not in the data.
- Match recipe ingredients against the pantry and say what is missing.

## Never

- TheMealDB has NO cooking time, calories or price. Never state any of these. Say "the recipe does not list a time".
- Never invent a recipe. If the search finds nothing, say so and ask for another ingredient or dish.
- If the tool errors, say that the recipe service did not answer. Do not make something up.
