/**
 * Shapes shared by the browser console and the server routes.
 *
 * This file must stay free of `process.env` and any import of `cooksy.server.ts`,
 * because it is bundled into the browser.
 */

export type ApprovalStatus = "pending" | "executing" | "executed" | "denied" | "failed" | "expired";

export type ApprovalRecord = {
  _id: string;
  tool: string;
  args: Record<string, unknown>;
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
  actor?: string;
  error?: string;
  result?: unknown;
};

export type ApprovalsPage = {
  pending: ApprovalRecord[];
  decided: ApprovalRecord[];
  /** Echoed back as `since` on the next poll. */
  serverTime: number;
};

export type PantryItem = {
  _id: string;
  name: string;
  quantity: number;
  unit: string;
  bestBefore?: string;
  updatedAt: number;
};

export type PlanEntry = {
  _id: string;
  date: string;
  meal: string;
  recipeId: string;
  recipeName: string | null;
  thumb: string | null;
  createdAt: number;
};

export type ShoppingItem = {
  _id: string;
  name: string;
  quantity: number;
  unit: string;
  checked: boolean;
  sourceDates: string[];
  updatedAt: number;
};

export type KitchenView = "pantry" | "plan" | "shopping";

export const KITCHEN_VIEWS: KitchenView[] = ["pantry", "plan", "shopping"];

export type KitchenData =
  | { view: "pantry"; items: PantryItem[] }
  | { view: "plan"; from: string; to: string; entries: PlanEntry[] }
  | { view: "shopping"; items: ShoppingItem[] };

/** The reply shape of one approve/deny call. */
export type DecisionOutcome = {
  ok: boolean;
  code: string;
  result?: unknown;
  error?: string;
};
