/** @file Server-owned durable plugin-activation reconciliation (moved from the host composition
 * root). The host passes its activation repo, workspace and attach/detach callbacks. */
import type { PluginActivationRepoPort } from "@jini-ai/core/contracts/site/plugins-host";
import type { Logger } from "@jini-ai/core/primitives";

/** Server-owned hook activation polling. The registry is process-local, while durable row
 * revisions can be changed by another server/client. Polling reuses those revisions instead
 * of claiming outbox events on a bus whose subscribers belong to another process.
 *
 * P0b's original failure was two composePluginRuntime registries: an admin enable/disable updated
 * only its own registry, while the daemon kept its boot snapshot. Boot readiness fixed initial
 * staleness, not later changes. Polling durable activation row versions was chosen because sharing
 * content.db did not share either bus or hook registry; an enqueue-only daemon could not consume
 * an outbox notification safely. ADR-070 removes that daemon registry, while the serving process
 * retains this reconciliation against changes from another process. Never remove the server's
 * poll merely because the daemon no longer has one. */
/** The narrow slice `startPluginActivationPolling` needs — never the whole `RouteDeps`, so a
 * caller (or a test) can pass a hand-built fake without satisfying the full interface. */
export interface PluginActivationPollDeps {
  readonly pluginLoadedVersion?: (required: { id: string }, optional?: Record<string, never>) => string | undefined;
  readonly workspaceId: string;
  readonly pluginActivationRepo: Pick<PluginActivationRepoPort, "listAll">;
  readonly onPluginEnabled: (pluginId: string) => Promise<void>;
  readonly onPluginDisabled: (pluginId: string) => void;
  /** The host's log channel; an attach or poll failure goes in its error bag, never as line text. */
  readonly logger: Logger;
}

/** A plugin whose last attach failed: what was logged, and how many passes to wait before retrying.
 * The 2026-11-13 charts-recharts INTEGRITY_FAILED logged the same line every 5 s poll (5,895 lines
 * in a day) and re-hashed its whole payload each time. Now the first occurrence of each distinct
 * failure is still logged (never silent), retries back off 1, 3, 7… passes (capped near 10 min at
 * the 5 s default), and a changed activation row version retries at once. */
export interface PluginAttachFailure {
  message: string;
  version: string;
  failures: number;
  skipPasses: number;
}

const MAX_SKIP_PASSES = 120;

/**
 * One reconciliation pass: attaches any plugin durably `enabled` for `workspaceId` that isn't
 * already in `attachedIds` (mutated in place — the caller keeps this Set across ticks so an
 * already-attached plugin is never redundantly reloaded, which would needlessly re-run its
 * `setup()` and reset its quarantine failure count), and detaches any plugin `attachedIds` still
 * has that is no longer durably enabled. A single plugin's `onPluginEnabled` failure (its package
 * removed from disk, a tamper, …) is logged and skipped — it can never block reconciling the rest.
 */
export async function reconcilePluginActivationsOnce(
  { deps, attachedIds, failures = new Map() }: { deps: PluginActivationPollDeps; attachedIds: Set<string>; failures?: Map<string, PluginAttachFailure> },
  _optional = {}
): Promise<void> {
  const records = await deps.pluginActivationRepo.listAll();
  const enabledVersions = new Map(records.filter(record => record.workspaceId === deps.workspaceId && record.enabled).map(record => [record.pluginId, record.version]));

  for (const [pluginId, activeVersion] of enabledVersions) {
    const loadedVersion = deps.pluginLoadedVersion?.({ id: pluginId }, {});
    const current = attachedIds.has(pluginId) && (!deps.pluginLoadedVersion || loadedVersion === activeVersion);
    if (current || shouldWaitBeforeRetry(failures.get(pluginId), activeVersion)) continue;
    await attachActivatedPlugin({ deps, attachedIds, failures, pluginId, version: activeVersion });
  }

  removeDisabledActivations({ deps, enabledVersions, attachedIds, failures });
}

function removeDisabledActivations(
  { deps, enabledVersions, attachedIds, failures }: { deps: PluginActivationPollDeps; enabledVersions: Map<string, string>; attachedIds: Set<string>; failures: Map<string, PluginAttachFailure> },
  _optional = {}
): void {
  for (const pluginId of failures.keys()) if (!enabledVersions.has(pluginId)) failures.delete(pluginId);
  for (const pluginId of attachedIds) {
    if (enabledVersions.has(pluginId)) continue;
    deps.onPluginDisabled(pluginId);
    attachedIds.delete(pluginId);
  }
}

