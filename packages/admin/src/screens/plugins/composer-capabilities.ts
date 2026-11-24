/**
 * @file The package half of the composer-capability projection: the capability/source/projection
 * contract, the fail-closed projection that groups every source's capabilities, and the name-first
 * slash ranking. A host owns EFFECT and inventory (its bundled catalog, its route resolver, its live
 * sources) and passes those sources in; this module never learns a host taxonomy.
 *
 * `ComposerDiscoveryItem`/`ComposerDiscoveryGroup` below restate, structurally and field for field,
 * the shapes `@jini-ai/chat/react` (`react/slots.ts`) owns: the admin package may import only
 * `@jini-ai/core`/`@jini-ai/protocol`, so it cannot name chat's types, and a host passes the
 * projected groups straight to chat's composer — the two must stay assignable both ways.
 */

/** Structural restatement of `@jini-ai/chat/react`'s `ComposerDiscoveryArgument`. */
export interface ComposerDiscoveryArgument {
  placeholder: string;
  required?: boolean;
}

/** Structural restatement of `@jini-ai/chat/react`'s `ComposerDiscoveryItem`. */
export interface ComposerDiscoveryItem {
  id: string;
  label: string;
  description?: string;
  kind?: string;
  keywords?: readonly string[];
  insertText?: string;
  command?: string;
  argument?: ComposerDiscoveryArgument;
  needsConfirmation?: boolean;
}

/** Structural restatement of `@jini-ai/chat/react`'s `ComposerDiscoveryGroup`. */
export interface ComposerDiscoveryGroup {
  id: string;
  label: string;
  items: readonly ComposerDiscoveryItem[];
}

/**
 * The host execution shapes a composer capability may resolve to. Never inspected by
 * `@jini-ai/chat` — `ComposerDiscoveryItem.command`/`argument`/`needsConfirmation` are the only
 * package-visible fields, all presence-only. This union, and the decision of which kind a given
 * capability uses, live entirely on the host side of that boundary.
 */
export type ComposerHostBinding =
  | { readonly kind: "installed-skill"; readonly toolId: string }
  | {
      readonly kind: "compose-text";
      /** Verbatim replacement for the draft; the user reviews and sends it like any other message. */
      readonly text: string;
    }
  | {
      /**
       * NOT wired to any capability in the bundled catalog today — building the mechanism does
       * not decide policy. Which tool ids may be reached this way is
       * `MCP_UI_REDEEMABLE_TOOL_IDS`'s own operator-owned allowlist
       * (`src/assistant/mcp-ui-tool-calls.ts`); adding one is an explicit owner decision.
       */
      readonly kind: "allowlisted-tool-call";
      readonly toolName: string;
      readonly params: Readonly<Record<string, unknown>>;
    };

/**
 * A previewable capability's content, carried through the projection ahead of any UI that renders
 * it. Added reconciling the Agent Plugins adapter's candidate descriptor shape
 * (`src/features/agent-plugins/capability-projection.ts`'s `AgentPluginCapabilityPreview`) — a
 * Skill's real markdown is genuinely previewable data today, even though `AssistantDock` has no
 * preview surface yet to show it in (debate 3's "previewable but structurally inert" applies to
 * execution, not to whether the data exists to preview).
 */
export interface ComposerCapabilityPreview {
  readonly kind: "markdown";
  readonly content: string;
}

/**
 * One capability the composer can discover, paired with how to resolve a selection of it into an
 * effect. `resolve` is omitted for an item with no execution beyond its own `insertText`/`label`
 * macro, an existing client-local route (e.g. `/mcp`), or a source-level decision that the item is
 * structurally inert (the former raw tool-catalog source was deliberately
 * `resolve`-less: there is no text to compose for a tool the agent calls itself) — selecting such an
 * item resolves to `undefined` through `resolveComposerDiscoveryOutcome`, a documented no-op, not a
 * silent bug.
 *
 * `resolve` receives the invocation's `argument` exactly as `ComposerDiscoverySelection` carries
 * it (`undefined` for a plain item, `null` | `""` | the typed text for a `command`-bearing one) so
 * a binding can be built from what the composer actually resolved, not a pre-computed guess.
 */
export interface ComposerCapability {
  readonly groupId: string;
  readonly groupLabel: string;
  readonly item: ComposerDiscoveryItem;
  readonly resolve?: (required: { argument: string | null | undefined }, optional?: Record<string, never>) => ComposerHostBinding;
  /** See {@link ComposerCapabilityPreview}. Absent for a capability with nothing to preview. */
  readonly preview?: ComposerCapabilityPreview;
  /**
   * A source-specific cache/invalidation key — e.g. an installed package's content digest. Unused
   * by `projectComposerCapabilities` and set by no source today; carried through so a future source
   * doesn't need a second contract change to add one.
   */
  readonly revision?: string;
  /**
   * When set, selecting this capability pins a removable chip to the composer instead of doing
   * anything to the draft — added 2026-08-21 so the "UI/UX Design (Agent Plugin)" row actually
   * reaches the agent (previously `insertText` typed an inert label string into the draft; the
   * agent had no way to tell that apart from the user having typed the same words themselves).
   * The value is the installed Agent Plugin's own `plugin.json` `name` (e.g. `"ui-ux-design"`),
   * carried opaque through `AssistantDock`'s composer state, `onSend`'s `contextRef.pluginRefIds`,
   * and finally resolved against the on-disk package by `agent-daemon-server.ts`'s `onStarted` —
   * see that function's own doc for the resolution/failure rules. Never combined with `resolve` in
   * the bundled catalog today (a capability either composes text/calls a tool, or pins a plugin
   * ref), but the two fields are not mutually exclusive by type — a future capability could
   * plausibly want a compose-text default AND a pinnable chip.
   */
  readonly pluginRefId?: string;
}

