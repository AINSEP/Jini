/**
 * Deck/slide-navigation + zoom + present slice of the classified `HtmlViewer`
 * god-component — see `packages/ui/source-map.md`'s `html-viewer`
 * classification section for the full disposition. This slice ships only
 * the pieces that classification found GENERIC with low coupling to the
 * rest of `HtmlViewer` (deck navigation, the zoom-percentage control, and
 * the three present actions); the sandboxed-iframe/annotation/manual-edit
 * pieces stay deferred pending the `@jini-ai/renderers-react` core this slice
 * itself is the first consumer of.
 */

/** What the sandboxed iframe reports back after every slide navigation. */
export interface DeckSlideState {
  /** Zero-based index of the currently active slide. */
  active: number;
  /** Total number of slides. */
  count: number;
}

/** The navigation actions the host can request of a deck-aware sandboxed iframe. */
export type DeckNavigateAction = 'next' | 'prev' | 'first' | 'last' | 'go';
