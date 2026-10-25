/**
 * Builds the human-readable title and summary written into an approval row.
 * The server writes these from the arguments — never the model — so the
 * approval card always reflects what will actually run.
 */

const MEAL_LABEL = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner" };

export function summarize(tool, args) {
  switch (tool) {
    case "pantry_update":
      return {
        title: `Update pantry: ${args.name}`,
        summary: `Sets ${args.quantity} ${args.unit} of ${args.name}.`,
      };
    case "pantry_remove":
      return {
        title: `Remove from pantry: ${args.name}`,
        summary: `Deletes ${args.name} from your pantry.`,
      };
    case "plan_set_meal": {
      const when = `${MEAL_LABEL[args.meal]} on ${args.date}`;
      return args.replace
        ? {
            title: `Replace the meal on ${when}`,
            summary: `Replaces the existing meal with recipe ${args.recipeId}.`,
          }
        : {
            title: `Add a meal to ${when}`,
            summary: `Adds recipe ${args.recipeId} to your week plan.`,
          };
    }
    case "plan_clear_day":
      return {
        title: `Clear all meals on ${args.date}`,
        summary: `Removes every meal planned for ${args.date}.`,
      };
    case "shopping_build": {
      const from = args.from ?? "this week";
      const to = args.to ? ` to ${args.to}` : "";
      return {
        title: "Rebuild the shopping list",
        summary: `Rebuilds the list from the plan${from !== "this week" ? ` (${from}${to})` : ""} minus your pantry.`,
      };
    }
    case "shopping_export":
      return {
        title: "Export the shopping list",
        summary: "Writes the list to a text file in the Cooksy data folder. Sends nothing.",
      };
    default:
      return { title: tool, summary: "" };
  }
}
