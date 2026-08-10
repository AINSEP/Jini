/**
 * The srcDoc bridge plugin seam.
 *
 * The origin project's `runtime/srcdoc.ts` bakes in a fixed set of
 * postMessage bridges directly into its srcDoc builder — deck navigation,
 * comment/inspect element-selection, a CSS tweaks palette, and a manual-edit
 * overlay. Every one of those is product-specific (their protocols
 * reference that product's own comment/inspect/edit UI), so none of the
 * *implementations* are ported here. What's generic and worth keeping is
 * the *seam*: a srcDoc document is built once, and any number of
 * independent scripts get a chance to inject themselves into it before it's
 * handed to the iframe.
 *
 * A host (e.g. a product's own adapter) implements {@link SrcDocBridge}
 * for each bridge it needs and passes them to `buildSrcDoc`'s `bridges`
 * option; this package's own `MANDATORY_BRIDGES` (sandbox shim, focus
 * guard) always run first via `srcdoc/build.ts`, not through this seam,
 * since sandbox/focus safety must not be skippable by a plugin bug.
 */

/** Passed to every bridge's `inject` call; carries whatever per-build context the host wants a bridge to see. */
export interface SrcDocBridgeContext {
  baseHref?: string | undefined;
  [key: string]: unknown;
}

export interface SrcDocBridge {
  /** Stable id, referenced by `UrlLoadDecision.activeBridgeIds` (see `url-load-decision.ts`) to say "this bridge is active, force srcDoc mode". */
  id: string;
  /** Returns `doc` with this bridge's script/style spliced in. Must be a pure string transform — no I/O. */
  inject: (doc: string, ctx: SrcDocBridgeContext) => string;
}

/**
 * Runs every bridge's `inject` over `doc` in order. A bridge whose `inject`
 * throws is skipped (with the original `doc` passed through unchanged) so
 * one broken host-registered bridge can't blank the whole preview.
 */
export function applySrcDocBridges(
  doc: string,
  bridges: readonly SrcDocBridge[],
  ctx: SrcDocBridgeContext = {},
): string {
  return bridges.reduce((current, bridge) => {
    try {
      return bridge.inject(current, ctx);
    } catch {
      return current;
    }
  }, doc);
}