/** Counts down a failed plugin's backoff; a new activation version (re-enable, reinstall) retries now. */
function shouldWaitBeforeRetry(failure: PluginAttachFailure | undefined, activeVersion: string): boolean {
  if (!failure || failure.version !== activeVersion || failure.skipPasses === 0) return false;
  failure.skipPasses -= 1;
  return true;
}

/** An attach failure is local to this plugin; later attachments and detachments still run. */
async function attachActivatedPlugin(
  required: { deps: PluginActivationPollDeps; attachedIds: Set<string>; failures: Map<string, PluginAttachFailure>; pluginId: string; version: string },
  _optional: Record<string, never> = {}
): Promise<void> {
  const { deps, attachedIds, failures, pluginId, version } = required;
  try {
    await deps.onPluginEnabled(pluginId);
    attachedIds.add(pluginId);
    if (failures.delete(pluginId)) deps.logger.info({ message: `[plugin-runtime] plugin '${pluginId}' is attached again after earlier failures` });
  } catch (error) {
    recordAttachFailure({ failures, pluginId, version, logger: deps.logger, error });
  }
}

/** Logs a failure only when it differs from the last one logged for this plugin, then backs off. */
function recordAttachFailure(required: { failures: Map<string, PluginAttachFailure>; pluginId: string; version: string; logger: Logger; error: unknown }): void {
  const { failures, pluginId, version, logger, error } = required;
  // The text only identifies a repeat of the same failure; it is compared, never logged.
  const message = error instanceof Error ? error.message : String(error);
  const previous = failures.get(pluginId);
  if (previous?.message !== message) {
    logger.warn({ message: `[plugin-runtime] plugin activation poll failed to attach '${pluginId}'` }, { error });
  }
  const count = previous?.message === message && previous.version === version ? previous.failures + 1 : 1;
  failures.set(pluginId, { message, version, failures: count, skipPasses: Math.min(2 ** count - 1, MAX_SKIP_PASSES) });
}

/**
 * Starts this process's periodic reconciliation against the durable activation table (P0b).
 * Seeds `attachedIds` from the SAME rows `pluginRuntimeReady`'s boot attach already used, so the
 * first tick reconciles only what changed since boot rather than redundantly re-attaching
 * everything. Returns a `stop()` the caller invokes on shutdown; the timer is `unref()`'d so it
 * never holds the process open on its own.
 */
export function startPluginActivationPolling(
  deps: PluginActivationPollDeps & { readonly pluginRuntimeReady: Promise<void> },
  options: { intervalMs?: number } = {}
): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 5000;
  const attachedIds = new Set<string>();
  const failures = new Map<string, PluginAttachFailure>();
  let stopped = false;
  // A pass can already be awaiting readiness or a durable read when stop() clears the timer.
  // Check again at each registry boundary so that settling that pass cannot change hooks.
  const pollingDeps: PluginActivationPollDeps = {
    ...deps,
    onPluginEnabled: async (pluginId) => { if (!stopped) await deps.onPluginEnabled(pluginId); },
    onPluginDisabled: (pluginId) => { if (!stopped) deps.onPluginDisabled(pluginId); },
  };

  const seeded = deps.pluginRuntimeReady.then(async () => {
    const records = await deps.pluginActivationRepo.listAll();
    for (const record of records) {
      if (record.workspaceId === deps.workspaceId && record.enabled) attachedIds.add(record.pluginId);
    }
  });
  // Each tick reports a seeding failure; without this handler a readiness rejection before the
  // first tick is an unhandled rejection, which Node's default mode turns into a process crash.
  seeded.catch(() => undefined);

  const timer = setInterval(() => {
    if (stopped) return;
    void seeded
      .then(() => stopped ? undefined : reconcilePluginActivationsOnce({ deps: pollingDeps, attachedIds, failures }))
      .catch((error: unknown) => {
            deps.logger.warn({ message: "[plugin-runtime] plugin activation poll failed" }, { error });
      });
  }, intervalMs);
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

