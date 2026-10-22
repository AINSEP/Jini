// Generic "embeddable webview/iframe browser tab" primitive: a navigation
// stack, address-bar normalization, history/favicon utilities, and a
// responsive viewport-preset switcher. A host renders the actual webview or
// iframe and owns navigation/comment/AI-tooling business logic on top of
// this — this feature only owns the address/history/viewport bookkeeping.
//
// Coverage note: this file is `export type`/`export interface` only —
// TypeScript erases it to an empty module (verified via the package's own
// esbuild transform: zero emitted statements), so v8/istanbul coverage has
// no executable line to measure and reports 0/0 as 0% rather than N/A.
// Excluded from the feature's coverage run via `--coverage.exclude` (see
// packages/ui/archived provenance ledger's browser-chrome section) rather than chasing a
// phantom gap.

export type BrowserViewportId = 'desktop' | 'tablet' | 'mobile';

export interface BrowserViewportPreset {
  id: BrowserViewportId;
  /** Plain-English default label. Wrap with useT() at the call site — see the i18n policy. */
  label: string;
  /** Plain-English default tooltip/title text. */
  title: string;
  width: number | null;
  height: number | null;
}

export interface BrowserHistoryEntry {
  iconUrl?: string;
  title: string;
  url: string;
  lastVisitedAt: number;
  visitCount: number;
}

export interface BrowserNavigationEntry {
  title: string;
  url: string;
}

export interface BrowserNavigationState {
  navigationStack: BrowserNavigationEntry[];
  navigationIndex: number;
}

export interface AddressDisplayParts {
  url: string;
  title?: string;
}

/**
 * A host-supplied handle to the live browser surface (webview or iframe),
 * exposed so a host can wire its own bridge (e.g. re-reading the rendered
 * DOM for some external purpose) through `BrowserBridgeRegistrationPort`.
 * Deliberately narrow — only the capabilities every embeddable-browser host
 * plausibly needs, not any one host's specific consumption of them.
 */
export interface BrowserTabHandle {
  isEmbeddedSurfaceAvailable: boolean;
  getURL: () => string;
  executeJavaScript?: (code: string, hasUserGesture?: boolean) => unknown;
}
