import { useCallback, useMemo, useState } from "react";

import { type ComposerCapabilityProjection } from "../../../../screens/plugins/composer-capabilities.js";
import type { SelectedAgentPluginChip } from "../SelectedAgentPluginTray.js";

export interface UseSelectedAgentPlugins {
  /** Every currently-pinned Agent Plugin ref, in pin order — see {@link addPluginRef}. */
  readonly selectedPluginRefIds: readonly string[];
  /**
   * Pins one plugin ref as a removable chip. Deduplicated by id: pinning an already-pinned ref is
   * a no-op (selecting the same composer row twice must not produce two chips), matching the
   * de-dup posture `composer.attachments` gets for free from `@jini-ai/chat`'s own upload batching.
   */
  readonly addPluginRef: (pluginRefId: string) => void;
  /** Unpins one plugin ref — the chip's own remove-button handler. Removing an id that is not
   *  currently pinned is also a no-op. */
  readonly removePluginRef: (pluginRefId: string) => void;
}

/**
 * Owns which Agent Plugins the operator has pinned onto the composer as removable chips
 * (`composer-capabilities.ts`'s `pluginRefId` field, resolved into this state by
 * `resolveComposerDiscoveryOutcome`'s `addPluginRef` dep). Host-owned state, not part of
 * `@jini-ai/chat`'s own `useComposer()` attachment tray: a pinned plugin ref is a host concept the
 * package does not know about, the same "package owns mechanism, host owns taxonomy" boundary
 * `composer-capabilities.ts`'s module doc states for `kind`.
 *
 * Deliberately NOT cleared on send, unlike `composer.attachments` (which `useChatPane`'s own
 * `composer.reset()` clears every turn): a pinned plugin stays in front of the agent for every
 * later turn in the same conversation until the operator removes its chip. There is no send-time
 * hook this dock can observe to clear it automatically either — `ChatPane`'s `runContext` prop is
 * called and its result captured BEFORE `composer.reset()` runs (`useChatPane.hooks.ts`'s
 * `sendPrompt`), and `onDiscoverySelect` only fires on a discovery selection, never on send — so
 * "clear after the turn that used it" was never a reachable design without a new seam Jini does
 * not expose today. Sticky-until-removed is the simplest behavior consistent with what IS
 * reachable, and matches a plain reading of "pin a plugin, use it for a while, then remove it."
 *
 * @returns `selectedPluginRefIds` (for rendering the chip tray and feeding `useRunContext`) plus
 *   `addPluginRef`/`removePluginRef` (the chip tray's add/remove handlers).
 * @example
 * const { selectedPluginRefIds, addPluginRef, removePluginRef } = useSelectedAgentPlugins();
 */
export function useSelectedAgentPlugins(): UseSelectedAgentPlugins {
  const [selectedPluginRefIds, setSelectedPluginRefIds] = useState<readonly string[]>([]);

  const addPluginRef = useCallback((pluginRefId: string) => {
    setSelectedPluginRefIds((previous) =>
      previous.includes(pluginRefId) ? previous : [...previous, pluginRefId],
    );
  }, []);

  const removePluginRef = useCallback((pluginRefId: string) => {
    setSelectedPluginRefIds((previous) => previous.filter((id) => id !== pluginRefId));
  }, []);

  return { selectedPluginRefIds, addPluginRef, removePluginRef };
}

/**
 * The composer's pinned-Agent-Plugin chips — `selectedPluginRefIds` (see
 * {@link useSelectedAgentPlugins}) projected through `composerCapabilities.byPluginRefId` into the
 * `{ pluginRefId, label }` pairs `SelectedAgentPluginTray` renders.
 *
 * Chip labels come from the projection itself, not a second hardcoded copy — the same row a pinned
 * ref came FROM is the one place its display label is authored
 * (`composer-capabilities.ts`'s bundled catalog). Falls back to the bare id only if the projection
 * has not resolved yet or no longer carries a matching capability (e.g. a stale chip from a catalog
 * that changed shape underneath it) — better than dropping the chip and silently losing track of a
 * ref that will still be sent.
 *
 * @complexity Time/space: O(selectedPluginRefIds.length) per recompute — one `Map.get` per pinned id.
 */
export function useSelectedPluginChips(
  selectedPluginRefIds: readonly string[],
  composerCapabilities: ComposerCapabilityProjection,
): readonly SelectedAgentPluginChip[] {
  return useMemo(
    () =>
      selectedPluginRefIds.map((pluginRefId) => ({
        pluginRefId,
        label: composerCapabilities.byPluginRefId.get(pluginRefId)?.item.label ?? pluginRefId,
      })),
    [selectedPluginRefIds, composerCapabilities],
  );
}

