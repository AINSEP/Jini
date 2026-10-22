/**
 * @file Site-plugin removal policy. Removal moves package files to the shared Trash adapter;
 * activation rows remain until permanent purge so restore brings the plugin back disabled.
 */
import { PluginNotFoundError } from "./activation.js";
import type { PluginActivationRepoPort } from "./activation.js";
import type { PluginDiscoveryRecord } from "./discovery-types.js";
import type { RemoveEntity } from "./ports.js";

/** A built-in plugin has no on-disk artifact — there is nothing for `DELETE .../plugins/:id` to
 * remove. Distinct from `PluginNotFoundError` (id doesn't exist at all) so the route can map each
 * to its own status code (mirrors `PluginInvalidError`/`PluginIncompatibleError` both being
 * distinct from `PluginNotFoundError` in `activation.ts`). */
export class PluginNotUninstallableError extends Error {}

/** The plugin is currently enabled in at least one workspace. Since the on-disk artifact is
 * instance-wide (shared across every workspace this `installDir` serves), uninstalling while ANY
 * workspace still has it enabled would silently break that workspace's runtime. */
export class PluginEnabledError extends Error {}

/** The plugin a human confirmed uninstalling is no longer the name and version discovery reports — see
 *  `UninstallPluginOptional.confirmedPreview`. Nothing was removed. */
export class PluginChangedSincePreviewError extends Error {}

export class PluginAlreadyInTrashError extends Error {}

export type RemovePluginFn = RemoveEntity;

export interface UninstallPluginDeps {
  readonly repo: PluginActivationRepoPort;
  /** Caller-supplied fresh discovery snapshot — same convention as `SetPluginEnabledDeps.discovery`
   * (`activation.ts`): this function evaluates preconditions over an already-known snapshot rather
   * than calling discovery itself, so it stays deterministic and testable without a real
   * filesystem scan. */
  readonly discovery: readonly PluginDiscoveryRecord[];
  readonly remove: RemovePluginFn;
}

export interface UninstallPluginInput {
  readonly pluginId: string;
  readonly workspaceId: string;
  readonly at: string;
  readonly actor: { principalId: string; pluginId?: string | null };
}

export interface UninstallPluginRequired {
  deps: UninstallPluginDeps;
  input: UninstallPluginInput;
}

export interface UninstallPluginOptional {
  /** The preview a human confirmed. When given, the uninstall refuses before `remove` (so nothing is removed)
   *  unless the record it resolves still has the previewed name and version (t91 F2.2). The admin HTTP route has no
   *  gap between showing and removing, and omits it. */
  readonly confirmedPreview?: PluginUninstallPreview;
}

export interface UninstallPluginResult {
  readonly trashed: true;
}

/** What `resolveUninstallTarget` found after checking every workspace's activation. */
interface UninstallTarget { readonly record: PluginDiscoveryRecord }

/**
 * Evaluates `uninstallPlugin()`'s two preconditions with no mutation. Factored out so
 * `previewUninstallPlugin` (below) and `uninstallPlugin` share exactly one place these rules are
 * expressed, and so a refusal reaches a caller BEFORE it asks a human to confirm anything — asking
 * "uninstall this?" about a built-in or still-enabled plugin would be a dialog with no honest
 * "yes" behind it.
 *
 * @throws {PluginNotFoundError} `pluginId` is absent from `deps.discovery`.
 * @throws {PluginNotUninstallableError} the discovered record's `source` is `"built-in"`.
 * @throws {PluginEnabledError} the plugin is enabled in one or more workspaces.
 * @complexity O(activation rows for this plugin) — one `listAll()` scan (bounded by total
 * activation rows in this instance).
 */
async function resolveUninstallTarget(deps: UninstallPluginDeps, pluginId: string): Promise<UninstallTarget> {
  const record = deps.discovery.find((candidate) => candidate.id === pluginId);
  if (!record) {
    throw new PluginNotFoundError(`plugin '${pluginId}' was not found in the current discovery snapshot`);
  }
  if (record.source === "built-in") {
    throw new PluginNotUninstallableError(`plugin '${pluginId}' is a built-in plugin and cannot be uninstalled`);
  }

  const allActivations = await deps.repo.listAll();
  const matching = allActivations.filter((activation) => activation.pluginId === pluginId);
  if (matching.some((activation) => activation.enabled)) {
    throw new PluginEnabledError(
      `plugin '${pluginId}' is enabled in at least one workspace and must be disabled everywhere before it can be uninstalled`
    );
  }
  return { record };
}

