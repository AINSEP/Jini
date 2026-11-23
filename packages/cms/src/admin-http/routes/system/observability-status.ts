import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import type { AuthorizeFn } from '@jini-ai/core/contracts/events';
import { isNoopObservabilityPort, type ObservabilityPort } from '@jini-ai/core/contracts/observability';
import { rejectRoute } from '@jini-ai/core/errors/route-refusal';

/**
 * @file Observability admin page, Overview tab (`development/todos.md` 2026-09-09 owner ask) —
 * `GET /api/admin/v1/workspaces/:workspaceId/system/observability-status`.
 *
 * Reports whether a configured observability provider plugin backs `RouteDeps.observability`
 * (since provider wave 2; before it, whether an operator had set `OTEL_EXPORTER_OTLP_ENDPOINT`/
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) or the process is running the default no-op — never the
 * endpoint value itself, which could carry a collector's hostname or an embedded credential (the same
 * discipline `RequestTrackingOutcome.routePattern` already applies to inbound paths, per `ports.ts`).
 * The selection itself is `server/runtime/composition/provider-plugins.ts`'s; this route only wires
 * that decision through the same workspace-id-404 -> authorize -> 403 shape every sibling route in
 * this directory uses (`module-status.ts`, `deployment-overview.ts`).
 * Now: the route also serves `POST .../system/observability/test-error`; the observability port,
 * the provider selection (the host composition root) and the 404 / `system.read` 403 are the host
 * ports'.
 */

/** The fields of the authenticated principal these routes read. */
export interface ObservabilityPrincipal { id: string }

/** What the GET route reads. `authorize` is the host's raw authorizer: the optional
 * `canSendTestError` probe needs its decision as a value, not as a refusal. */
export interface AdminObservabilityStatusRouteDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  observability: ObservabilityPort;
  /** The fixed service identity reported while a provider backs the port (the host's product id). */
  serviceName: string;
  observabilityEnabled?: (() => boolean) | undefined;
  telemetryStatus?: ((required: Record<string, never>) => unknown) | undefined;
  sendTelemetryTest?: ((required: Record<string, never>) => Promise<unknown>) | undefined;
}

/** What the POST test-error route reads; it answers its own 403 copy, so it authorizes directly. */
export type AdminObservabilityTestErrorRouteDeps = Pick<AdminObservabilityStatusRouteDeps, 'workspaceId' | 'authorize' | 'sendTelemetryTest'>;

/** The GET body; optional keys are absent (not `undefined`) when their collaborator is unwired. */
export interface ObservabilityStatusBody {
  enabled: boolean;
  serviceName: string | null;
  providers?: unknown;
  canSendTestError?: boolean;
}

/** The authenticated principal; a spec mounted without an authenticate port fails closed. */
function requirePrincipal(context: ObservabilityPrincipal | undefined): ObservabilityPrincipal {
  if (!context) throw new Error('observability route has no authenticated principal');
  return context;
}

function observabilityStatusBody(
  { deps, enabled, testAccess }: { deps: AdminObservabilityStatusRouteDeps; enabled: boolean; testAccess: { allowed: boolean } | undefined },
  _optional = {},
): ObservabilityStatusBody {
  return { enabled, serviceName: enabled ? deps.serviceName : null,
    ...(deps.telemetryStatus ? { providers: deps.telemetryStatus({}) } : {}),
    ...(testAccess ? { canSendTestError: testAccess.allowed } : {}) };
}

/** `GET .../system/observability-status`: `system.read`-gated provider state, never its config.
 * @complexity O(1) plus the injected authorizer and status read.
 */
export const observabilityStatusRoute = defineJsonRoute<Record<string, never>, ObservabilityStatusBody, AdminObservabilityStatusRouteDeps, ObservabilityPrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/observability-status',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context, authorize }) => {
    const principal = requirePrincipal(context);
    if (!authorize) throw new Error('observability-status route has no authorizer');
    await authorize({ permission: 'system.read', entityType: 'observability' });
    // Whether a configured provider plugin backs the port, and the fixed service identity it
    // reports under. Never the collector endpoint, DSN or any credential: those live only in the
    // provider plugins' sealed key cards and must not be disclosed by this status route.
    const enabled = deps.observabilityEnabled?.() ?? !isNoopObservabilityPort(deps.observability);
    const testAccess = deps.sendTelemetryTest ? await deps.authorize({ principalId: principal.id,
      permission: 'system.write', workspaceId: deps.workspaceId, entityType: 'observability' }) : undefined;
    return ok({ value: observabilityStatusBody({ deps, enabled, testAccess }) });
  },
});

/** `POST .../system/observability/test-error`: `system.write`-gated fixed diagnostic send.
 * @complexity O(1) plus the injected authorizer and sender.
 */
export const observabilityTestErrorRoute = defineJsonRoute<Record<string, never>, unknown, AdminObservabilityTestErrorRouteDeps, ObservabilityPrincipal>({
  method: 'post',
  path: '/api/admin/v1/workspaces/:workspaceId/system/observability/test-error',
  parse: () => ok({ value: {} }),
  handle: async ({ deps, context }) => {
    const principal = requirePrincipal(context);
    const access = await deps.authorize({ principalId: principal.id, permission: 'system.write',
      workspaceId: deps.workspaceId, entityType: 'observability' });
    if (!access.allowed) rejectRoute({ status: 403, error: 'not authorized to send a test error', code: 'FORBIDDEN' });
    if (!deps.sendTelemetryTest) rejectRoute({ status: 503, error: 'telemetry test is unavailable' });
    // No submitted error text: only the fixed diagnostic bound by the composition root is sent.
    return ok({ value: await deps.sendTelemetryTest({}) });
  },
});
