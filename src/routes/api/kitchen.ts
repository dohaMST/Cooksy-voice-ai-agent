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

export const Route = createFileRoute("/api/kitchen")({
  server: {
    handlers: {
      /** Pantry, week plan or shopping list. Read with the read-only token. */
      GET: async ({ request }: { request: Request }) => {
        try {
          assertConsoleRequest(request);
          const view = new URL(request.url).searchParams.get("view") ?? "pantry";
          if (!KITCHEN_VIEWS.includes(view as KitchenView)) {
            throw new CooksyError(`view must be one of ${KITCHEN_VIEWS.join(", ")}.`, 400);
          }
          return jsonResponse(await readKitchen(view as KitchenView));
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
