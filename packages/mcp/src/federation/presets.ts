import type { ResolvedFederatedConnection } from "./config.js";

/**
 * @file The core-owned, plugin-populated registry of federated MCP presets — the seam that lets a
 * concrete vendor integration live OUTSIDE `src/assistant/` while still being part of the default
 * boot.
 *
 * Why a registry rather than `bootstrap.ts` calling each preset by name: before 2026-07-30
 * `bootstrap.ts` imported `resolveSupabaseMcpConnection` directly, which made "add a second vendor"
 * an edit to core federation code and made core federation import a specific vendor's module. Both
 * are the wrong direction. With this file the dependency points the other way — a preset imports
 * core and announces itself; core never learns any vendor's name.
 *
 * The shape is the one this codebase already uses for exactly this problem: a module-level ordered
 * list plus a typed `register*` function, a `reset*ForTests`, and a fold/resolve function —
 * `page-head.ts`'s `registerPageHeadContributor`/`foldPageHead` and `routing.ts`'s
 * `registerResolvePhase`/`registerNamedRoute`. Per §3, hooks and registries are
 * exempt from the rule-of-two, so this is deliberately NOT a port with two adapters.
 *
 * This is NOT the plugin runtime. That mechanism exists to load sandboxed third-party code
 * at runtime; this one wires a first-party module that ships in the repo and is imported by a
 * composition root at boot. A preset here is ordinary reviewed code in this repository — the seam
 * buys module-boundary honesty, not isolation.
 *
 * Architectural role:
 * In-module registry. No I/O; resolution is delegated to whatever a preset registered.
 * See docs/decisions/DR-003-trusted-federation-composition.md.
 */

/**
 * A preset's resolver: read the operator's environment and either produce a connection or decline.
 *
 * `null` means "the operator has not configured this one", and is the expected, silent, overwhelming
 * majority case — federation is off unless a site owner turns it on. THROWING means "the operator
 * asked for this connection and got the settings wrong", which is an error worth surfacing; a preset
 * must never paper over a half-configured connection by returning a broader one. `bootstrap.ts`
 * isolates and logs a throw per preset so one vendor's typo cannot disable another's working
 * connection.
 */
export type FederatedMcpPresetResolver = (required: { env: NodeJS.ProcessEnv }) => ResolvedFederatedConnection | null;

export interface FederatedMcpPreset {
  /** Stable identity of the PRESET MODULE (not of the connection it resolves). Used to keep a
   * double import from registering the same vendor twice; see {@link registerFederatedMcpPreset}. */
  readonly presetId: string;
  readonly resolve: FederatedMcpPresetResolver;
}

let presets: FederatedMcpPreset[] = [];

/**
 * Registers a preset, called once at composition-root boot by the preset's own module.
 *
 * Re-registering the same `presetId` REPLACES the earlier entry rather than appending. Unlike a
 * `<head>` contributor, a duplicate here would resolve to two connections with the same
 * `connectionId`, and `trust.ts` R1's collision assertion would then drop the second one whole —
 * producing a confusing "registered, then refused for shadowing itself" log for what is really just
 * a module imported from two places. Last registration wins, and registration order is otherwise
 * preserved so a replacement does not silently reorder connections.
 */
export function registerFederatedMcpPreset({ preset }: { preset: FederatedMcpPreset }): void {
  const existing = presets.findIndex((candidate) => candidate.presetId === preset.presetId);
  if (existing >= 0) {
    presets[existing] = preset;
    return;
  }
  presets.push(preset);
}

/** Registration order. `bootstrap.ts` resolves in this order, and that order decides which
 * connection claims a contested tool id first (R1). */
export function listFederatedMcpPresets(): readonly FederatedMcpPreset[] {
  return presets;
}

/** Test-only reset of the module-level registry (mirrors `page-head.ts`'s
 * `resetPageHeadRegistry`, though that one is no longer test-only — see its own doc). */
export function resetFederatedMcpPresetsForTests(_required: Record<string, never>): void {
  presets = [];
}
