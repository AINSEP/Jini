/**
 * @file Tovu's plugin conflict rules on top of the neutral detector (`claim-conflicts.ts`):
 * what a `tovu.plugin.json` claims, who keeps a contested name, and the sentence an operator or an
 * agent reads when a plugin is refused.
 *
 * Spec note: `ADS-memory/specs/005-plugin-system/conflicts.spec.md`.
 *
 * ## What a plugin claims
 * - every `contributes` entry (routes, tools, tables, settings, widgets, permissions) — exclusive;
 * - every hook it attaches, with the HOST's semantics for that hook ({@link PLUGIN_HOOK_SEMANTICS}):
 *   `content.entry.beforeSave` is a shared pipeline — every enabled filter runs in TB-01 order and
 *   writes only its own `ext.{id}` namespace (BR-04), so two plugins on it is the design, not a
 *   clash. A hook this table does not know is treated as EXCLUSIVE: a newly added hook point that
 *   nobody classified must fail safe (refuse the second plugin) rather than silently stack;
 * - its generated capability tool (`plugin_capability_<id>`) when it declares `fields`, because
 *   that tool is registered in the same agent tool registry as everything else;
 * - every content type it declares (`contentTypes[].key`, kind `content-type`, AW-7 Tier 1) — one
 *   key is one Collection, so the second plugin to declare `faq` is refused here instead of
 *   silently sharing (or schema-clashing on) the first one's type.
 * Field paths are NOT claims: `validateManifest` already forces them under `ext.{id}.`, and ids are
 * unique (ID_DUPLICATE / SHADOWS_BUILT_IN), so two plugins can never name the same field.
 *
 * ## Who wins
 * Core first, always. Then plugins in the order they were turned on (activation `updatedAt`
 * ascending; built-in before site, then id, only to break exact ties), so the plugin that was
 * already working keeps working and the NEWER one is refused. At enable time the plugin being
 * turned on is placed last regardless of timestamps — it is by definition the newer one, even
 * when a coarse or fixed clock gives it the same `updatedAt` as an earlier plugin.
 *
 * ## Where it runs (composition: `server/runtime/composition/plugin-runtime.ts`)
 * - enable (admin route, agent tool, activation poll): `onPluginEnabled` throws
 *   {@link PluginConflictError} before any plugin code is imported; `setPluginEnabled` then restores
 *   the prior activation row, so a refused enable leaves nothing half-on;
 * - boot: `attachEnabledPluginsAtBoot` resolves every enabled plugin together and QUARANTINES the
 *   losers through `quarantine.ts` (the same durable "disabled + reason" record hook failures use);
 * - list (admin screen, `plugins_list`): `listPluginConflicts` reports enabled losers and the clash a
 *   disabled plugin WOULD hit if turned on now, so the operator sees it before clicking.
 */
import type { ManifestHostPorts } from "./ports.js";

import type { PluginActivationRecord } from "./activation.js";
import { resolveClaimConflicts, type ClaimConflict, type ClaimMode, type ClaimOwner, type ExtensionClaim } from "./claim-conflicts.js";
import type { PluginDiscoveryRecord } from "./discovery-types.js";
import { CORE_OWNER_ID, type PluginContributions, type PluginManifest } from "./manifest.js";

/** The owner id core's claims are filed under, and how messages name it. */
export { CORE_OWNER_ID };

/** How each host hook point arbitrates several plugins (see this file's header). */
// Hook semantics are supplied by PluginSdkBinding; product hook names remain host-owned.

/** `contributes` list -> claim kind. */
const CONTRIBUTION_KINDS: ReadonlyArray<readonly [keyof PluginContributions, string]> = [
  ["routes", "route"],
  ["tools", "tool"],
  ["tables", "table"],
  ["settings", "setting"],
  ["widgets", "widget"],
  ["permissions", "permission"],
];

/**
 * `plugin_capability_<pluginId>` — the agent tool `capability-tool-registrations.ts` generates for a
 * plugin that declares `fields` (hyphens folded to underscores, matching `agent_plugin_<pluginId>`'s
 * own scheme). Moved here from that file (2026-10-04) so the tool's registration and the claim it
 * makes for conflict detection derive the id from ONE function and cannot drift apart.
 */
export function capabilityToolIdFor({ pluginId }: { pluginId: string }, _optional: Record<string, never> = {}): string {
  return `plugin_capability_${pluginId.replace(/-/g, "_")}`;
}

