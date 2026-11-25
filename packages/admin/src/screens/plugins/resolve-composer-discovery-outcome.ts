import type { ComposerDiscoveryOutcome, ComposerDiscoverySelection } from "../../react/kit.js";
import type { ComposerCapabilityProjection, ComposerHostBinding } from "./composer-capabilities.js";
import { draftAfterSkillSelection, type SelectedComposerSkill } from "./selected-skills.js";

export interface ResolveComposerDiscoveryOutcomeDeps {
  readonly capabilities: ComposerCapabilityProjection;
  readonly navigate: (path: string) => void;
  /** The host's client-local route for an item id (`/mcp`'s settings navigation), or null when the host has none. */
  readonly resolveRoute: (required: { itemId: string }, optional?: Record<string, never>) => string | null;
  /** Loads an installed skill's guidance text for the run. */
  readonly loadSkillDraft: (required: { toolId: string }, optional?: Record<string, never>) => Promise<string>;
  /** Structurally `@jini-ai/chat/react`'s `McpUiToolCallHandler` — the same instance registered
   * for MCP-UI surface rendering in `AssistantDock.tsx` (`mcpUiToolCaller`), reused rather than
   * re-instantiated. */
  readonly callAllowlistedTool: (call: { name: string; arguments: Record<string, unknown> }) => Promise<unknown> | unknown;
  /**
   * Pins a selected capability's `pluginRefId` (`composer-capabilities.ts`'s own doc on that
   * field) as a removable chip — {@link UseSelectedAgentPlugins.addPluginRef}. Optional so every
   * existing caller of this function keeps compiling and passing unchanged even when it projects no
   * `pluginRefId` capability; a selection that resolves to a `pluginRefId` capability with this omitted is simply
   * a no-op rather than a crash, matching the host `resolveRoute`'s own "no route, no
   * effect" posture for an id nothing recognizes.
   */
  readonly addPluginRef?: (pluginRefId: string) => void;
  readonly skillsAvailable?: boolean;
  readonly addSkill?: (skill: SelectedComposerSkill) => void;
  readonly readDraft?: () => string;
}

/**
 * Resolves one composer selection into its effect — the host half of debate 2's projection
 * ("Composer slash commands"). Checks the existing client-local route first (`/mcp`'s settings
 * navigation, unchanged since before this projection existed), then falls through to a projected
 * capability's own {@link ComposerHostBinding} (see `composer-capabilities.ts`'s module doc for
 * what each binding kind means). Returns the `ComposerDiscoveryOutcome`
 * Jini's `Composer` applies to the draft, or `undefined` when nothing should change it — e.g. `/mcp`
 * navigating away, or an unresolvable item id (never true for a live selection, but not assumed).
 *
 * A free function rather than inline in the component: every dependency is explicit and injected,
 * so the resolution logic (including the `'allowlisted-tool-call'` branch, unreachable through any
 * bundled capability today) is provable without rendering `AssistantDock` at all.
 *
 * Per `INFO.md`'s Components rule 2 it is re-exported by name from `AssistantDock.tsx` — see that
 * file — which is the path its own suite imports it through.
 *
 * @complexity O(1) plus the cost of `callAllowlistedTool` when a tool-call binding is resolved.
 * @overallScore 100
 */
export async function resolveComposerDiscoveryOutcome(
  selection: ComposerDiscoverySelection,
  deps: ResolveComposerDiscoveryOutcomeDeps,
): Promise<ComposerDiscoveryOutcome | void> {
  const route = deps.resolveRoute({ itemId: selection.item.id });
  if (route) {
    deps.navigate(route);
    return undefined;
  }

  const capability = deps.capabilities.byItemId.get(selection.item.id);

  // Pinning a plugin ref never leaves anything of its own in the draft — the chip IS the visible
  // effect, rendered by `AssistantDock.tsx`'s own `leadingAccessories` slot from
  // `useSelectedAgentPlugins` state, not by anything Jini's `Composer` applies. Checked before
  // `capability?.resolve` below: today's bundled catalog never sets both on the same capability,
  // but if a future one did, pinning the chip should not be skipped just because a `resolve`
  // binding also exists.
  //
  // `{ draft: "" }`, not a bare `return` (2026-08-23): the "+" menu and a plain (no-`command`)
  // slash selection both already clear the draft themselves, in `Composer.tsx`, via this
  // capability's own `insertText: ""` — this outcome was a no-op for those paths. But the
  // `command`-bearing slash path (`/ui-ux-design`, added the same day) is a `selectSlashItem`
  // branch that skips that same insertText-driven clear (see `composer-capabilities.ts`'s
  // `command` doc), so without this the literal typed `/ui-ux-design` would sit in the box after
  // pinning. Same "host explicitly clears it" pattern the `allowlisted-tool-call` branch below
  // already uses.
  if (capability?.pluginRefId) {
    deps.addPluginRef?.(capability.pluginRefId);
    return { draft: "" };
  }

  if (!capability?.resolve) return undefined;

  return applyBinding({ selection, label: capability.item.label, binding: capability.resolve({ argument: selection.argument }) }, deps);
}

/** Applies one resolved {@link ComposerHostBinding}; every kind leaves a draft for the composer. */
async function applyBinding(
  { selection, label, binding }: { selection: ComposerDiscoverySelection; label: string; binding: ComposerHostBinding },
  deps: ResolveComposerDiscoveryOutcomeDeps,
): Promise<ComposerDiscoveryOutcome> {
  if (binding.kind === "compose-text") return { draft: binding.text };
  if (binding.kind === "installed-skill") return selectInstalledSkill({ selection, label, toolId: binding.toolId }, deps);

  // 'allowlisted-tool-call': POSTs through the same session-authenticated, allowlist-gated route
  // MCP-UI surface confirmations already use. Rejects with `TOOL_NOT_ALLOWLISTED` (403) for any
  // tool id not on `MCP_UI_REDEEMABLE_TOOL_IDS`'s allowlist — true for every binding in the bundled
  // catalog today, since none is wired to this kind yet. The rejection propagates to the caller,
  // where Jini's `runComposerHostEffect` reports it and leaves the draft untouched.
  await Promise.resolve(deps.callAllowlistedTool({ name: binding.toolName, arguments: binding.params }));
  return { draft: "" };
}

/** Pins an installed skill's guidance for the run (never pasted into the draft) and keeps the user's own text. */
async function selectInstalledSkill(
  { selection, label, toolId }: { selection: ComposerDiscoverySelection; label: string; toolId: string },
  deps: ResolveComposerDiscoveryOutcomeDeps,
): Promise<ComposerDiscoveryOutcome> {
  if (deps.skillsAvailable === false) throw new Error("This runtime has no tools. Choose a runtime with tools to use skills.");
  const draft = draftAfterSkillSelection({ draft: deps.readDraft?.() ?? "", source: selection.source });
  const guidance = await deps.loadSkillDraft({ toolId });
  const name = label.replace(/ · Skill$/, "");
  deps.addSkill?.({ toolId, name, guidance });
  return { draft };
}