/**
 * One contributor to the projected catalog. `list()` is async because the real registry this
 * mirrors (`src/assistant/tool-registrations.ts`) is server-side — ~21 domain modules assembled
 * once at daemon boot, never importable into the browser bundle (per `AssistantDock.tsx`'s own
 * module doc). Today's only source (`createBundledComposerCapabilitySource`) is synchronous,
 * compile-time-known data wrapped in a resolved Promise — genuinely async-shaped, not a stub, and
 * the exact seam a future live source (a tool-registry-backed fetch, or the Agent Plugins adapter
 * a separate workstream is building against this same contract) plugs into without this module or
 * `AssistantDock.tsx` changing shape.
 */
export interface ComposerCapabilitySource {
  readonly id: string;
  list(): Promise<readonly ComposerCapability[]>;
}

export interface ComposerCapabilityProjection {
  readonly groups: readonly ComposerDiscoveryGroup[];
  /** Keyed by `ComposerDiscoveryItem.id` — what `AssistantDock`'s `onDiscoverySelect` looks a selection up in. */
  readonly byItemId: ReadonlyMap<string, ComposerCapability>;
  /**
   * Keyed by `ComposerCapability.pluginRefId` — what `AssistantDock.tsx`'s chip tray looks a
   * pinned ref back up in, to render the capability's own `label` on the chip rather than a bare
   * id. Only capabilities that set `pluginRefId` are indexed here; most never do.
   */
  readonly byPluginRefId: ReadonlyMap<string, ComposerCapability>;
}

const EMPTY_PROJECTION: ComposerCapabilityProjection = { groups: [], byItemId: new Map(), byPluginRefId: new Map() };

/** The projection an as-yet-unresolved source set renders as: no groups, nothing selectable. */
export function emptyComposerCapabilityProjection(): ComposerCapabilityProjection {
  return EMPTY_PROJECTION;
}

/**
 * Fails closed on a duplicate item id, across sources or within one — the same hazard
 * `buildAssistantToolRegistrations` (`src/assistant/tool-registrations.ts`) already refuses for
 * the equivalent collision in the real tool registry. A silent second binding for the same id
 * would make selecting it non-deterministic depending on source order. Split out of
 * {@link projectComposerCapabilities}'s loop body purely to keep that function's own cognitive
 * complexity under the gate — same behavior, same error text, one less level of loop-nested `if`.
 */
function registerItemId({ byItemId, capability }: {
  byItemId: Map<string, ComposerCapability>,
  capability: ComposerCapability,
}, _optional = {}): void {
  const existing = byItemId.get(capability.item.id);
  if (existing) {
    throw new Error(
      `composer-capabilities: duplicate discovery item id "${capability.item.id}" ` +
        `(groups "${existing.groupId}" and "${capability.groupId}")`,
    );
  }
  byItemId.set(capability.item.id, capability);
}

/**
 * Same "fail closed on a collision" posture as {@link registerItemId} — a silent second
 * capability claiming the same plugin ref would make the chip tray's label lookup
 * non-deterministic depending on source order, which is the exact hazard that guard already
 * exists to prevent for item ids. No-op for a capability that never sets `pluginRefId` (most
 * don't) — see {@link ComposerCapability.pluginRefId}'s own doc.
 */
function registerPluginRef({ byPluginRefId, capability }: {
  byPluginRefId: Map<string, ComposerCapability>,
  capability: ComposerCapability,
}, _optional = {}): void {
  if (!capability.pluginRefId) return;
  const existingByRef = byPluginRefId.get(capability.pluginRefId);
  if (existingByRef) {
    throw new Error(
      `composer-capabilities: duplicate pluginRefId "${capability.pluginRefId}" ` +
        `(items "${existingByRef.item.id}" and "${capability.item.id}")`,
    );
  }
  byPluginRefId.set(capability.pluginRefId, capability);
}

/** The capability's group, creating and ordering it on first sight — same behavior as the
 *  inlined `let group = ...; if (!group) {...}` this replaces, extracted for the same
 *  complexity-budget reason as {@link registerItemId}/{@link registerPluginRef}. */
