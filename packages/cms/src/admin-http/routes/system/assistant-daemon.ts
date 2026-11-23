import { defineJsonRoute, ok, type JsonRouteAuthorize } from '@jini-ai/core/contracts/server';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';

/**
 * @file Admin "Restart assistant" action — `POST /api/admin/v1/workspaces/:workspaceId/system/
 * assistant-daemon/restart`, the manual recovery seam for the locally-spawned agent daemon (the
 * host's daemon supervisor, injected as `restartAssistantDaemon`). Sibling to the host's on-demand
 * recovery in its daemon-proxy code (a known-failed request restarts the daemon automatically) —
 * this route exists for the case an operator wants to force it NOW rather than wait for the next
 * request to trigger it, or wants to recover a daemon whose crash-loop cap has already tripped
 * (on-demand recovery covers that too, but only once a request happens to arrive).
 *
 * `system.write`-gated, matching the Dockerfile source `PUT` route: this is a mutation on system
 * process state, not a read.
 *
 * ## What this route does NOT do
 *
 * `restartAssistantDaemon()` is synchronous and returns as soon as the restart has been INITIATED —
 * it does not, and structurally cannot, wait for the new daemon process to become healthy, because
 * no "daemon became healthy" signal exists. So this route's response means "a restart was
 * accepted", never "the assistant is back up". Reporting anything stronger — "restarted
 * successfully" as if that implied health — would be exactly the lying-comment failure mode a past
 * defect was caused by. Live status after the click is the caller's job, by polling the host's
 * readiness probe or `GET .../system/module-status` (`system.read`-gated, full detail) — this route
 * intentionally returns neither.
 *
 * `restartAssistantDaemon()` refuses with `{ok: false, reason}` only while the host process is
 * itself tearing down — a crash-loop cap having tripped does NOT refuse a manual restart; that is
 * the whole point of this seam existing separately from automatic respawn. Every refusal reason is
 * relayed to the caller verbatim, never translated into a generic error.
 */

/** What the host's daemon supervisor answers a manual restart with; `reason` is present only when `ok` is `false`. */
export interface RestartAssistantDaemonResult { ok: boolean; reason?: string | undefined }

/** The one collaborator this route reads; workspace and authorization come from the host ports. */
export interface AdminAssistantDaemonDeps {
  /**
   * The host's restart seam (a process-wide daemon supervisor in production). Injected so a route
   * test can prove both the `{ok: true}` and `{ok: false, reason}` response shapes directly — the
   * real implementation's `{ok: true}` branch only occurs once a daemon process has actually been
   * spawned this boot, which a route-level test has no business doing.
   */
  restartAssistantDaemon: () => RestartAssistantDaemonResult;
}

/** The fields of the authenticated principal this route's host ports read. */
export interface AssistantDaemonPrincipal { id: string }

/** The handler's own authorizer; a spec mounted without one fails closed. */
function requireAuthorize(authorize: JsonRouteAuthorize | undefined): JsonRouteAuthorize {
  if (!authorize) throw new Error('assistant-daemon restart route has no authorizer');
  return authorize;
}

/** `POST .../system/assistant-daemon/restart`: authorize, then relay the supervisor's answer.
 * @complexity O(1) plus the injected restart.
 */
export const assistantDaemonRestartRoute = defineJsonRoute<Record<string, never>, { ok: true }, AdminAssistantDaemonDeps, AssistantDaemonPrincipal>({
  method: 'post',
  path: '/api/admin/v1/workspaces/:workspaceId/system/assistant-daemon/restart',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await requireAuthorize(authorize)({ permission: 'system.write', entityType: 'assistant-daemon' });
    const result = deps.restartAssistantDaemon();
    if (!result.ok) {
      // 409, not 500: this is an ordinary "cannot do that right now" business-rule refusal (the
      // process is shutting down), the same status `publish-site.ts` uses for its own "a publish
      // is already running" refusal — never a server fault.
      throw new RouteRefusalError({ status: 409, body: { ok: false, reason: result.reason, code: 'ASSISTANT_DAEMON_RESTART_REFUSED' } });
    }
    return ok({ value: { ok: true } });
  },
});
