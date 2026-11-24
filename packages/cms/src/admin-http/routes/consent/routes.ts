import { ToolInputError, ToolPermissionDeniedError } from "@jini-ai/core";
import { defineJsonRoute, ok, type JsonRouteAuthorize, type JsonRouteSpec, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/**
 * @file The six admin cookie-consent endpoints (`/api/admin/v1/workspaces/:workspaceId/consent/*`):
 * authenticated, workspace-scoped projections of the host's consent service.
 *
 * The service, its closed request contract (`readConsentRequest`, `consentRevisionToken`) and its
 * revision-conflict class are host-owned and injected: the same readers serve the host's tool
 * transport, so one copy of the rules answers both. Every answer — including the workspace 404 and
 * every refusal — carries `Cache-Control: no-store` (`responseHeaders`), as the hand-written routes
 * set it before any gate. Request reading happens in `handle`, AFTER authorization, so a malformed
 * body never answers before the permission check (the hand-written order).
 */

const BASE = "/api/admin/v1/workspaces/:workspaceId/consent";

/** Set on every consent answer, before any gate: consent state is per-operator and never cacheable. */
export const CONSENT_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "Cache-Control": "no-store" });

/** The host's consent service, reduced to the five calls the routes make. */
export interface ConsentRouteService {
  read(required: { principalId: string }): Promise<unknown>;
  readiness(required: { principalId: string; path?: string | undefined; config?: unknown }): Promise<unknown>;
  preview(required: { principalId: string; path?: string | undefined; config?: unknown }): Promise<unknown>;
  saveDraft(required: { principalId: string; config: unknown; expectedDraftId: string | null }): Promise<unknown>;
  publish(required: { principalId: string; draftId: string; expectedPublishedId: string | null }): Promise<unknown>;
}

/** The deps every consent route reads: the workspace, the service and the host's request contract. */
export interface ConsentRouteDeps {
  workspaceId: string;
  consent: ConsentRouteService;
  /** Closed-field reader; throws `ToolInputError` for a non-object or an unknown field. */
  readConsentRequest: (required: { body: unknown; fields: readonly string[] }) => Record<string, unknown>;
  /** Required nullable revision token; throws `ToolInputError` when malformed. */
  consentRevisionToken: (required: { input: Record<string, unknown>; key: string }) => string | null;
  /** Whether a failure is the service's lost compare-and-set (the host's conflict class). */
  isConsentConflict: (error: unknown) => boolean;
}

/** Whatever the host's session resolves to; the routes read only its id. */
export interface ConsentRoutePrincipal { id: string }

type ConsentRun = (required: { raw: RouteInputContext; deps: ConsentRouteDeps; principalId: string }) => Promise<unknown>;
type ConsentRouteSpec = JsonRouteSpec<RouteInputContext, unknown, ConsentRouteDeps, ConsentRoutePrincipal> & { responseHeaders: Readonly<Record<string, string>> };

/** Refusal with the consent body's own key order (`code` first), as the hand-written routes wrote it. */
function consentRefusal({ status, code, error }: { status: number; code: string; error: string }, _optional: Record<string, never> = {}): RouteRefusalError {
  return new RouteRefusalError({ status, body: { code, error } });
}

/** The hand-written catch ladder, in its order; `undefined` means "not mine" (rethrow to the host 503). */
function mapConsentError({ error, deps }: { error: unknown; deps: ConsentRouteDeps }, _optional: Record<string, never> = {}): RouteRefusalError | undefined {
  if (error instanceof ToolInputError) return consentRefusal({ status: 400, code: "CONSENT_VALIDATION_FAILED", error: error.message });
  if (deps.isConsentConflict(error)) return consentRefusal({ status: 409, code: "CONSENT_REVISION_CONFLICT", error: (error as Error).message });
  // The service's own permission denial carries an internal reason; the operator sees fixed copy.
  if (error instanceof ToolPermissionDeniedError) return consentRefusal({ status: 403, code: "FORBIDDEN", error: "Permission to access cookie consent was denied." });
  return undefined;
}

