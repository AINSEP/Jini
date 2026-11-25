import { useCallback, useEffect, useState } from "react";
import type { ComposerDiscoveryOutcome, ComposerDiscoverySelection } from "../../../../react/kit.js";
import type { useAdminBootScope } from "../../../lib/admin-boot-scope.js";
import { resolveComposerDiscoveryOutcome, type ResolveComposerDiscoveryOutcomeDeps } from "../../../../screens/plugins/resolve-composer-discovery-outcome.js";
import { emptyComposerCapabilityProjection, projectComposerCapabilities, type ComposerCapabilityProjection, type ComposerCapabilitySource } from "../../../../screens/plugins/composer-capabilities.js";

function createComposerReload(
  { installed, state, queryScope, setCatalog, createBundledSource, reportFailure }: {
    installed: ReturnType<Parameters<typeof useComposerCapabilities>[0]["createInstalledSource"]>;
    createBundledSource: () => ComposerCapabilitySource;
    reportFailure: (error: unknown) => void;
    state: { cancelled: boolean; generation: number; shown: string };
    queryScope: ReturnType<typeof useAdminBootScope>["queryScope"];
    setCatalog: React.Dispatch<React.SetStateAction<{ scope: ReturnType<typeof useAdminBootScope>["queryScope"]; projection: ComposerCapabilityProjection }>>;
  },
  _options: Record<string, never> = {},
) {
  /** Reproject only current work; an unchanged catalog retains its React state identity. */
  return (_required = {}, { force = false } = {}) => {
    state.generation += 1;
    const current = state.generation;
    return projectComposerCapabilities({ sources: [createBundledSource(), { id: installed.id, list: () => installed.reload({}, { force }) }] })
    .then((projection) => {
      // An unchanged catalog keeps its state, so refreshes do not re-render the dock. JSON drops
      // `resolve`; every source's binding is derived from the serialized fields (item id).
      const next = JSON.stringify([...projection.byItemId.values()]);
      if (state.cancelled || current !== state.generation || next === state.shown) return;
      state.shown = next;
      setCatalog({ scope: queryScope, projection });
    })
    .catch((error: unknown) => {
      reportFailure(error);
    });
  };
}

function watchComposerCapabilities(
  { queryScope, setCatalog, createInstalledSource, createBundledSource, watch, reportFailure }: {
    createInstalledSource: Parameters<typeof useComposerCapabilities>[0]["createInstalledSource"];
    createBundledSource: () => ComposerCapabilitySource;
    watch: Parameters<typeof useComposerCapabilities>[0]["watch"];
    reportFailure: (error: unknown) => void;
    queryScope: ReturnType<typeof useAdminBootScope>["queryScope"]; setCatalog: React.Dispatch<React.SetStateAction<{ scope: ReturnType<typeof useAdminBootScope>["queryScope"]; projection: ComposerCapabilityProjection }>> },
  _options: Record<string, never> = {},
): () => void {
  // One source per authenticated boot scope and document (same-origin site/API, fixed workspace).
  // No module singleton can retain another user's installed capabilities.
  const installed = createInstalledSource();
  const state = { cancelled: false, generation: 0, shown: "" };
  const reload = createComposerReload({ installed, state, queryScope, setCatalog, createBundledSource, reportFailure });
  void reload();
  const unsubscribe = watch({ refreshVisible: () => { void reload(); }, forceReload: () => { void reload({}, { force: true }); } });
  return () => {
    state.cancelled = true;
    unsubscribe();
  };
}

export interface UseComposerCapabilities {
  /** The composer's discovery catalog — see {@link useComposerCapabilities}'s own doc for what
   *  feeds it and why it starts empty. */
  composerCapabilities: ComposerCapabilityProjection;
}

/**
 * Projects the composer's discovery catalog (debate 2, "Composer slash commands") from the bundled,
 * compile-time source and installed skills, refreshed on open, changes, focus and visibility,
 * plus a conditional check every 60 seconds while the dock is open and the document visible. Split out of
 * `AssistantDock` (2026-08-14 DI migration pass) for the same reason the three hooks above it were:
 * per `INFO.md`'s Components rule 3, any hook doing DOM/IO work gets an injectable seam on
 * `AssistantDockProps`, defaulted to this real implementation — see `AssistantDock.tsx` for the
 * wiring.
 *
 * The raw tool catalog is deliberately NOT in the source list: the menu's job is to let a user point
 * the assistant at a Skill or Agent Plugin whose instructions it should follow, not to hand it a raw
 * tool name (the assistant already picks its own tools once it understands the goal). The ~25 live
 * tool rows that source contributed were also structurally inert — every capability it produces
 * carried no `resolve`, so selecting one did nothing. The unused source and its dedicated tests
 * were removed after confirming that no production code imports them.
 *
 * Starts empty while asynchronous sources load; stale responses are discarded. Installed-source
 * failures leave bundled commands available. The raw tool catalog is intentionally excluded.
 *
 * @returns `composerCapabilities` — the resolved projection, or the empty one before it settles.
 * @complexity O(n) time/space per refresh for n capabilities; at most one pending ordinary check.
 * @example
 * const { composerCapabilities } = useComposerCapabilities();
 */
