/**
 * @file The one typed catalog of every plugin hook point (hooks v2 plan §3.1, "one source of
 * truth"). `HOOK_POINTS` is DATA, not a hand-copied vocabulary — core's manifest validator
 * (`VALID_HOOKS`), `tovu hooks list`, `tovu introspect`, and the `/plugin-api` docs page all derive
 * from this one array, so a name typed here is the only place it needs to be typed.
 *
 * A hook enters `HOOK_POINTS` only in the slice that wires its real core call site (§3.1's own
 * rule) — a declared-but-unwired hook is never a deliverable. `content.entry.beforeSave` is the
 * only entry as of this file's introduction (S1): it is the v1 hook, already fully wired
 * (`hook-registry.ts`).
 *
 * `HookSignatures` is the companion TYPE map — one entry per `HOOK_POINTS` name, giving its
 * `kind` and payload shape(s) so `addFilter`/`addAction`/`addContribution` can be generic over
 * `keyof HookSignatures` instead of one hand-written overload per hook. `FilterHookName` /
 * `ActionHookName` / `ContributionHookName` are derived FROM `HookSignatures`, not written by
 * hand, so a hook's `kind` can never drift between the catalog and the type map.
 *
 * Depends on `ContentEntryDraft`/`ExtPatch` from `./index.js` via `import type` only (erased at
 * build — no runtime circular dependency), because `index.ts` re-exports THIS file's `HOOK_POINTS`
 * (a runtime value) in the other direction.
 */
import type { ContentEntryDraft, ExtPatch } from "./fixture-sdk.js";

/** The three shapes a hook point can be (hooks v2 plan §2 "Kinds"). */
export type HookKind = "filter" | "action" | "contribution";

/** One `HOOK_POINTS` entry's shape — capability is a plain string here (not `CapabilityToken`) to
 * avoid a value-level circular import; `index.ts`'s `CapabilityToken` union is the source of truth
 * for which strings are valid, checked at the manifest-validation boundary, not by this type. */
export interface HookPointDescriptor {
  readonly name: string;
  readonly kind: HookKind;
  readonly capability: string;
  readonly since: string;
  readonly description: string;
}

/** SPEC-005's v1 hook, unchanged since 0.1.0 — still the only entry (S1 adds no new wired hook). */
export const HOOK_POINTS = [
  {
    name: "content.entry.beforeSave",
    kind: "filter",
    capability: "hooks.attach",
    since: "0.1.0",
    description: "Runs before a content entry is saved; may write into the plugin's own ext.{pluginId} namespace.",
  },
] as const satisfies readonly HookPointDescriptor[];

/** Every valid hook-point name string, derived from `HOOK_POINTS` — never hand-typed. */
export type HookPointName = (typeof HOOK_POINTS)[number]["name"];

/**
 * One entry per `HOOK_POINTS` name, giving the payload shape(s) `addFilter`/`addAction`/
 * `addContribution` need to be generic over `K extends keyof HookSignatures`. Grows by one entry
 * per hook, in the same slice that adds that hook's own `HOOK_POINTS` row (never ahead of it).
 */
export interface HookSignatures {
  "content.entry.beforeSave": { kind: "filter"; input: ContentEntryDraft; output: ExtPatch };
}

/** Names of every `HookSignatures` entry whose `kind` is `"filter"`. `never` until a hook of that
 * kind exists — deliberately, so a generic `addFilter<K extends FilterHookName>` call site cannot
 * type-check against a name this catalog hasn't wired yet (mirrors `ActionHookName`/
 * `ContributionHookName` below). */
export type FilterHookName = {
  [K in keyof HookSignatures]: HookSignatures[K]["kind"] extends "filter" ? K : never;
}[keyof HookSignatures];

/** Names of every `HookSignatures` entry whose `kind` is `"action"`. `never` until Wave 1's action
 * hooks are cataloged (S4/S5) — see `FilterHookName`'s doc for why that is deliberate. */
export type ActionHookName = {
  [K in keyof HookSignatures]: HookSignatures[K]["kind"] extends "action" ? K : never;
}[keyof HookSignatures];

/** Names of every `HookSignatures` entry whose `kind` is `"contribution"`. `never` until a
 * contribution hook is cataloged (Wave 2, out of this lane's scope) — see `FilterHookName`'s doc. */
export type ContributionHookName = {
  [K in keyof HookSignatures]: HookSignatures[K]["kind"] extends "contribution" ? K : never;
}[keyof HookSignatures];
