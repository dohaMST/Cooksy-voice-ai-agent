import { createFileRoute } from "@tanstack/react-router";
import {
  CooksyError,
  KITCHEN_VIEWS,
  assertConsoleRequest,
  errorResponse,
  jsonResponse,
  readKitchen,
  type KitchenView,
} from "@/lib/cooksy/cooksy.server";

/** An ISO date the stores can compare with `$gte`/`$lte`; anything else is refused. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readRange(url: URL): { from?: string; to?: string } {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from === null && to === null) return {};
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new CooksyError("from and to must both be YYYY-MM-DD.", 400);
  }
  if (
    Number.isNaN(Date.parse(`${from}T00:00:00Z`)) ||
    Number.isNaN(Date.parse(`${to}T00:00:00Z`))
  ) {
    throw new CooksyError("from and to must be real dates.", 400);
  }
  if (from > to) throw new CooksyError("from must not be after to.", 400);
  return { from, to };
}

export const Route = createFileRoute("/api/kitchen")({
  server: {
    handlers: {
      /** Pantry, week plan or shopping list. Read with the read-only token. */
      GET: async ({ request }: { request: Request }) => {
        try {
          assertConsoleRequest(request);
          const url = new URL(request.url);
          const view = url.searchParams.get("view") ?? "pantry";
          if (!KITCHEN_VIEWS.includes(view as KitchenView)) {
            throw new CooksyError(`view must be one of ${KITCHEN_VIEWS.join(", ")}.`, 400);
          }
          const range = readRange(url);
          return jsonResponse(await readKitchen(view as KitchenView, range));
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
