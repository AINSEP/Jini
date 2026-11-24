/**
 * Structural types for Electron's `<webview>` tag as a renderer sees it: the extra fields its
 * events carry and the methods the tag element exposes directly on the DOM node.
 *
 * Declared here rather than imported from `electron`: a host renderer usually must not import the
 * `electron` package at all (type-only imports included), so these carry only the fields renderer
 * code actually reads — narrower than Electron's own `DidFailLoadEvent`/`Result`/`WebviewTag`, but
 * costing nothing a caller needed. They are DOM-free on purpose (this package has no DOM lib and no
 * React): the host combines them with `Event`/`HTMLElement` in its own global/JSX declarations.
 */

/** `did-fail-load`'s extra fields beyond `Event`. */
export interface WebviewDidFailLoadDetail {
  readonly isMainFrame: boolean;
  readonly errorCode: number;
}

/** `did-navigate`'s extra field beyond `Event`. */
export interface WebviewDidNavigateDetail {
  readonly url: string;
}

/** `did-navigate-in-page`'s extra fields beyond `Event`. */
export interface WebviewDidNavigateInPageDetail {
  readonly url: string;
  readonly isMainFrame: boolean;
}

/** Narrowed to the two fields a find-in-page caller reads off Electron's own `Result`. */
export interface WebviewFoundInPageResult {
  readonly activeMatchOrdinal: number;
  readonly matches: number;
}

/** `found-in-page`'s extra field beyond `Event`. */
export interface WebviewFoundInPageDetail {
  readonly result: WebviewFoundInPageResult;
}

/**
 * The `<webview>` element methods a host renderer calls. Electron's `WebviewTag` exposes these on
 * the DOM element itself, so history, reload, find and zoom on a guest need no IPC at all.
 * Every one of these throws until the guest is attached (`dom-ready` has fired); callers catch that.
 */
export interface WebviewTagMethods {
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  /** Keeps the guest's history, which a `key` remount would not. */
  reload(): void;
  reloadIgnoringCache(): void;
  getURL(): string;
  loadURL(url: string, options?: { extraHeaders?: string }): Promise<void>;
  /** Begins (or steps through) a search; the result arrives on the `found-in-page` event,
   *  never as this call's return value in practice. */
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
  /** 0 is 100%. */
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  /** Runs a script in the guest's main frame and resolves its value (e.g. asking a hidden guest
   *  whether it may be released, or restoring a guest's scroll position). */
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}
