/**
 * @file `guest-navigation.ts`: the `<webview>` guest boundary, installed on a fake `webContents`.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import { installWebviewGuestPolicy } from "../guest-navigation.js";
import type { GuestContents } from "../guest-navigation.js";
import type { WindowOpenResponse } from "../../electron/navigation-policy/index.js";

const SITE = "http://127.0.0.1:4567";
const OTHER_SITE = "http://127.0.0.1:4600";
const supervised = new Set([SITE, OTHER_SITE]);
const isSupervisedGuestUrl = ({ url }: { url: string }) => {
  try { return supervised.has(new URL(url).origin); } catch { return false; }
};

/** A guest `webContents` stand-in of the given type, currently showing `current`. */
function fakeGuest(type: string, current = `${SITE}/admin`) {
  let popup: ((details: { url: string }) => WindowOpenResponse) | undefined;
  let navigateListener: ((event: { preventDefault(): void }, url: string) => void) | undefined;
  let redirectListener: ((details: { url: string; isMainFrame: boolean; preventDefault(): void }) => void) | undefined;
  const registered: string[] = [];
  const contents: GuestContents = {
    getType: () => type,
    getURL: () => current,
    setWindowOpenHandler(handler) { registered.push("window-open"); popup = handler; },
    on(event: string, listener: unknown) {
      registered.push(event);
      if (event === "will-navigate") navigateListener = listener as typeof navigateListener;
      if (event === "will-redirect") redirectListener = listener as typeof redirectListener;
      return contents;
    },
  };
  const opened: string[] = [];
  installWebviewGuestPolicy({ contents, isSupervisedGuestUrl, openExternal: ({ url }) => opened.push(url) });
  return {
    registered, opened,
    popup: (url: string) => popup!({ url }), // `!`: only called on a webview, where it is registered.
    /** @returns whether the navigation was prevented. */
    navigate(url: string): boolean {
      let prevented = false;
      navigateListener!({ preventDefault: () => { prevented = true; } }, url); // `!`: registered on a webview.
      return prevented;
    },
    /** @returns whether the redirect was prevented. */
    redirect(url: string, isMainFrame: boolean): boolean {
      let prevented = false;
      redirectListener!({ url, isMainFrame, preventDefault: () => { prevented = true; } }); // `!`: registered on a webview.
      return prevented;
    },
  };
}

test("contents that are not a webview guest get nothing", () => {
  for (const type of ["window", "browserView", "backgroundPage", "remote", ""]) {
    assert.deepEqual(fakeGuest(type).registered, [], type);
  }
});

test("a webview guest gets the popup handler, then will-navigate, then will-redirect", () => {
  assert.deepEqual(fakeGuest("webview").registered, ["window-open", "will-navigate", "will-redirect"]);
});

test("same-origin navigation is left alone — the tab IS that project's admin", () => {
  const guest = fakeGuest("webview");
  assert.equal(guest.navigate(`${SITE}/admin/pages`), false);
  assert.equal(guest.navigate(`${SITE}/login?next=/admin`), false);
  assert.deepEqual(guest.opened, []);
});

test("navigation to another supervised site is denied in the guest and handed to the OS browser", () => {
  const guest = fakeGuest("webview");
  assert.equal(guest.navigate(`${OTHER_SITE}/admin`), true);
  assert.deepEqual(guest.opened, [`${OTHER_SITE}/admin`]);
});

test("navigation anywhere unsupervised is denied and never reaches the OS browser", () => {
  const guest = fakeGuest("webview");
  for (const url of ["https://evil.example/", `${SITE}@evil.example/admin`, "javascript:alert(1)", "not a url", "file:///etc/passwd"]) {
    assert.equal(guest.navigate(url), true, url);
  }
  assert.deepEqual(guest.opened, []);
});

test("the same-origin test reads the guest's CURRENT url, so a guest on another site is judged against it", () => {
  const guest = fakeGuest("webview", `${OTHER_SITE}/admin`);
  assert.equal(guest.navigate(`${OTHER_SITE}/admin/media`), false);
  assert.equal(guest.navigate(`${SITE}/admin`), true);
  assert.deepEqual(guest.opened, [`${SITE}/admin`]);
});

test("a main-frame redirect is allowed only to a supervised site; subframe redirects are left alone", () => {
  const guest = fakeGuest("webview");
  assert.equal(guest.redirect("https://evil.example/", true), true);
  assert.equal(guest.redirect(`${OTHER_SITE}/admin`, true), false);
  assert.equal(guest.redirect(`${SITE}/admin`, true), false);
  assert.equal(guest.redirect("https://evil.example/", false), false);
  assert.deepEqual(guest.opened, [], "a redirect never opens anything");
});

test("every popup is denied in the guest; an ordinary web link and a supervised site go to the OS browser", () => {
  const guest = fakeGuest("webview");
  assert.deepEqual(guest.popup("https://example.com/sign-in"), { action: "deny" });
  assert.deepEqual(guest.popup(`${OTHER_SITE}/admin`), { action: "deny" });
  assert.deepEqual(guest.popup("javascript:alert(1)"), { action: "deny" });
  assert.deepEqual(guest.opened, ["https://example.com/sign-in", `${OTHER_SITE}/admin`]);
});
