/**
 * Windows and their popups can inherit privileged preloads, so only the original trusted
 * page may load in-app. Compare complete parsed origins: a string prefix also admits
 * http://127.0.0.1:4567@evil.example/ and http://127.0.0.1:45670/.
 * Only HTTP(S) links reach the OS, because openExternal dispatches file, smb and custom
 * schemes to whichever application claims them. Malformed URLs fail closed rather than
 * throwing out of a navigation callback, where an exception would not constitute denial.
 * The structural ports keep this boundary testable without importing Electron.
 */
/** Parsed URL boundaries for windows, renderer files and guest popups. Opaque origins fail closed. */
interface WindowOpenDetails {
  url: string;
}

type WindowOpenResponse = { action: "allow" } | { action: "deny" };

interface NavigationEvent {
  preventDefault(): void;
}

interface RedirectEvent extends NavigationEvent {
  url: string;
  isMainFrame: boolean;
}

/** Native WebContents methods keep Electron's positional callback registration ABI. */
interface ElectronNavigableContents {
  setWindowOpenHandler(handler: (details: WindowOpenDetails) => WindowOpenResponse): void;
  on(event: "will-navigate", listener: (event: NavigationEvent, url: string) => void): unknown;
  on(event: "will-redirect", listener: (details: RedirectEvent) => void): unknown;
}

/** Object-shaped registration remains accepted until existing host glue is removed. */
interface LegacyNavigableContents {
  setWindowOpenHandler({ handler }: { handler: (details: WindowOpenDetails) => WindowOpenResponse }): void;
  on({ event, listener }: { event: "will-navigate"; listener: (args: { event: NavigationEvent; url: string }) => void }): unknown;
  on({ event, listener }: { event: "will-redirect"; listener: (details: RedirectEvent) => void }): unknown;
}

type NavigableContents = ElectronNavigableContents | LegacyNavigableContents;
type WindowOpenContents = Pick<ElectronNavigableContents, "setWindowOpenHandler"> | Pick<LegacyNavigableContents, "setWindowOpenHandler">;

function isNativeContents(contents: NavigableContents): contents is ElectronNavigableContents {
  // Electron's EventEmitter takes event + listener; the old registration object takes one arg.
  return contents.on.length !== 1;
}

/** A callable carrying its own handler supports the popup-only legacy surface as well as Electron.
 * No signature cast or Electron dependency is needed; both paths receive the identical callback.
 */
function registerWindowOpen(contents: WindowOpenContents, handler: (details: WindowOpenDetails) => WindowOpenResponse): void {
  contents.setWindowOpenHandler(Object.assign(handler, { handler }));
}

interface AppWindowPolicyOptions {

  appOrigin: string;

  openExternal: (args: { url: string }) => void;
}

/**
 * Opaque origins such as file:, data: and javascript: all serialize as "null".
 * That shared string cannot prove two pages have the same origin.
 */
function parseOrigin(raw: string): string | null {
  let origin;
  try {
    origin = new URL(raw).origin;
  } catch {
    return null;
  }
  return origin === "null" ? null : origin;
}

/** Compare parsed, non-opaque origins; malformed URLs fail closed. @complexity O(n) in URL lengths. */
function isSameOrigin({ candidate, reference }: { candidate: string; reference: string }): boolean {
  const origin = parseOrigin(candidate);
  return origin !== null && origin === parseOrigin(reference);
}

/** Admit only parseable HTTP and HTTPS browser URLs. @complexity O(n) in URL length. */
function isExternalBrowserUrl({ raw }: { raw: string }): boolean {
  let protocol;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    return false;
  }
  return protocol === "http:" || protocol === "https:";
}

/**
 * Pin checks to the window creation origin, never its current location. Server-side 30x
 * redirects do not emit will-navigate, so will-redirect closes that bypass too. Only main
 * frames inherit the window preload; a cross-origin subframe is outside this boundary.
 */
/** Register popup, navigation and main-frame redirect boundaries against the initial app origin. @complexity O(1) registration; O(n) per URL. */
function installAppWindowNavigationPolicy({ contents, ...options }: AppWindowPolicyOptions & { contents: NavigableContents }): void {
  installNavigationBoundary(contents, (url) => isSameOrigin({ candidate: url, reference: options.appOrigin }), options.openExternal);
}

