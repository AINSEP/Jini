/**
 * A fresh, neutral `postMessage` protocol for deck navigation — deliberately
 * NOT OD's `od:slide`/`od:slide-state` (see `packages/ui/archived provenance ledger`'s
 * `html-viewer` classification: the real bridge's 31 message types across 3
 * naming conventions need a redesign, not a rename). Any sandboxed deck
 * content this feature drives must speak this protocol:
 *   host -> iframe: { type: DECK_NAVIGATE_MESSAGE_TYPE, action, index? }
 *   iframe -> host: { type: DECK_STATE_MESSAGE_TYPE, active, count }
 */
export const DECK_NAVIGATE_MESSAGE_TYPE = 'jini:deck-navigate';
export const DECK_STATE_MESSAGE_TYPE = 'jini:deck-state';

/** Preset zoom percentages, matching the source's own dropdown levels. */
export const DEFAULT_ZOOM_LEVELS = [50, 75, 100, 125, 150, 200] as const;

/** Zoom is expressed as a whole-number percentage; 100 means "actual size." */
export const DEFAULT_ZOOM = 100;