/** What a human confirmation dialog needs to describe truthfully what is about to be removed.
 *  Mirrors `agent-plugins/uninstall.ts`'s own `AgentPluginUninstallPreview` for the sibling family,
 *  for the identical reason: the preview carries no host path, only the fields a dialog may say out
 *  loud. */
export interface PluginUninstallPreview {
  readonly pluginId: string;
  readonly name: string;
  readonly version: string;
}

/**
 * Evaluates `uninstallPlugin()`'s preconditions and returns what a confirmation dialog needs to name
 * — performing no mutation, so a caller can raise that dialog only once the target is known-good.
 *
 * @throws {PluginNotFoundError} `required.input.pluginId` is absent from `deps.discovery`.
 * @throws {PluginNotUninstallableError} the discovered record's `source` is `"built-in"`.
 * @throws {PluginEnabledError} the plugin is enabled in one or more workspaces.
 * @complexity O(activation rows for this plugin) — delegates to `resolveUninstallTarget`.
 */
export async function previewUninstallPlugin(required: UninstallPluginRequired, _optional: Record<string, never> = {}): Promise<PluginUninstallPreview> {
  const { record } = await resolveUninstallTarget(required.deps, required.input.pluginId);
  return { pluginId: record.id, name: record.name, version: record.version };
}

/**
 * Moves a site-installed plugin to Trash. Activation rows stay in place until permanent purge.
 *
 * @throws {PluginNotFoundError} `input.pluginId` is absent from `deps.discovery`.
 * @throws {PluginNotUninstallableError} the discovered record's `source` is `"built-in"`.
 * @throws {PluginEnabledError} the plugin is enabled in one or more workspaces.
 * @throws {PluginChangedSincePreviewError} `optional.confirmedPreview` was given and the record's name or version differs from it.
 * @complexity O(activation rows for this plugin) plus one delegated remove.
 */
export async function uninstallPlugin(
  required: UninstallPluginRequired,
  optional: UninstallPluginOptional = {}
): Promise<UninstallPluginResult> {
  const { deps, input } = required;

  const { record } = await resolveUninstallTarget(deps, input.pluginId);
  assertUnchangedSincePreview(record, optional.confirmedPreview);

  const result = await deps.remove({
    workspaceId: input.workspaceId,
    id: input.pluginId,
    display: { title: record.name, subtitle: `${record.id} ${record.version}` },
    at: input.at,
    expectedVersion: null,
    actor: input.actor,
  });
  if (result.ok) return { trashed: true };
  if (result.reason === "blocked") {
    throw new PluginAlreadyInTrashError(`plugin '${input.pluginId}' is already in the Trash`);
  }
  throw new PluginNotFoundError(`plugin '${input.pluginId}' was not found while moving it to the Trash`);
}

export async function forgetPluginActivations(
  required: { pluginId: string; deps: { repo: PluginActivationRepoPort } },
  _optional: Record<string, never> = {},
): Promise<void> {
  for (const activation of await required.deps.repo.listAll()) {
    if (activation.pluginId === required.pluginId) {
      await required.deps.repo.deleteActivation({ workspaceId: activation.workspaceId, pluginId: required.pluginId });
    }
  }
}

/**
 * Refuses when the record resolved now does not carry the name and version the confirmed preview showed.
 * @throws {PluginChangedSincePreviewError} Name or version differs.
 * @complexity O(1).
 */
function assertUnchangedSincePreview(record: PluginDiscoveryRecord, confirmedPreview: PluginUninstallPreview | undefined): void {
  if (confirmedPreview === undefined) return;
  if (record.name === confirmedPreview.name && record.version === confirmedPreview.version) return;
  throw new PluginChangedSincePreviewError(
    `plugin '${record.id}' changed after its uninstall was previewed (previewed ${confirmedPreview.name} ${confirmedPreview.version}; ` +
      `now ${record.name} ${record.version}) — nothing was removed`,
  );
}
