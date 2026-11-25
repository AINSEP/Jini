/**
 * @file Boot and provider-admission phases of the plugin runtime core (G08 split): first-boot
 * defaults, the boot conflict pass, per-plugin re-attach and bounded provider loading. Every failure
 * here is logged and isolated per plugin; nothing throws out of boot.
 */
import { describeErrorForLog, redactSecrets } from "@jini-ai/core";
import { observed } from "@jini-ai/core/errors/idioms";
import { createConsoleLogger } from "@jini-ai/core/primitives";
import { initializeBundledPlugins } from "../bundled-initialization.js";
import type { PluginDiscoveryRecord } from "../discovery-types.js";
import { quarantinePlugin } from "../quarantine.js";
import { describeBootConflictQuarantine, type PluginConflict } from "../plugin-claims.js";
import { assertPluginInstallIdle } from "./install.js";
import { PluginLoadError } from "./loader.js";
import { declaresProviders } from "./runtime-load-target.js";
import { attachPlugin, onPluginDisabled, onPluginEnabled } from "./runtime-activation.js";
import { discoverActivePlugins, discoverPlugins, listPluginConflicts } from "./runtime-conflicts.js";
import type { RuntimeState } from "./runtime-state.js";

type RuntimeArgs<E, O> = { state: RuntimeState<E, O> };

/** Boot-time conflict pass (2026-10-04): the newer plugin of every conflicting pair is turned off
 * through the same durable quarantine record hook failures use, with the clash as its reason, so
 * it shows on the admin row and stays off on the next boot instead of racing the older one. */
async function quarantineConflictingAtBoot<E, O>(
  { state, conflicts, enabledIds }: RuntimeArgs<E, O> & { conflicts: ReadonlyMap<string, readonly PluginConflict[]>; enabledIds: ReadonlySet<string> },
  _options = {},
): Promise<ReadonlySet<string>> {
  const quarantined = new Set<string>();
  for (const [pluginId, pluginConflicts] of conflicts) {
    if (!enabledIds.has(pluginId)) continue;
    const reason = describeBootConflictQuarantine({ conflicts: pluginConflicts });
    await quarantinePlugin({ deps: state.quarantineDeps, input: { pluginId, workspaceId: state.required.workspaceId, consecutiveFailures: 0, reason } });
    onPluginDisabled({ state, pluginId });
    createConsoleLogger({ prefix: '' }).warn({ message: `[plugin-runtime] '${pluginId}' quarantined at boot: ${reason}` });
    quarantined.add(pluginId);
  }
  return quarantined;
}

async function initializeBootDefaults<E, O>({ state }: RuntimeArgs<E, O>, _options = {}) {
  const { optional, required } = state;
  // Serialize first-boot defaults with boot attachment. Existing disabled/quarantined rows win.
  const initialized = await initializeBundledPlugins({
    deps: { clock: required.clock, repo: required.activationRepo, discovery: optional.bundledEnabledIds?.length ? await discoverPlugins({ state }).catch((error: unknown) => {
      console.warn("[plugin-runtime] bundled discovery failed; chart providers remain unavailable", describeErrorForLog({ err: error }));
      return [];
    }) : [], onEnabled: (pluginId) => onPluginEnabled({ state, pluginId }), onDisabled: (pluginId) => onPluginDisabled({ state, pluginId }) },
    input: { workspaceId: required.workspaceId, pluginIds: optional.bundledEnabledIds ?? [] },
  });
  for (const failure of initialized.failed) console.warn(redactSecrets({ input: `[plugin-runtime] bundled initialization failed for '${failure.pluginId}'` }, { redactPii: false }), describeErrorForLog({ err: failure.error }));
  return initialized;
}

/** Discovery + conflict quarantine for the enabled set. Returns null (after turning every enabled plugin
 * off) when the pass could not finish. */
async function runBootConflictPass<E, O>(
  { state, enabledHere }: RuntimeArgs<E, O> & { enabledHere: readonly { pluginId: string }[] },
  _options = {},
): Promise<{ discovery: readonly PluginDiscoveryRecord[]; quarantined: ReadonlySet<string> } | null> {
  try {
    const discovery = await discoverActivePlugins({ state });
    const quarantined = await quarantineConflictingAtBoot({
      state,
      conflicts: await listPluginConflicts({ state, discovery }),
      enabledIds: new Set(enabledHere.map((record) => record.pluginId)),
    });
    return { discovery, quarantined };
  } catch (error) {
    // Fail closed: without a finished conflict pass there is no telling which of two clashing
    // plugins should run, so none is attached this boot (each would previously have failed its
    // own discovery read here anyway). Logged, not thrown — same isolation as a per-plugin failure.
    createConsoleLogger({ prefix: '' }).warn({ message: '[plugin-runtime] boot conflict check failed, no plugin attached' }, { error });
    for (const record of enabledHere) onPluginDisabled({ state, pluginId: record.pluginId });
    return null;
  }
}

