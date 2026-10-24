/**
 * Cooksy agent names and the OpenClaw gateway model each one routes to.
 *
 * Two agents only. Anything else resolves to null so the caller shows a real
 * error instead of silently answering with a different agent.
 */
export const AGENT_MODELS: Record<string, string> = {
  cook: "openclaw/cook",
  planner: "openclaw/planner",
};

/**
 * Resolves a bare agent id ("cook") or an already-qualified gateway model
 * ("openclaw/cook") to the gateway model id; unknown names return null.
 */
export function resolveGatewayModel(name: string | undefined): string | null {
  if (!name) return null;
  const id = name.startsWith("openclaw/") ? name.slice("openclaw/".length) : name;
  return AGENT_MODELS[id] ?? null;
}
