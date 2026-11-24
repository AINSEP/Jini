/**
 * @file Wire shape of one find-in-page result, shared by the desktop main process (which relays
 * Chromium's `found-in-page` event) and the renderer find bar (which renders the counter). One
 * neutral owner here so the two sides cannot drift.
 */

/** Electron reports activeMatchOrdinal as 1-based and matches as the total count, including
 * zero when nothing matched; consumers must preserve those display semantics. */
export interface FindInPageResult {
  readonly activeMatchOrdinal: number;
  readonly matches: number;
}