export function useComposerCapabilities(
  { useBootScopeHook, createInstalledSource, createBundledSource, watch, reportFailure }: {
    useBootScopeHook: typeof useAdminBootScope;
    createInstalledSource: () => ComposerCapabilitySource & { reload(required: Record<string, never>, optional: { force: boolean }): ReturnType<ComposerCapabilitySource["list"]> };
    createBundledSource: () => ComposerCapabilitySource;
    watch: (required: { refreshVisible: () => void; forceReload: () => void }, optional?: Record<string, never>) => () => void;
    reportFailure: (error: unknown) => void;
  },
  _optional: Record<string, never> = {},
): UseComposerCapabilities {
  const { queryScope, checking } = useBootScopeHook();
  const [catalog, setCatalog] = useState(() => ({ scope: queryScope, projection: emptyComposerCapabilityProjection() }));

  useEffect(() => {
    if (checking) return undefined;
    return watchComposerCapabilities({ queryScope, setCatalog, createInstalledSource, createBundledSource, watch, reportFailure });
  }, [queryScope, checking, createInstalledSource, createBundledSource, watch, reportFailure]);

  return { composerCapabilities: catalog.scope === queryScope && !checking ? catalog.projection : emptyComposerCapabilityProjection() };
}

/**
 * Wraps {@link resolveComposerDiscoveryOutcome} as the `onDiscoverySelect` callback
 * `AssistantDock.tsx` passes to `<ChatPane composerSlots={...}>`. Pure derivation/wiring, not I/O
 * of its own — `navigate` is a synchronous client-side route change (already a plain import, not a
 * seam anywhere else in this file), and `callAllowlistedTool` is supplied by the caller (the same
 * `mcpUiToolCaller` singleton registered for MCP-UI surfaces), so this hook has nothing of its own
 * to inject; no `INFO.md` rule-3 seam.
 *
 * @param input.composerCapabilities - {@link UseComposerCapabilities.composerCapabilities} — the
 *   live discovery-catalog projection.
 * @param input.callAllowlistedTool - {@link ResolveComposerDiscoveryOutcomeDeps.callAllowlistedTool}.
 * @param input.addPluginRef - {@link ResolveComposerDiscoveryOutcomeDeps.addPluginRef}.
 * @returns The memoized `onDiscoverySelect` callback.
 * @example
 * const handleComposerDiscoverySelect = useComposerDiscoverySelect({
 *   composerCapabilities,
 *   callAllowlistedTool: mcpUiToolCaller,
 *   addPluginRef,
 * });
 */
export function useComposerDiscoverySelect(
  { composerCapabilities, callAllowlistedTool, addPluginRef, skillsAvailable, addSkill, readDraft, navigate, resolveRoute, loadSkillDraft }: {
    navigate: ResolveComposerDiscoveryOutcomeDeps["navigate"];
    resolveRoute: ResolveComposerDiscoveryOutcomeDeps["resolveRoute"];
    loadSkillDraft: ResolveComposerDiscoveryOutcomeDeps["loadSkillDraft"];
    composerCapabilities: ComposerCapabilityProjection;
    callAllowlistedTool: ResolveComposerDiscoveryOutcomeDeps["callAllowlistedTool"];
    addPluginRef?: ResolveComposerDiscoveryOutcomeDeps["addPluginRef"];
    skillsAvailable?: boolean;
    addSkill?: ResolveComposerDiscoveryOutcomeDeps["addSkill"];
    readDraft?: ResolveComposerDiscoveryOutcomeDeps["readDraft"];
  },
  _optional: Record<string, never> = {},
): (selection: ComposerDiscoverySelection) => Promise<ComposerDiscoveryOutcome | void> {
  return useCallback(
    (selection: ComposerDiscoverySelection) =>
      resolveComposerDiscoveryOutcome(selection, {
        capabilities: composerCapabilities,
        navigate,
        resolveRoute,
        loadSkillDraft,
        callAllowlistedTool,
        ...(addPluginRef === undefined ? {} : { addPluginRef }),
        ...(skillsAvailable === undefined ? {} : { skillsAvailable }),
        ...(addSkill === undefined ? {} : { addSkill }),
        ...(readDraft === undefined ? {} : { readDraft }),
      }),
    [composerCapabilities, callAllowlistedTool, addPluginRef, skillsAvailable, addSkill, readDraft, navigate, resolveRoute, loadSkillDraft],
  );
}