export async function attachEnabledPluginsAtBoot<E, O>({ state }: RuntimeArgs<E, O>, _options = {}): Promise<void> {
  await state.snapshots?.ready;
  const initialized = await initializeBootDefaults({ state }, {});
  const records = await state.required.activationRepo.listAll();
  const enabledHere = records.filter(
    (record) => record.workspaceId === state.required.workspaceId && record.enabled
  );
  if (enabledHere.length === 0) return;
  const pass = await runBootConflictPass({ state, enabledHere });
  if (pass === null) return;
  for (const record of enabledHere) {
    // The initializer already attached it.
    if (pass.quarantined.has(record.pluginId) || initialized.enabled.includes(record.pluginId)) continue;
    await reattachBootPlugin({ state, pluginId: record.pluginId, discovery: pass.discovery });
  }
}

async function reattachBootPlugin<E, O>({ state, pluginId, discovery }: RuntimeArgs<E, O> & { pluginId: string; discovery: readonly PluginDiscoveryRecord[] }, _options = {}): Promise<void> {
  const { installDir } = state;
  try {
    if (installDir !== undefined) await assertPluginInstallIdle({ installDir });
    const discovered = discovery.find((candidate) => candidate.id === pluginId);
    if (!discovered) throw new PluginLoadError(pluginId, "PLUGIN_EXPORT_INVALID");
    // A tier-1 plugin has no code to re-attach; its declared types were stored at enable.
    // Provider plugins were already loaded by `loadProviderPlugins`, ahead of application work.
    if (discovered.manifest?.tier === "tier-1" || declaresProviders({ manifest: discovered.manifest })) return;
    await attachPlugin({ state, pluginId, record: discovered });
  } catch (error) {
    createConsoleLogger({ prefix: '' }).warn({ message: `[plugin-runtime] boot re-attach failed for '${pluginId}'` }, { error });
  }
}

/** Import + setup of one selected provider plugin, bounded: boot never waits on a stalled plugin. On the
 *  deadline the caller revokes the selection (`onPluginDisabled`), so a late setup cannot publish. */
async function attachProviderWithin<E, O>({ state, record, timeoutMs }: RuntimeArgs<E, O> & { record: PluginDiscoveryRecord; timeoutMs: number }, _options = {}): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`provider plugin load timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  const attached = attachPlugin({ state, pluginId: record.id, record });
  // Observed even after the deadline wins, so a late failure is never an unhandled rejection.
  observed({ promise: attached });
  try { await Promise.race([attached, deadline]); } finally { clearTimeout(timer); }
}

/** Ids of the plugins whose activation row is enabled in THIS workspace. */
async function enabledPluginIds<E, O>({ state }: RuntimeArgs<E, O>, _options = {}): Promise<ReadonlySet<string>> {
  return new Set((await state.required.activationRepo.listAll())
    .filter((row) => row.workspaceId === state.required.workspaceId && row.enabled).map((row) => row.pluginId));
}

export async function listProviderPlugins<E, O>({ state }: RuntimeArgs<E, O>, _options = {}) {
  const enabled = await enabledPluginIds({ state });
  return (await discoverActivePlugins({ state }))
    .filter((record) => enabled.has(record.id) && declaresProviders({ manifest: record.manifest }))
    .map((record) => ({ pluginId: record.id, providers: record.manifest!.contributes!.providers! }));
}

export async function loadProviderPlugins<E, O>({ state, pluginIds }: RuntimeArgs<E, O> & { pluginIds: readonly string[] }, options: { timeoutMs?: number } = {}): Promise<readonly string[]> {
  const wanted = new Set(pluginIds);
  if (wanted.size === 0) return [];
  const enabled = await enabledPluginIds({ state });
  const loaded: string[] = [];
  for (const record of await discoverActivePlugins({ state })) {
    if (!wanted.has(record.id) || !enabled.has(record.id) || !declaresProviders({ manifest: record.manifest })) continue;
    state.selectedProviders.add(record.id);
    try {
      await attachProviderWithin({ state, record, timeoutMs: options.timeoutMs ?? 10_000 });
      loaded.push(record.id);
    } catch (error) {
      onPluginDisabled({ state, pluginId: record.id });
      console.warn(`[plugin-runtime] provider plugin '${record.id}' failed to load; its contract stays on the noop: ${describeErrorForLog({ err: error })}`);
    }
  }
  return loaded;
}
