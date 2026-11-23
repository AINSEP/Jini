// Jini source: ../electron/navigation-policy/window-navigation-policy.ts
/** Bind native Electron contents to Jini while keeping the desktop shell's host callbacks. */
import {
  installAppWindowNavigationPolicy as installAppPolicy,
  installGuestWindowOpenPolicy as installGuestPolicy,
  installRendererNavigationPolicy,
  isSameOrigin as compareOrigins,
  isExternalBrowserUrl as admitExternalUrl,
  isShellPageUrl as admitShellPage,
} from "../electron/navigation-policy/index.js";
import type { WindowOpenResponse } from "../electron/navigation-policy/index.js";

interface NavigableContents {
  setWindowOpenHandler(handler: (details: { url: string }) => WindowOpenResponse): void;
  on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): unknown;
  on(event: "will-redirect", listener: (details: { preventDefault(): void; url: string; isMainFrame: boolean }) => void): unknown;
}
interface AppWindowPolicyOptions {
  appOrigin: string;
  openExternal: (required: { url: string }) => void;
}
interface GuestWindowOpenOptions {
  isSupervisedGuestUrl: (required: { url: string }) => boolean;
  openExternal: (required: { url: string }) => void;
}
interface ShellPages {
  isSupervisedSite: (required: { url: string }) => boolean;
  attachUrl?: string;
  rendererFileUrl: string;
}

/** Opaque or malformed origins fail closed. @complexity O(n) URL lengths. */
function isSameOrigin({ candidate, reference }: { candidate: string; reference: string }, _options = {}): boolean {
  return compareOrigins({ candidate, reference });
}

/** Translate the host's external-link predicate. @complexity O(n) URL length. */
function isExternalBrowserUrl({ raw }: { raw: string }, _options = {}): boolean {
  return admitExternalUrl({ raw });
}

/** Bind the initial site origin and Electron browser handoff. @complexity O(1) registration. */
function installAppWindowNavigationPolicy(
  { contents, options }: { contents: NavigableContents; options: AppWindowPolicyOptions }, _optional = {},
): void {
  installAppPolicy({
    contents,
    appOrigin: options.appOrigin,
    openExternal: options.openExternal,
  });
}

/** Bind the sites-home file to Jini's renderer boundary. @complexity O(1) registration. */
function installSitesHomeNavigationPolicy(
  { contents, options }: { contents: NavigableContents; options: { rendererFileUrl: string; openExternal: (required: { url: string }) => void } },
  _optional = {},
): void {
  installRendererNavigationPolicy({
    contents,
    rendererFileUrl: options.rendererFileUrl,
    openExternal: options.openExternal,
  });
}

/** Adapt the guest's popup-only Electron surface; every popup stays denied. @complexity O(1). */
function installGuestWindowOpenPolicy(contents: Pick<NavigableContents, "setWindowOpenHandler">, options: GuestWindowOpenOptions): void {
  installGuestPolicy({
    contents,
    isSupervisedGuestUrl: options.isSupervisedGuestUrl,
    openExternal: options.openExternal,
  });
}

/** Adapt the host's supervised-site predicate and optional attach-mode origin. @complexity O(n) URL length. */
function isShellPageUrl({ raw, pages }: { raw: string; pages: ShellPages }, _options = {}): boolean {
  return admitShellPage({
    raw,
    pages: {
      isSupervisedSite: pages.isSupervisedSite,
      rendererFileUrl: pages.rendererFileUrl,
    },
  }, { attachUrl: pages.attachUrl });
}

export { isSameOrigin, isExternalBrowserUrl, installAppWindowNavigationPolicy, installGuestWindowOpenPolicy, installSitesHomeNavigationPolicy, isShellPageUrl };
export type { NavigableContents, AppWindowPolicyOptions, GuestWindowOpenOptions, WindowOpenResponse, ShellPages };
