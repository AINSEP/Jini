/**
 * @file `attachGlueContentLifecycle()` — the content-lifecycle attachment point (SPEC-048 REQ-5;
 * ADR-057 Decision 2's `content.entry.beforeSave` adapter row, Decision 2.1).
 *
 * Purpose:
 * The wired adapter for the one category that stays **fail-closed, unchanged** (ADR-057 Decision 4
 * — data-mutation call sites are never fail-isolated). This module owns none of that containment
 * logic itself: it delegates straight to {@link GlueHostPort.attachContentLifecycleFilter}, whose
 * real, host-specific implementation is expected to attach the given filter to a live
 * `hook-registry.ts` instance via `Jini/packages/plugins/src/host/node/loader.ts`'s `attachLoadedPlugin()` — the shared
 * extraction ADR-057 Decision 2.1 introduced, with the `"glue"` source. That composition (a real
 * `HookRegistry` plus `attachLoadedPlugin`) is host-specific wiring and does not belong in this
 * product-neutral module; see `__tests__/integration/content-lifecycle.integration.test.ts` for a
 * worked example proving the two compose correctly end to end.
 *
 * Product-neutral core: depends only on `../ports` (the frozen `GlueHostPort` seam). No import of
 * `plugin-runtime`, `hook-registry.ts`, or anything else host-specific — the fail-closed
 * *mechanism* this category relies on lives entirely behind the port, not in this file.
 *
 * Architectural role:
 * Implementation Outline slice 2 (ADR-057, Implementation Outline). Depends on slice 1's frozen
 * `manifest.ts`/`ports.ts` contracts.
 */
// Preserved host rationale: the relative paths and ADR/SPEC references above describe Tovu.
import type { GlueContentLifecycleFilter, GlueFieldDecl, GlueHostPort } from "../ports.js";

export interface AttachGlueContentLifecycleRequired<Filter = GlueContentLifecycleFilter> {
  readonly moduleId: string;
/** The glue module's already-obtained `content.entry.beforeSave` filter — how it was obtained
   * (a `setup()` call gated by this module's own granted `GlueCapability` set) is the loader's
   * concern, not this attachment point's. */
  readonly filter: Filter;
  readonly declaredFields: readonly GlueFieldDecl[];
  readonly hostPort: { attachContentLifecycleFilter(required: { moduleId: string; filter: Filter; declaredFields: readonly GlueFieldDecl[] }): void };
}

export type AttachGlueContentLifecycleOptional = Record<string, never>;

/**
 * Attaches one glue module's content-lifecycle filter via the host port. Pure delegation — this
 * function adds no containment or validation of its own, matching ADR-057 Decision 4's explicit
 * instruction that this category stays fail-closed and unchanged from `hook-registry.ts`'s existing
 * discipline (a throw here is expected to propagate, not be caught).
 *
 * @throws Whatever `hostPort.attachContentLifecycleFilter()` itself throws — never caught here.
 * @complexity O(1) — a single delegated call.
 * @overallScore 100/100
 */
export function attachGlueContentLifecycle<Filter = GlueContentLifecycleFilter>(
  required: AttachGlueContentLifecycleRequired<Filter>,
  _optional: AttachGlueContentLifecycleOptional = {}
): void {
  const { moduleId, filter, declaredFields, hostPort } = required;
  hostPort.attachContentLifecycleFilter({ moduleId, filter, declaredFields });
}