/** One conflict, as the admin screen and the agent see it — the detector's conflict plus the
 *  holder's display name. */
export interface PluginConflict {
  readonly kind: string;
  readonly key: string;
  readonly heldBy: string;
  readonly heldByName: string;
  readonly heldKey: string;
}

/** Every claim one manifest makes (see this file's header for the four sources). */
export function pluginClaimsFromManifest(
  required: { readonly manifest: PluginManifest } & Pick<ManifestHostPorts, "pluginSdkBinding" | "declarativeContentTypes">,
  optional: { readonly hookSemantics?: Readonly<Record<string, ClaimMode>> } = {},
): ExtensionClaim[] {
  const { manifest } = required;
  const hookSemantics = optional.hookSemantics ?? required.pluginSdkBinding.hookSemantics;
  const contributes = manifest.contributes ?? {};
  const declared = CONTRIBUTION_KINDS.flatMap(([list, kind]) =>
    (contributes[list] ?? []).map((key): ExtensionClaim => ({ kind, key, mode: "exclusive" })),
  );
  const hooks = manifest.hooks.map((key): ExtensionClaim => ({ kind: "hook", key, mode: hookSemantics[key] ?? "exclusive" }));
  const generated: ExtensionClaim[] =
    manifest.fields.length > 0 ? [{ kind: "tool", key: capabilityToolIdFor({ pluginId: manifest.id }), mode: "exclusive" }] : [];
  const contentTypes = required.declarativeContentTypes.parse({ value: manifest.contentTypes }).decls.map(
    (decl): ExtensionClaim => ({ kind: "content-type", key: decl.key, mode: "exclusive" }),
  );
  return [...declared, ...hooks, ...generated, ...contentTypes];
}

export interface ResolvePluginConflictsRequired extends Pick<ManifestHostPorts, "pluginSdkBinding" | "declarativeContentTypes" | "coreOwnerName"> {
  readonly workspaceId: string;
  readonly discovery: readonly PluginDiscoveryRecord[];
  readonly activations: readonly PluginActivationRecord[];
  readonly coreClaims: readonly ExtensionClaim[];
}

export interface ResolvePluginConflictsOptional {
  /** The plugin being turned on right now — ordered after every other enabled plugin. */
  readonly candidateId?: string;
  readonly hookSemantics?: Readonly<Record<string, ClaimMode>>;
}

interface EnabledPlugin {
  readonly record: PluginDiscoveryRecord & { readonly manifest: PluginManifest };
  readonly activation: PluginActivationRecord;
}

const SOURCE_RANK: Readonly<Record<PluginDiscoveryRecord["source"], number>> = { "built-in": 0, site: 1 };

/** Earliest-enabled first; `candidateId` always last (see this file's header, "Who wins"). */
function comparePrecedence(candidateId: string | undefined) {
  return (a: EnabledPlugin, b: EnabledPlugin): number => {
    const candidateOrder = Number(a.record.id === candidateId) - Number(b.record.id === candidateId);
    if (candidateOrder !== 0) return candidateOrder;
    const timeOrder = a.activation.updatedAt.localeCompare(b.activation.updatedAt);
    if (timeOrder !== 0) return timeOrder;
    const sourceOrder = SOURCE_RANK[a.record.source] - SOURCE_RANK[b.record.source];
    return sourceOrder !== 0 ? sourceOrder : a.record.id.localeCompare(b.record.id);
  };
}

function hasManifest(record: PluginDiscoveryRecord): record is EnabledPlugin["record"] {
  return record.status === "valid" && record.manifest !== undefined;
}

function toPluginConflicts(conflicts: readonly ClaimConflict[], names: ReadonlyMap<string, string>): PluginConflict[] {
  return conflicts.map((conflict) => ({
    kind: conflict.kind,
    key: conflict.key,
    heldBy: conflict.heldBy,
    heldByName: names.get(conflict.heldBy) ?? conflict.heldBy,
    heldKey: conflict.heldKey,
  }));
}

/**
 * Every plugin in `discovery` that has a conflict: an ENABLED plugin that loses to core or an
 * earlier-enabled plugin, and a valid plugin that is OFF but would lose if turned on now.
 *
 * @complexity O(P · S²) — one detector pass for the enabled set plus one per disabled plugin, each
 *   over a site's handful of plugins.
 */
