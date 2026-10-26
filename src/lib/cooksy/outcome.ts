/**
 * What the conversation says after the operator decides an approval.
 *
 * Both functions read the stored approval and cooksy-api's own result, never the
 * model's words: the console reports what actually ran. That is why a meal the
 * agent merely proposed can never be announced as added.
 */
import { formatDay } from "./week.ts";
import type { ApprovalRecord, DecisionOutcome, KitchenView } from "./types.ts";

/** Where the Kitchen view should point once the write has landed. */
export type DecisionFocus = {
  tab: KitchenView;
  /** The date the write touched, when the tool has one; null for pantry and list writes. */
  date: string | null;
};

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag {
  return value && typeof value === "object" ? (value as Bag) : {};
}

/** Result and arguments are untrusted records, read by key rather than by shape. */
function str(source: Bag, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function count(source: Bag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A plain spoken sentence for the chat bubble that records the decision.
 * `record` is the pending row (title/args), `outcome` is cooksy-api's answer.
 */
export function describeDecision(
  record: ApprovalRecord,
  decision: "approve" | "deny",
  outcome: DecisionOutcome,
): string {
  if (decision === "deny") return "Denied — nothing was changed.";
  if (!outcome.ok) {
    if (outcome.code === "failed") {
      const reason = outcome.error?.trim() || "no reason given";
      return `Approved, but the write failed: ${/\.$/.test(reason) ? reason : `${reason}.`}`;
    }
    return `Nothing changed — ${outcome.code.replace(/_/g, " ")}.`;
  }

  const args = bag(record.args);
  const result = bag(outcome.result);

  switch (record.tool) {
    case "plan_set_meal": {
      const date = str(result, "date") || str(args, "date");
      const meal = str(result, "meal") || str(args, "meal") || "meal";
      const name = str(result, "recipeName") || `recipe ${str(args, "recipeId")}`;
      const when = date ? formatDay(date) : "that day";
      return args["replace"] === true
        ? `Swapped ${meal} on ${when} to ${name}.`
        : `Added ${name} to ${meal} on ${when}.`;
    }
    case "plan_clear_day": {
      const date = str(result, "cleared") || str(args, "date");
      const when = date ? formatDay(date) : "that day";
      const removed = count(result, "removed");
      return removed === null || removed === 0
        ? `Cleared ${when} — nothing was planned.`
        : `Cleared ${when} — ${plural(removed, "meal")} removed.`;
    }
    case "pantry_update": {
      const name = str(result, "name") || str(args, "name");
      const quantity = count(result, "quantity") ?? count(args, "quantity") ?? 0;
      const unit = str(result, "unit") || str(args, "unit");
      return `Pantry updated — ${quantity} ${unit} of ${name}.`.replace(/\s+/g, " ");
    }
    case "pantry_remove": {
      const name = str(result, "removed") || str(args, "name");
      return `Removed ${name} from the pantry.`;
    }
    case "shopping_build": {
      const added = count(result, "added") ?? 0;
      return added === 0
        ? "Shopping list rebuilt — nothing needs buying."
        : `Shopping list rebuilt — ${plural(added, "item")} to buy.`;
    }
    case "shopping_export": {
      const items = count(result, "count");
      return items === null
        ? "Shopping list exported."
        : `Shopping list exported — ${plural(items, "item")}.`;
    }
    default:
      return `Done — ${record.title}.`;
  }
}

/**
 * The tab (and, for plan writes, the week) the change landed in. Without this the
 * write is invisible: an approval for next Tuesday left the Week tab on this week,
 * which is empty until the operator thinks to page forward.
 */
export function decisionFocus(
  record: ApprovalRecord,
  outcome: DecisionOutcome,
): DecisionFocus | null {
  if (!outcome.ok) return null;
  const args = bag(record.args);
  const result = bag(outcome.result);
  switch (record.tool) {
    case "plan_set_meal":
      return { tab: "plan", date: str(result, "date") || str(args, "date") || null };
    case "plan_clear_day":
      return { tab: "plan", date: str(result, "cleared") || str(args, "date") || null };
    case "pantry_update":
    case "pantry_remove":
      return { tab: "pantry", date: null };
    case "shopping_build":
    case "shopping_export":
      return { tab: "shopping", date: null };
    default:
      return null;
  }
}
