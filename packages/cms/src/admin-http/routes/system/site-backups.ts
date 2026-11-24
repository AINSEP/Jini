import type { RouteInputContext } from "@jini-ai/core/contracts/server";

/**
 * @file The admin Git backup screen's two calls, `POST …/site-backups/plan` and `POST …/site-backups/push`.
 * Both run the host's backup service — the same code path as `site_backup_plan`/`site_backup_push` — so the
 * permissions (`site-backup.push` AND `custom-credentials.write`, checked inside the service), the
 * private-repository rule and every refusal are the assistant's. A refusal answers 200 with the
 * service's own `{ planned|pushed: false, code, message }`, which the screen shows as is.
 *
 * Server-neutral raw specs (K1 §9.3): the gates answer `res.sendStatus`-style plain text (`Not Found`
 * from the host mount's `workspaceRefusal`, `Forbidden` here), which a JSON spec cannot write. The
 * service, its error ladder and the publish-trust lookup are the host's, injected below.
 */

/** How long one push POST waits on its job before answering progress. The screen re-posts the same
 *  planId at once, so this is the poll interval; re-posting waits on the SAME job (`push-jobs.ts`). */
export const PUSH_POLL_WAIT_MS = 1500;

/** One backup call, as the host's service receives it. */
export interface SiteBackupRouteCall {
  readonly input: unknown;
  readonly principal: { readonly id: string };
  readonly signal: AbortSignal;
}

/** The principal fields this route reads. */
export interface SiteBackupPrincipal { readonly id: string }

/** What the host injects. Method syntax on purpose: the host binds its own principal record type. */
export interface SiteBackupRouteDeps {
  readonly workspaceId: string;
  /** The service's plan step (`site_backup_plan`'s code path). */
  plan(required: { call: SiteBackupRouteCall }): Promise<unknown>;
  /** The service's push step; the host binds the {@link PUSH_POLL_WAIT_MS} wait. */
  push(required: { call: SiteBackupRouteCall }): Promise<unknown>;
  /** Whether this request authenticated with a publishing (connected-computer) credential. */
  isPublishTrusted(required: { context: SiteBackupPrincipal }): boolean;
  /** The service's thrown errors as HTTP. Validation and permission errors carry no secret (see the
   *  host's model-facing rules); `undefined` means anything else, which the mount answers with its
   *  fixed redacted line, never the error's text. */
  mapBackupError(required: { error: unknown }): { status: number; body: unknown } | undefined;
}

/** The server-neutral raw route (K1 §9.3), structurally an http-kit `RawRouteSpec`. */
export interface SiteBackupRoute {
  readonly method: "post";
  readonly path: string;
  readonly bufferedReply: true;
  readonly responseHeaders: Readonly<Record<string, string>>;
  handle(required: { readonly raw: RouteInputContext; readonly deps: SiteBackupRouteDeps; readonly context: SiteBackupPrincipal | undefined }, optional: { readonly signal: AbortSignal }): Promise<Response>;
}

// A backup holds the whole database, so neither answer may be cached; a connected-computer
// (publish-trust) session is refused outright, as on the share routes' admin operations.
const SITE_BACKUP_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });

/** `res.json(body)`'s bytes and type. @complexity O(n) in the body. */
function jsonReply({ status, body }: { status: number; body: unknown }, _optional: Record<string, never> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

/** The service step behind one path, with the route's gates and error ladder.
 * @complexity O(1) per request besides the service's own cost. */
function siteBackupRoute({ path, step }: { path: string; step: "plan" | "push" }, _optional: Record<string, never> = {}): SiteBackupRoute {
  return {
    method: "post", path, bufferedReply: true, responseHeaders: SITE_BACKUP_RESPONSE_HEADERS,
    handle: async ({ raw, deps, context }) => {
      if (!context) throw new Error("site backup route mounted without an authenticated principal");
      if (deps.isPublishTrusted({ context })) return new Response("Forbidden", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      // Never aborted: a stopped wait stops the job (`push-jobs.ts`), and a closed tab must not cancel
      // a half-uploaded backup — the job finishes on its own, still one commit.
      const call: SiteBackupRouteCall = { input: raw.body ?? {}, principal: { id: context.id }, signal: new AbortController().signal };
      try {
        return jsonReply({ status: 200, body: await deps[step]({ call }) });
      } catch (error) {
        const mapped = deps.mapBackupError({ error });
        if (mapped) return jsonReply(mapped);
        throw error;
      }
    },
  };
}

const ROOT = "/api/admin/v1/workspaces/:workspaceId/site-backups";

/** `POST …/site-backups/plan`. */
export const siteBackupPlanRoute: SiteBackupRoute = siteBackupRoute({ path: `${ROOT}/plan`, step: "plan" });

/** `POST …/site-backups/push`. */
export const siteBackupPushRoute: SiteBackupRoute = siteBackupRoute({ path: `${ROOT}/push`, step: "push" });
