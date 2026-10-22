/**
 * The DI seam. Everything in this feature reaches the clipboard or a
 * "global" browser subscription only through these interfaces —
 * `dependencies.ts` is the one file allowed to bind a real implementation.
 *
 * Every other host-specific action (open/rename/delete/upload/get-file-url/
 * download) is deliberately NOT a port here: it's a plain callback prop on
 * the `AssetTreeBrowser` component instead, the same reasoning
 * `features/asset-grid/ports.ts` gives for keeping `onDeleteAsset` a
 * callback prop rather than a port — there's no second real transport a
 * host would ever swap in for "rename this file" or "here's the file's
 * URL", so a port interface would just be ceremony around a single call.
 */

/** Clipboard write, abstracted so the feature's rename/copy-local-path flows stay testable without touching `navigator.clipboard`. */
export interface AssetTreeClipboardPort {
  /** @returns `true` on a successful copy, `false` if every copy strategy failed. */
  copyToClipboard(requiredArgs: { text: string }): Promise<boolean>;
}

/**
 * Small browser-global bridges this feature needs but has no reason to
 * reimplement per host: dismissing the row context menu on an outside
 * click/Escape, listening for a global paste anywhere in the document, and
 * reading the current viewport height for the menu's flip-position math.
 */
export interface AssetTreeDomBridgePort {
  /**
   * Fires `onDismiss` on a pointerdown outside `container.current` (any
   * pointerdown at all when `container` is omitted) or on Escape anywhere;
   * returns an unsubscribe function.
   *
   * Takes `container` (not part of the original type sketch this feature
   * was planned against) so the real binding can use the already-shipped
   * `subscribeOutsideClickOrEscape`'s actual containment check instead of
   * the origin `DesignFilesPanel.tsx`'s cruder "any `mousedown` anywhere
   * closes the menu, and the popover stops its own `mousedown` from
   * bubbling to protect itself" trick (see its `menuPos` effect) — properly
   * scoping "outside" to the popover element is both more correct and
   * matches how this same shared util is already used elsewhere in this
   * package (`ViewportSwitcher`/`BrowserViewportControls`, per
   * `dom-subscriptions.ts`'s own doc comment).
   */
  subscribeOutsideDismiss(container: { current: HTMLElement | null } | undefined, onDismiss: () => void): () => void;
  /** Fires `onFiles` with every file found on a document-wide paste event (already filtered to non-empty, and already ignoring a paste that landed on a text-entry target); returns an unsubscribe function. */
  subscribeGlobalPaste(onFiles: (files: File[]) => void): () => void;
  getViewportHeight(): number;
}

export interface AssetTreeDependencies {
  clipboard: AssetTreeClipboardPort;
  dom: AssetTreeDomBridgePort;
}