function getOrCreateGroup({ itemsByGroup, groupOrder, capability }: {
  itemsByGroup: Map<string, { label: string; items: ComposerDiscoveryItem[] }>,
  groupOrder: string[],
  capability: ComposerCapability,
}, _optional = {}): { label: string; items: ComposerDiscoveryItem[] } {
  let group = itemsByGroup.get(capability.groupId);
  if (!group) {
    group = { label: capability.groupLabel, items: [] };
    itemsByGroup.set(capability.groupId, group);
    groupOrder.push(capability.groupId);
  }
  return group;
}

/**
 * Composes every source's capabilities into one grouped catalog plus a selection-lookup index.
 *
 * @complexity O(n) in the total capability count across all sources.
 * @overallScore 100
 */
export async function projectComposerCapabilities(
  { sources }: { sources: readonly ComposerCapabilitySource[] }, _optional: Record<string, never> = {},
): Promise<ComposerCapabilityProjection> {
  const bySource = await Promise.all(sources.map((source) => source.list()));
  const capabilities = labelComposerCapabilities(bySource.flat());

  const groupOrder: string[] = [];
  const itemsByGroup = new Map<string, { label: string; items: ComposerDiscoveryItem[] }>();
  const byItemId = new Map<string, ComposerCapability>();
  const byPluginRefId = new Map<string, ComposerCapability>();

  for (const capability of capabilities) {
    registerItemId({ byItemId, capability });
    registerPluginRef({ byPluginRefId, capability });
    const group = getOrCreateGroup({ itemsByGroup, groupOrder, capability });
    group.items.push(capability.item);
  }

  return {
    groups: groupOrder.map((id) => {
      const group = itemsByGroup.get(id);
      if (!group) throw new Error(`composer capability group ${id} is missing`);
      return { id, label: group.label, items: group.items };
    }),
    byItemId,
    byPluginRefId,
  };
}
/** Names identify the resource; suffixes identify how it reaches the agent. Plugins and standalone
 * skills have different files and enablement gates, so matching names alone never justify dedupe. */
function labelComposerCapabilities(capabilities: readonly ComposerCapability[]): readonly ComposerCapability[] {
  const skillNames = new Set(capabilities.filter(c => c.item.kind === "skill").map(c => discoveryName(c.item)));
  return capabilities.map(capability => {
    if (capability.item.kind === "skill") return { ...capability, item: { ...capability.item, label: `${capability.item.label} · Skill` } };
    if (capability.pluginRefId && skillNames.has(discoveryName(capability.item))) {
      return { ...capability, item: { ...capability.item, label: `${capability.item.label.replace(/ \(Agent Plugin\)$/i, "")} · Agent plugin` } };
    }
    return capability;
  });
}

function discoveryLabelName(item: ComposerDiscoveryItem): string {
  return item.label.replace(/ · (Skill|Agent plugin)$/i, "").replace(/ \(Agent Plugin\)$/i, "").replace(/^\//, "").toLowerCase();
}

function discoveryName(item: ComposerDiscoveryItem): string {
  return item.command?.toLowerCase() ?? discoveryLabelName(item);
}

function nameMatchRank({ name, query }: { name: string; query: string }, _optional = {}): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(/[^\p{L}\p{N}]+/u).some(word => word.startsWith(query))) return 2;
  return name.includes(query) ? 3 : 4;
}

/** Global name-first ranking, independent of source/group order. Jini still owns filtering and
 * locked argument grammar. Single-item groups preserve each source label while allowing ranks
 * to interleave across sources instead of giving an entire early group priority. */
export function rankComposerDiscoveryGroups({ groups, draft }: { groups: readonly ComposerDiscoveryGroup[]; draft: string }, _optional = {}): readonly ComposerDiscoveryGroup[] {
  const match = /^\/([^\s/]*)/.exec(draft);
  if (!match) return groups;
  // Group 1 is `([^\s/]*)` — it always participates once the regex matches (possibly as ""), so
  // the `?? ""` never fires; it only satisfies this package's `noUncheckedIndexedAccess`.
  const query = (match[1] ?? "").toLowerCase();
  const rows = groups.flatMap(group => group.items.map(item => ({ group, item, name: discoveryName(item) })));
  // A related plugin/skill pair shares an identity; choose the best name tier for the family,
  // then list its installed skill first. Unrelated names keep the strict tier ordering.
  const familyRanks = new Map<string, number>();
  for (const row of rows) familyRanks.set(row.name, Math.min(familyRanks.get(row.name) ?? 4, nameMatchRank({ name: row.name, query }), nameMatchRank({ name: discoveryLabelName(row.item), query })));
  const skillFamilies = new Set(rows.filter(row => row.item.kind === "skill").map(row => row.name));
  rows.sort((a, b) => {
    const rankA = familyRanks.get(a.name);
    const rankB = familyRanks.get(b.name);
    if (rankA === undefined || rankB === undefined) throw new Error("composer capability family has no rank");
    return (rankA - rankB) || Number(skillFamilies.has(b.name)) - Number(skillFamilies.has(a.name)) || a.name.localeCompare(b.name) || Number(b.item.kind === "skill") - Number(a.item.kind === "skill");
  });
  return rows.map(({ group, item }) => ({ id: `${group.id}:${item.id}`, label: group.label, items: [item] }));
}
