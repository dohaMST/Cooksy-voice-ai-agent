/**
 * TheMealDB client. Free, no key, read-only recipe source.
 * Base: https://www.themealdb.com/api/json/v1/1/
 * On any upstream failure we throw with a real message; the caller maps it to
 * a 502. We never return a canned recipe.
 */

const BASE = "https://www.themealdb.com/api/json/v1/1";
const TIMEOUT_MS = 8000;

class UpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = "UpstreamError";
    this.status = 502;
  }
}

async function fetchJson(url, signal) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new UpstreamError("The recipe service did not answer.");
  }
  if (!res.ok) throw new UpstreamError(`The recipe service returned ${res.status}.`);
  return res.json();
}

function withTimeout(signal) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  ctrl.signal.addEventListener("abort", () => clearTimeout(t), { once: true });
  return ctrl.signal;
}

function trimMeal(m) {
  return { id: m.idMeal, name: m.strMeal, thumb: m.strMealThumb };
}

/** Search by name, main ingredient, or category. */
export async function search(query, by = "name", signal) {
  const q = encodeURIComponent(query.trim());
  const key =
    by === "ingredient" ? "filter.php?i=" : by === "category" ? "filter.php?c=" : "search.php?s=";
  const data = await fetchJson(`${BASE}/${key}${q}`, withTimeout(signal));
  const meals = data.meals ?? [];
  return meals.map(trimMeal);
}

/** Full recipe: ingredients with measures, steps, category, area. */
export async function get(id, signal) {
  const data = await fetchJson(
    `${BASE}/lookup.php?i=${encodeURIComponent(id)}`,
    withTimeout(signal),
  );
  const meal = data.meals?.[0];
  if (!meal) throw new UpstreamError("No recipe with that id.");
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = meal[`strIngredient${i}`]?.trim();
    if (!name) continue;
    ingredients.push({ name, measure: (meal[`strMeasure${i}`] ?? "").trim() });
  }
  return {
    id: meal.idMeal,
    name: meal.strMeal,
    thumb: meal.strMealThumb,
    category: meal.strCategory ?? "",
    area: meal.strArea ?? "",
    instructions: (meal.strInstructions ?? "").trim(),
    ingredients,
    // TheMealDB has no cooking time or calories. Never invent them.
    source: "TheMealDB",
  };
}

/**
 * Resolve a set of recipe ids to { id, name, thumb } for plan entries.
 * Returns a null-safe shape; unknown ids are returned with a null name so the
 * caller can report them rather than silently dropping the slot.
 */
export async function lookupSummaries(ids, signal) {
  const out = [];
  for (const id of ids) {
    try {
      const data = await fetchJson(
        `${BASE}/lookup.php?i=${encodeURIComponent(id)}`,
        withTimeout(signal),
      );
      const meal = data.meals?.[0];
      out.push(meal ? trimMeal(meal) : { id, name: null, thumb: null });
    } catch {
      out.push({ id, name: null, thumb: null });
    }
  }
  return out;
}

export { UpstreamError };
