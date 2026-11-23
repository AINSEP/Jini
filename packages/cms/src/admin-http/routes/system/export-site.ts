import { defineJsonRoute, ok, type JsonRouteAuthorize } from '@jini-ai/core/contracts/server';
import { RouteRefusalError, rejectRoute } from '@jini-ai/core/errors/route-refusal';

/**
 * @file Admin Deployment panel → Static Site tab backend: `POST`/`GET .../system/export`.
 *
 * TRIGGER + STATUS, not a synchronous request/response: a real static export is "seconds to
 * minutes" (one HTTP request per route/asset, serially, fidelity over throughput). Holding a single
 * HTTP connection open for that whole span is the wrong shape for a single-container product with no
 * separate worker process, and a hard client-side timeout would turn an in-progress export into an
 * orphaned background write with no way to learn its outcome. So `POST` starts the run and answers
 * `202` immediately with a snapshot; `GET` polls the same snapshot. The run state is the host's one
 * process-local slot (injected as `getRunSnapshot`/`startRun`): one workspace per process, so "one
 * export at a time" is the correct concurrency model, and a second trigger while one is running gets
 * `409`, never a silently queued or silently dropped request.
 *
 * `system.export`-gated for the trigger, distinct from the `system.read` the status poll uses —
 * triggering writes a folder of files to disk, which is not a read, so it gets its own write-class
 * permission string instead of reusing a `*.read` grant.
 *
 * The output folder is NOT a client-controllable field: the host's `startRun` writes under its own
 * resolved export root, so nothing here ever builds a filesystem path out of request input.
 */

/** The run state the routes answer; only `status` is read, every other field is answered unchanged. */
export interface ExportRunSnapshotView { readonly status: string }

/** The host's process-local run-state read. */
export type ExportRunSnapshotFn = () => ExportRunSnapshotView;
/** The host's run starter: starts the export in the background and returns the "running" snapshot. */
export type ExportRunStartFn = (required: { clean: boolean; actorId: string }, optional: { basePath?: string | undefined }) => ExportRunSnapshotView;

/** The deps `POST .../system/export` reads. */
export interface ExportSiteTriggerRouteDeps {
  workspaceId: string;
  getRunSnapshot: ExportRunSnapshotFn;
  startRun: ExportRunStartFn;
}

/** The deps `GET .../system/export` reads. */
export interface ExportSiteStatusRouteDeps {
  workspaceId: string;
  getRunSnapshot: ExportRunSnapshotFn;
}

/** The fields of the authenticated principal these routes read: only the id, as the run's actor. */
export interface ExportSitePrincipal { id: string }

/** The trigger's options once validated. */
interface ExportTriggerOptions { clean: boolean; basePath?: string }

const EXPORT_PATH = '/api/admin/v1/workspaces/:workspaceId/system/export';

/** The handler's own authorizer; a spec mounted without one is a wiring bug and fails closed. */
function requireAuthorize({ authorize }: { authorize: JsonRouteAuthorize | undefined }, _optional: Record<string, never> = {}): JsonRouteAuthorize {
  if (!authorize) throw new Error('export-site route has no authorizer');
  return authorize;
}

/** A field present with the wrong type refuses with its message; absent or `undefined` passes. */
function refuseWrongType({ raw, field, type }: { raw: Record<string, unknown>; field: string; type: 'boolean' | 'string' }, _optional: Record<string, never> = {}): void {
  if (field in raw && raw[field] !== undefined && typeof raw[field] !== type) rejectRoute({ status: 400, error: `'${field}' must be a ${type}` });
}

/**
 * Validates the trigger's optional JSON body, refusing every malformed shape with a flat `400`:
 * this body goes straight into a filesystem-writing operation's options. A blank/absent/non-string
 * `basePath` collapses to "omit the field" so the run never gets a useless empty value.
 * @complexity O(1).
 */
function readTriggerOptions({ body }: { body: unknown }, _optional: Record<string, never> = {}): ExportTriggerOptions {
  if (body === undefined || body === null) return { clean: false };
  if (typeof body !== 'object' || Array.isArray(body)) rejectRoute({ status: 400, error: 'request body must be a JSON object' });
  const raw = body as Record<string, unknown>;
  refuseWrongType({ raw, field: 'clean', type: 'boolean' });
  refuseWrongType({ raw, field: 'basePath', type: 'string' });
  const basePath = typeof raw.basePath === 'string' && raw.basePath.trim() !== '' ? raw.basePath : undefined;
  return { clean: raw.clean === true, ...(basePath !== undefined ? { basePath } : {}) };
}

/** `POST .../system/export`: starts one export run (202), or 409 while one is already running.
 *  The body is validated in `handle`, after authorization and the running check, because that is the
 *  order the admin client has always seen (a malformed body while a run is going is still a 409).
 * @complexity O(1) plus the injected run start.
 */
export const exportSiteTriggerRoute = defineJsonRoute<{ body: unknown }, ExportRunSnapshotView, ExportSiteTriggerRouteDeps, ExportSitePrincipal>({
  method: 'post',
  path: EXPORT_PATH,
  parse: (raw) => ok({ value: { body: raw.body } }),
  handle: async ({ input, deps, context, authorize }) => {
    await requireAuthorize({ authorize })({ permission: 'system.export', entityType: 'site-export' });
    // No `await` between this check and `startRun` below — this stretch runs synchronously on the
    // event loop, so two concurrent POSTs cannot both observe "idle" (the single-flight guarantee).
    // A host agent tool that triggers the same run follows the identical no-await-in-between shape
    // against the same snapshot/start pair, sharing this exact single-flight guarantee whenever it
    // runs in this same process (not when it runs in a separate OS process).
    const current = deps.getRunSnapshot();
    if (current.status === 'running') throw new RouteRefusalError({ status: 409, body: { error: 'an export is already running', run: current } });
    const options = readTriggerOptions({ body: input.body });
    if (!context?.id) throw new Error('export-site route has no authenticated principal');
    // `startRun` is not awaited by the host (the run continues in the background, polled via `GET`),
    // so a failure inside the run can never surface here — only one before it starts.
    return ok({ value: deps.startRun({ clean: options.clean, actorId: context.id }, { basePath: options.basePath }) });
  },
}, { successStatus: 202 });

/** `GET .../system/export`: the current run snapshot.
 * @complexity O(1).
 */
export const exportSiteStatusRoute = defineJsonRoute<Record<string, never>, ExportRunSnapshotView, ExportSiteStatusRouteDeps, ExportSitePrincipal>({
  method: 'get',
  path: EXPORT_PATH,
  parse: () => ok({ value: {} }),
  handle: async ({ deps, authorize }) => {
    await requireAuthorize({ authorize })({ permission: 'system.read', entityType: 'site-export' });
    return ok({ value: deps.getRunSnapshot() });
  },
});