/** `settings.workspace.write` for writes, `settings.read` otherwise, on `site-consent`; no entity id.
 * A mount without an authorizer is a wiring bug, so it fails closed. */
async function authorizeConsent({ authorize, write }: { authorize: JsonRouteAuthorize | undefined; write: boolean }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("consent admin route has no authorizer");
  await authorize({ permission: write ? "settings.workspace.write" : "settings.read", entityType: "site-consent" });
}

/** One consent endpoint: authorize, then run, every failure through the consent ladder.
 * @complexity O(1) plus the injected service call. */
function consentRoute({ method, suffix, write, run }: { method: "get" | "post" | "put"; suffix: string; write: boolean; run: ConsentRun }, _optional: Record<string, never> = {}): ConsentRouteSpec {
  const spec = defineJsonRoute<RouteInputContext, unknown, ConsentRouteDeps, ConsentRoutePrincipal>({
    method,
    path: `${BASE}${suffix}`,
    parse: (raw) => ok({ value: raw }),
    handle: async ({ input, deps, context, authorize }) => {
      try {
        // Inside the ladder, as the hand-written routes authorized inside their `try`.
        await authorizeConsent({ authorize, write });
        if (!context) throw new Error("consent admin route has no authenticated principal");
        return ok({ value: await run({ raw: input, deps, principalId: context.id }) });
      } catch (error) {
        throw mapConsentError({ error, deps }) ?? error;
      }
    },
  });
  return { ...spec, responseHeaders: CONSENT_RESPONSE_HEADERS };
}

/** The optional `path` every readiness/preview request may carry: one string or absent. */
function consentPath({ input }: { input: Record<string, unknown> }, _optional: Record<string, never> = {}): string | undefined {
  if (input.path !== undefined && typeof input.path !== "string") throw new ToolInputError({ message: "path must be one local page path." });
  return input.path as string | undefined;
}

/** `{ principalId, path, config? }` from a `path`/`config` body; an absent config sends no key. */
function candidateArgs({ raw, deps, principalId }: Parameters<ConsentRun>[0], _optional: Record<string, never> = {}) {
  const input = deps.readConsentRequest({ body: raw.body, fields: ["path", "config"] });
  return { principalId, path: consentPath({ input }), ...(input.config === undefined ? {} : { config: input.config }) };
}

export const consentSettingsGetRoute = consentRoute({ method: "get", suffix: "/settings", write: false, run: ({ deps, principalId }) => deps.consent.read({ principalId }) });

export const consentReadinessRoute = consentRoute({
  method: "get", suffix: "/readiness", write: false,
  run: ({ raw, deps, principalId }) => deps.consent.readiness({ principalId, path: consentPath({ input: deps.readConsentRequest({ body: raw.query, fields: ["path"] }) }) }),
});

export const consentDryRunRoute = consentRoute({ method: "post", suffix: "/dry-run", write: false, run: (args) => args.deps.consent.readiness(candidateArgs(args)) });

export const consentPreviewRoute = consentRoute({ method: "post", suffix: "/preview", write: false, run: (args) => args.deps.consent.preview(candidateArgs(args)) });

export const consentSettingsPutRoute = consentRoute({
  method: "put", suffix: "/settings", write: true,
  run: ({ raw, deps, principalId }) => {
    const input = deps.readConsentRequest({ body: raw.body, fields: ["config", "expectedDraftId"] });
    return deps.consent.saveDraft({ principalId, config: input.config, expectedDraftId: deps.consentRevisionToken({ input, key: "expectedDraftId" }) });
  },
});

export const consentPublishRoute = consentRoute({
  method: "post", suffix: "/publish", write: true,
  run: ({ raw, deps, principalId }) => {
    const input = deps.readConsentRequest({ body: raw.body, fields: ["draftId", "expectedPublishedId"] });
    const draftId = deps.consentRevisionToken({ input, key: "draftId" });
    if (draftId === null) throw new ToolInputError({ message: "draftId must name a saved draft." });
    return deps.consent.publish({ principalId, draftId, expectedPublishedId: deps.consentRevisionToken({ input, key: "expectedPublishedId" }) });
  },
});
