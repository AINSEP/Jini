import type { FrontendSessionOwner } from "@jini-ai/core/contracts/site/daemon";
import type { RouteInputContext } from "@jini-ai/core/contracts/server";

export const SITE_ASSISTANT_CONFIRM_PATH = "/api/site-assistant/confirm";

export interface SiteAssistantConfirmDeps {
  rateAllowed: (required: Record<string, never>) => Promise<boolean>;
  enabled: (required: Record<string, never>) => Promise<boolean>;
  isJson: (required: Record<string, never>) => boolean;
  sameOrigin: (required: Record<string, never>) => Promise<boolean>;
  resolveOwner?: (required: Record<string, never>) => Promise<FrontendSessionOwner | null>;
  confirm: (required: { challengeId: string; allow: boolean; owner?: FrontendSessionOwner }) => Promise<boolean>;
  reportError: (required: { error: unknown }) => void;
  refusalText: string;
}

/** Closed, bounded reply shape: only a visitor click's nonce and literal boolean are accepted. */
function confirmationBody({ value }: { value: unknown }, _options = {}): { challengeId: string; allow: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || typeof body.allow !== "boolean") return null;
  if (typeof body.challengeId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(body.challengeId)) return null;
  return { challengeId: body.challengeId, allow: body.allow };
}

/** Same-origin JSON plus the human-only bearer; malformed/stale/forged/replayed IDs share a refusal.
 * Origin uses the shared visitor policy, including the actual serving host.
 * @complexity O(Origin length) time/space and bounded I/O.
 */
export const siteAssistantConfirmRoute = {
  method: "post" as const,
  path: SITE_ASSISTANT_CONFIRM_PATH,
  bufferedReply: true as const,
  responseHeaders: { "Cache-Control": "no-store" },
  async handle({ raw, deps }: { raw: Pick<RouteInputContext, "body">; deps: SiteAssistantConfirmDeps }, _optional: { signal?: AbortSignal } = {}): Promise<Response> {
    const headers = { "Cache-Control": "no-store" };
    try {
      if (!await deps.rateAllowed({})) return Response.json({ error: deps.refusalText }, { status: 429, headers });
      if (!await deps.enabled({})) return Response.json({ error: deps.refusalText }, { status: 404, headers });
      const body = confirmationBody({ value: raw.body });
      const sameOrigin = await deps.sameOrigin({});
      if (!body || !deps.isJson({}) || !sameOrigin) return Response.json({ error: deps.refusalText }, { status: 400, headers });
      const owner = await deps.resolveOwner?.({});
      const accepted = await deps.confirm({ ...body, ...(owner ? { owner } : {}) });
      return Response.json(accepted ? { accepted: true } : { error: deps.refusalText }, { status: accepted ? 200 : 400, headers });
    } catch (error) {
      deps.reportError({ error });
      return Response.json({ error: deps.refusalText }, { status: 400, headers });
    }
  },
};
