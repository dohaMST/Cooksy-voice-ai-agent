/**
 * Gated executors. This is the ONLY code that writes business data, and it is
 * called exclusively by the approval gate after a successful atomic
 * pending -> executing transition. Nothing else may import these.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * @param {import("./store.mjs").Store} store
 * @param {object} opts
 * @param {string} opts.dataDir  where shopping_export writes its file (project-local)
 * @param {(ids: string[]) => Promise<Array<{id:string,name:string|null,thumb:string|null}>>} opts.resolveRecipes
 */
export function createExecutors(store, { dataDir, resolveRecipes }) {
  return {
    async pantry_update(args) {
      const name = args.name.trim().toLowerCase();
      const doc = {
        name,
        quantity: args.quantity,
        unit: args.unit,
        ...(args.bestBefore ? { bestBefore: args.bestBefore } : {}),
        updatedAt: Date.now(),
      };
      const res = await store.findOneAndUpdate("pantry_items", { name }, { $set: doc });
      if (!res.matched) await store.insertOne("pantry_items", doc);
      return { name, quantity: args.quantity, unit: args.unit };
    },

    async pantry_remove(args) {
      const name = args.name.trim().toLowerCase();
      const res = await store.removeOne("pantry_items", { name });
      if (!res.removed) throw new Error(`No pantry item called "${name}".`);
      return { removed: name };
    },

    async plan_set_meal(args) {
      const existing = await store.findOne("plan_entries", { date: args.date, meal: args.meal });
      if (existing && !args.replace) {
        throw new Error(`There is already "${existing.recipeName}" planned for ${args.meal} on ${args.date}.`);
      }
      const [recipe] = await resolveRecipes([args.recipeId]);
      const entry = {
        date: args.date,
        meal: args.meal,
        recipeId: args.recipeId,
        recipeName: recipe?.name ?? null,
        thumb: recipe?.thumb ?? null,
        createdAt: Date.now(),
      };
      if (existing) {
        await store.updateOne("plan_entries", { date: args.date, meal: args.meal }, { $set: entry });
      } else {
        await store.insertOne("plan_entries", entry);
      }
      return { date: args.date, meal: args.meal, recipeName: entry.recipeName };
    },

    async plan_clear_day(args) {
      const rows = await store.find("plan_entries", { date: args.date });
      for (const row of rows) {
        await store.removeOne("plan_entries", { _id: row._id });
      }
      return { cleared: args.date, removed: rows.length };
    },

    async shopping_build(args) {
      const plan = await store.find("plan_entries", rangeFilter(args));
      const ids = [...new Set(plan.map((p) => p.recipeId).filter(Boolean))];
      const recipes = ids.length ? await resolveRecipes(ids) : [];
      const thumbById = new Map(recipes.map((r) => [r.id, r]));

      const pantry = await store.find("pantry_items", {});
      const pantryNames = new Set(pantry.map((p) => p.name));

      // Rebuild the list from scratch (it is a derived view of the plan).
      const current = await store.find("shopping_items", {});
      for (const row of current) await store.removeOne("shopping_items", { _id: row._id });

      let added = 0;
      for (const entry of plan) {
        const recipe = thumbById.get(entry.recipeId);
        if (!recipe?.name) continue;
        const name = recipe.name.toLowerCase();
        if (pantryNames.has(name)) continue; // already in the pantry
        await store.insertOne("shopping_items", {
          name: recipe.name,
          quantity: 1,
          unit: "item",
          checked: false,
          sourceDates: [entry.date],
          updatedAt: Date.now(),
        });
        added++;
      }
      return { added };
    },

    async shopping_export() {
      const items = await store.find("shopping_items", {});
      await mkdir(dataDir, { recursive: true });
      const file = join(dataDir, "shopping-list.txt");
      const lines = [
        "Zafran shopping list",
        `Exported ${new Date().toISOString()}`,
        "",
        ...(items.length
          ? items.map((i) => `${i.checked ? "[x]" : "[ ]"} ${i.name} — ${i.quantity} ${i.unit}`)
          : ["(the shopping list is empty)"]),
        "",
      ];
      await writeFile(file, lines.join("\n"), "utf8");
      return { file, count: items.length };
    },
  };
}

function rangeFilter(args = {}) {
  const from = args.from ?? weekStart();
  const to = args.to ?? addDays(from, 6);
  return { date: { $gte: from, $lte: to } };
}

export function weekStart(d = new Date()) {
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // Monday-start week
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return toIsoDate(monday);
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return toIsoDate(d);
}

export function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}
