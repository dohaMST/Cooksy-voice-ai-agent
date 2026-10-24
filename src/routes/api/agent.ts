import { createFileRoute } from "@tanstack/react-router";
import { SYSTEM_PROMPT } from "@/lib/voice/prompt";
import { resolveGatewayModel } from "@/lib/ai/models";

type Turn = { role: "user" | "assistant"; text: string };

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      /** Forwards one turn to OpenClaw as `openclaw/<agent>` and streams the screen JSON back. */
      POST: async ({ request }: { request: Request }) => {
        const { streamResponses } = await import("@/lib/ai/responses.server");

        let turns: Turn[] = [];
        let modelName: string | undefined;
        try {
          const body = (await request.json()) as { turns?: Turn[]; model?: unknown };
          if (Array.isArray(body.turns)) turns = body.turns.filter((t) => t && typeof t.text === "string");
          if (typeof body.model === "string") modelName = body.model;
        } catch {
          turns = [];
        }
        if (!turns.length) {
          return new Response(JSON.stringify({ error: "Nothing to answer" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Never swap in a different agent: an unknown name is an error the operator can see.
        const model = resolveGatewayModel(modelName);
        if (!model) {
          return new Response(
            JSON.stringify({ error: `${modelName ?? "No agent"} is not one of the agents this console can reach.` }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const input: Record<string, unknown>[] = [
          { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
          ...turns.slice(-12).map((turn) => ({
            role: turn.role,
            content: [
              turn.role === "assistant"
                ? { type: "output_text", text: turn.text }
                : { type: "input_text", text: turn.text },
            ],
          })),
        ];

        return streamResponses(request, input, {}, model);
      },
    },
  },
});