/**
 * A renderer page CSP belongs to that document; replacing it with another local or remote
 * page does not carry the CSP along, but can retain the privileged preload. file: origins
 * are opaque, so this boundary compares the complete renderer URL rather than its origin.
 */
/** Allow only the renderer file itself, ignoring query and fragment. Foreign web URLs open externally. @complexity O(1) registration; O(n) per URL. */
function installRendererNavigationPolicy({ contents, ...options }: { contents: NavigableContents; rendererFileUrl: string; openExternal: (args: { url: string }) => void }): void {
  const renderer = withoutQueryOrHash(options.rendererFileUrl);
  installNavigationBoundary(contents, (url) => renderer !== null && withoutQueryOrHash(url) === renderer, options.openExternal);
}

function installNavigationBoundary(contents: NavigableContents, isInApp: (url: string) => boolean, openExternal: (args: { url: string }) => void): void {
  const handOff = (url: string) => {
    if (isExternalBrowserUrl({ raw: url })) openExternal({ url });
  };

  registerWindowOpen(contents, ({ url }) => {
    if (isInApp(url)) return { action: "allow" };
    handOff(url);
    return { action: "deny" };
  });

  const onNavigate = (event: NavigationEvent, url: string) => {
    if (isInApp(url)) return;
    event.preventDefault();
    handOff(url);
  };

  const onRedirect = (details: RedirectEvent) => {
    if (!details.isMainFrame || isInApp(details.url)) return;
    details.preventDefault();
    handOff(details.url);
  };
  if (isNativeContents(contents)) {
    contents.on("will-navigate", onNavigate);
    contents.on("will-redirect", onRedirect);
  } else {
    contents.on({ event: "will-navigate", listener: ({ event, url }) => onNavigate(event, url) });
    contents.on({ event: "will-redirect", listener: onRedirect });
  }
}

interface GuestWindowOpenOptions {

  // Keep supervised pages separate from other browser links so the host trust decision
  // stays visible; supervised URLs already satisfy the HTTP(S) browser scheme rule.
  isSupervisedGuestUrl: (args: { url: string }) => boolean;

  openExternal: (args: { url: string }) => void;
}

/**
 * There is no second guest in which to open a popup. Forwarding only supervised URLs
 * previously swallowed external sign-in links, so other HTTP(S) links also go to the OS.
 * A thrown handoff can blank the guest window; failure must still return a denial.
 */
/** Deny every in-guest popup; forward permitted browser links through the supplied host port. Failed handoffs still deny. @complexity O(1) registration. */
function installGuestWindowOpenPolicy({ contents, ...options }: GuestWindowOpenOptions & { contents: WindowOpenContents }): void {
  registerWindowOpen(contents, ({ url }) => {
    if (options.isSupervisedGuestUrl({ url }) || isExternalBrowserUrl({ raw: url })) {
      try {
        options.openExternal({ url });
      // A browser handoff failure must not escape the guest callback and blank its window.
      } catch {

      }
    }
    return { action: "deny" };
  });
}

interface ShellPages {

  isSupervisedSite: (args: { url: string }) => boolean;

  
  rendererFileUrl: string;
}

function withoutQueryOrHash(raw: string): string | null {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  url.search = "";
  url.hash = "";
  return url.href;
}

/**
 * This is the sender boundary for privileged host IPC. Exact renderer matching keeps
 * opaque file origins from trusting unrelated local pages; attach URLs use parsed origins.
 * Malformed URL comparisons return false instead of throwing from the sender check.
 */
/** Trust supervised pages, the optional attach origin or the exact renderer file for host IPC. @complexity O(n) in URL length. */
function isShellPageUrl({ raw, pages }: { raw: string; pages: Omit<ShellPages, "attachUrl"> }, { attachUrl }: { attachUrl?: string | undefined } = {}): boolean {
  if (pages.isSupervisedSite({ url: raw })) return true;
  if (attachUrl && isSameOrigin({ candidate: raw, reference: attachUrl })) return true;
  const page = withoutQueryOrHash(raw);
  return page !== null && page === withoutQueryOrHash(pages.rendererFileUrl);
}

export {
  isSameOrigin,
  isExternalBrowserUrl,
  installAppWindowNavigationPolicy,
  installGuestWindowOpenPolicy,
  installRendererNavigationPolicy,
  isShellPageUrl,
};
export type { NavigableContents, ElectronNavigableContents, LegacyNavigableContents, AppWindowPolicyOptions, GuestWindowOpenOptions, WindowOpenResponse, ShellPages };