export function resolvePluginConflicts(
  required: ResolvePluginConflictsRequired,
  optional: ResolvePluginConflictsOptional = {},
): ReadonlyMap<string, readonly PluginConflict[]> {
  const { workspaceId, discovery, activations, coreClaims } = required;
  const claimsOf = (record: EnabledPlugin["record"]): ClaimOwner => ({
    id: record.id,
    claims: pluginClaimsFromManifest({ ...required, manifest: record.manifest }, optional.hookSemantics ? { hookSemantics: optional.hookSemantics } : {}),
  });
  const here = new Map(activations.filter((row) => row.workspaceId === workspaceId).map((row) => [row.pluginId, row]));
  const valid = discovery.filter(hasManifest);
  const enabled = valid
    .flatMap((record): EnabledPlugin[] => {
      const activation = here.get(record.id);
      return activation?.enabled ? [{ record, activation }] : [];
    })
    .sort(comparePrecedence(optional.candidateId));
  const names = new Map<string, string>([[CORE_OWNER_ID, required.coreOwnerName], ...valid.map((record): [string, string] => [record.id, record.name])]);
  const core: ClaimOwner = { id: CORE_OWNER_ID, claims: coreClaims };

  const live = resolveClaimConflicts({ owners: [core, ...enabled.map((each) => claimsOf(each.record))] });
  const result = new Map<string, readonly PluginConflict[]>();
  for (const [ownerId, conflicts] of live.refused) result.set(ownerId, toPluginConflicts(conflicts, names));

  const accepted = new Set(live.accepted);
  const holders = [core, ...enabled.filter((each) => accepted.has(each.record.id)).map((each) => claimsOf(each.record))];
  for (const record of valid) {
    if (here.get(record.id)?.enabled) continue;
    const wouldBe = resolveClaimConflicts({ owners: [...holders, claimsOf(record)] }).refused.get(record.id);
    if (wouldBe) result.set(record.id, toPluginConflicts(wouldBe, names));
  }
  return result;
}

/** One conflict, in words: `tool 'x' is provided by plugin 'a' (A)` / `... is reserved by Tovu core ('/api/*')`. */
function describeOne(conflict: PluginConflict): string {
  const holder =
    conflict.heldBy === CORE_OWNER_ID
      ? `is reserved by ${conflict.heldByName}${conflict.heldKey === conflict.key ? "" : ` ('${conflict.heldKey}')`}`
      : `is provided by plugin '${conflict.heldBy}' (${conflict.heldByName})`;
  return `${conflict.kind} '${conflict.key}' ${holder}`;
}

/** Every conflict in words, `; `-joined — shared by the enable refusal and the boot quarantine reason. */
export function describeConflictList({ conflicts }: { conflicts: readonly PluginConflict[] }, _optional: Record<string, never> = {}): string {
  return conflicts.map(describeOne).join("; ");
}

/** The operator- and agent-facing sentence for a refused plugin: what clashes, who holds it, what to do. */
export function describePluginConflicts(required: { readonly pluginId: string; readonly conflicts: readonly PluginConflict[] }, _optional: Record<string, never> = {}): string {
  const { pluginId, conflicts } = required;
  return (
    `Plugin '${pluginId}' was not turned on because it claims things already in use: ` +
    `${describeConflictList({ conflicts })}. Turn off the other plugin first, or keep '${pluginId}' off.`
  );
}

/** The durable quarantine reason when boot turns a plugin off for a conflict (shown on the admin row). */
export function describeBootConflictQuarantine({ conflicts }: { conflicts: readonly PluginConflict[] }, _optional: Record<string, never> = {}): string {
  return `Turned off at startup because it claims things already in use: ${describeConflictList({ conflicts })}. Turn off the other plugin, then turn this one back on.`;
}

/** Thrown by the enable path when a plugin would take a name core or an enabled plugin holds.
 *  Its message is built only from plugin ids/names and the manifest's own declared names, so it is
 *  safe to show an agent verbatim (see `tool-registrations.ts`'s model-facing rule). */
export class PluginConflictError extends Error {
  readonly pluginId: string;
  readonly conflicts: readonly PluginConflict[];

  constructor(required: { readonly pluginId: string; readonly conflicts: readonly PluginConflict[] }, _optional: Record<string, never> = {}) {
    super(describePluginConflicts(required));
    this.name = "PluginConflictError";
    this.pluginId = required.pluginId;
    this.conflicts = required.conflicts;
  }
}
