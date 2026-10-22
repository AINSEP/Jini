
import { test } from "vitest";

import assert from "node:assert/strict";


import {
  installAppWindowNavigationPolicy,
  installGuestWindowOpenPolicy,
  installRendererNavigationPolicy,
  isExternalBrowserUrl,
  isSameOrigin,
  isShellPageUrl,
} from "../electron/navigation-policy/index.js";

import type { LegacyNavigableContents as NavigableContents, WindowOpenResponse } from "../electron/navigation-policy/index.js";


const APP_ORIGIN = "http://127.0.0.1:4567";



function installOnFake(
  install: (contents: NavigableContents, openExternal: (url: string) => void) => void = (contents, openExternal) =>
    installAppWindowNavigationPolicy({ contents, ...{ appOrigin: APP_ORIGIN, openExternal: ({ url }) => openExternal(url) } }),
) {
  let openHandler: ((details: { url: string }) => WindowOpenResponse) | undefined;
  let navigateListener: ((args: { event: { preventDefault(): void }; url: string }) => void) | undefined;
  let redirectListener: ((details: { url: string; isMainFrame: boolean; preventDefault(): void }) => void) | undefined;
  const opened: string[] = [];
  const contents: NavigableContents = {
    setWindowOpenHandler({ handler }) {
      openHandler = handler;
    },
    on({ event, listener }) {
      if (event === "will-navigate") navigateListener = listener as typeof navigateListener;
      if (event === "will-redirect") redirectListener = listener as typeof redirectListener;
      return contents;
    },
  };
  install(contents, (url) => opened.push(url));

  return {
    opened,
    windowOpen(url: string): WindowOpenResponse {
      assert.ok(openHandler, "expected a window-open handler to be registered");
      return openHandler({ url });
    },
    
    navigate(url: string): boolean {
      assert.ok(navigateListener, "expected a will-navigate listener to be registered");
      let prevented = false;
      navigateListener({ event: { preventDefault: () => (prevented = true) }, url });
      return prevented;
    },
    
    redirect(url: string, isMainFrame: boolean): boolean {
      assert.ok(redirectListener, "expected a will-redirect listener to be registered");
      let prevented = false;
      redirectListener({ url, isMainFrame, preventDefault: () => (prevented = true) });
      return prevented;
    },
  };
}


test("a popup whose URL only STARTS WITH the app origin is denied — userinfo is not the host", () => {
  const fake = installOnFake();
  assert.deepEqual(fake.windowOpen("http://127.0.0.1:4567@evil.example/admin"), { action: "deny" });
});


test("a popup to the same host on a different port is denied", () => {
  const fake = installOnFake();
  assert.deepEqual(fake.windowOpen("http://127.0.0.1:4568/admin"), { action: "deny" });
  assert.deepEqual(fake.windowOpen("http://127.0.0.1:45670/admin"), { action: "deny" });
});


test("a popup to the same host and port over a different scheme is denied", () => {
  const fake = installOnFake();
  assert.deepEqual(fake.windowOpen("https://127.0.0.1:4567/admin"), { action: "deny" });
});


test("a same-origin popup is still allowed in the app, and nothing is handed to the OS", () => {
  const fake = installOnFake();
  assert.deepEqual(fake.windowOpen("http://127.0.0.1:4567/admin/pages?tab=drafts#top"), { action: "allow" });
  assert.deepEqual(fake.windowOpen("http://127.0.0.1:4567/"), { action: "allow" });
  assert.deepEqual(fake.opened, []);
});


test("a denied http(s) popup is handed to the OS browser, exactly as requested", () => {
  const fake = installOnFake();
  assert.deepEqual(fake.windowOpen("https://example.com/view?x=1"), { action: "deny" });
  assert.deepEqual(fake.windowOpen("http://127.0.0.1:4567@evil.example/admin"), { action: "deny" });
  assert.deepEqual(fake.opened, ["https://example.com/view?x=1", "http://127.0.0.1:4567@evil.example/admin"]);
});


test("a popup with any non-http(s) scheme is denied and never reaches shell.openExternal", () => {
  const fake = installOnFake();
  const refused = [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "smb://evil.example/share",
    "vscode://file/etc/passwd",
    "ms-msdt:/id",
    "not a url",
    "",
  ];
  for (const url of refused) {
    assert.deepEqual(fake.windowOpen(url), { action: "deny" }, url);
  }
  assert.deepEqual(fake.opened, []);
});


test("in-window navigation to another origin is prevented and handed to the OS browser", () => {
  const fake = installOnFake();
  assert.equal(fake.navigate("http://127.0.0.1:4567@evil.example/admin"), true);
  assert.equal(fake.navigate("http://127.0.0.1:4568/admin"), true);
  assert.equal(fake.navigate("https://example.com/"), true);
  assert.deepEqual(fake.opened, ["http://127.0.0.1:4567@evil.example/admin", "http://127.0.0.1:4568/admin", "https://example.com/"]);
});


test("in-window navigation to a non-http(s) scheme is prevented and never reaches shell.openExternal", () => {
  const fake = installOnFake();
  assert.equal(fake.navigate("javascript:alert(1)"), true);
  assert.equal(fake.navigate("file:///etc/passwd"), true);
  assert.equal(fake.navigate("smb://evil.example/share"), true);
  assert.equal(fake.navigate("not a url"), true);
  assert.deepEqual(fake.opened, []);
});


test("in-window same-origin navigation is left alone — the admin has to keep working", () => {
  const fake = installOnFake();
  assert.equal(fake.navigate("http://127.0.0.1:4567/admin/login?next=%2Fadmin%2F"), false);
  assert.equal(fake.navigate("http://127.0.0.1:4567/"), false);
  assert.deepEqual(fake.opened, []);
});


test("a main-frame server redirect to another origin is prevented and handed to the OS browser", () => {



  const fake = installOnFake();
  assert.equal(fake.redirect("https://partner.example/landing", true), true);
  assert.equal(fake.redirect("http://127.0.0.1:4567@evil.example/admin", true), true);
  assert.equal(fake.redirect("smb://evil.example/share", true), true);
  assert.deepEqual(fake.opened, ["https://partner.example/landing", "http://127.0.0.1:4567@evil.example/admin"]);
});


test("a same-origin main-frame redirect, and any subframe redirect, is left alone", () => {


  const fake = installOnFake();
  assert.equal(fake.redirect("http://127.0.0.1:4567/admin/login", true), false);
  assert.equal(fake.redirect("https://video.example/embed/123", false), false);
  assert.deepEqual(fake.opened, []);
});


test("isSameOrigin compares parsed origins, and an opaque or unparseable origin never matches", () => {
  assert.equal(isSameOrigin({ candidate: "http://127.0.0.1:4567/admin", reference: "http://127.0.0.1:4567" }), true);
  assert.equal(isSameOrigin({ candidate: "http://127.0.0.1:4567/admin", reference: "http://127.0.0.1:4567/other/" }), true);
  assert.equal(isSameOrigin({ candidate: "http://127.0.0.1:4567@evil.example/", reference: "http://127.0.0.1:4567" }), false);
  assert.equal(isSameOrigin({ candidate: "http://127.0.0.1:45670/", reference: "http://127.0.0.1:4567" }), false);

  assert.equal(isSameOrigin({ candidate: "file:///a", reference: "file:///b" }), false);
  assert.equal(isSameOrigin({ candidate: "data:text/html,a", reference: "data:text/html,a" }), false);
  assert.equal(isSameOrigin({ candidate: "", reference: "" }), false);
  assert.equal(isSameOrigin({ candidate: "not a url", reference: "not a url" }), false);
});


test("isExternalBrowserUrl admits only parseable http and https URLs", () => {
  assert.equal(isExternalBrowserUrl({ raw: "https://example.com/" }), true);
  assert.equal(isExternalBrowserUrl({ raw: "http://127.0.0.1:4567/" }), true);
  assert.equal(isExternalBrowserUrl({ raw: "javascript:alert(1)" }), false);
  assert.equal(isExternalBrowserUrl({ raw: "file:///etc/passwd" }), false);
  assert.equal(isExternalBrowserUrl({ raw: "mailto:a@example.com" }), false);
  assert.equal(isExternalBrowserUrl({ raw: "not a url" }), false);
});



function installGuestPopupOnFake(isSupervisedGuestUrl: (url: string) => boolean) {
  let openHandler: ((details: { url: string }) => WindowOpenResponse) | undefined;
  const opened: string[] = [];
  const contents: Pick<NavigableContents, "setWindowOpenHandler"> = {
    setWindowOpenHandler({ handler }) {
      openHandler = handler;
    },
  };
  installGuestWindowOpenPolicy({ contents, ...{ isSupervisedGuestUrl: ({ url }) => isSupervisedGuestUrl(url), openExternal: ({ url }) => opened.push(url) } });
  return {
    opened,
    windowOpen(url: string): WindowOpenResponse {
      assert.ok(openHandler, "expected a window-open handler to be registered");
      return openHandler({ url });
    },
  };
}


test("guest popup: an ordinary https(s) link is denied in-app and handed to the OS browser", () => {




  const fake = installGuestPopupOnFake(() => false); // no site this launch supervises matches
  assert.deepEqual(fake.windowOpen("https://example.com/sign-in?token=abc"), { action: "deny" });
  assert.deepEqual(fake.windowOpen("http://example.com/x"), { action: "deny" });
  assert.deepEqual(fake.opened, ["https://example.com/sign-in?token=abc", "http://example.com/x"]);
});


test("guest popup: a supervised site's own url is still handed to the OS browser", () => {
  const fake = installGuestPopupOnFake((url) => url.startsWith("http://127.0.0.1:4567/"));
  assert.deepEqual(fake.windowOpen("http://127.0.0.1:4567/admin/pages"), { action: "deny" });
  assert.deepEqual(fake.opened, ["http://127.0.0.1:4567/admin/pages"]);
});


test("guest popup: a non-http(s) scheme is denied and never reaches shell.openExternal", () => {
  const fake = installGuestPopupOnFake(() => false);
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "not a url", ""]) {
    assert.deepEqual(fake.windowOpen(url), { action: "deny" }, url);
  }
  assert.deepEqual(fake.opened, []);
});


test("guest popup: a throwing openExternal never escapes the handler — a guest callback throw blanks the window", () => {
  const contents: Pick<NavigableContents, "setWindowOpenHandler"> = {
    setWindowOpenHandler({ handler }) {
      assert.deepEqual(
        handler({ url: "https://example.com/" }),
        { action: "deny" },
        "the handler must still return deny even when openExternal throws",
      );
    },
  };
  installGuestWindowOpenPolicy({ contents, ...{
    isSupervisedGuestUrl: () => false,
    openExternal: () => {
      throw new Error("boom");
    },
  } });
});


test('guest popup registration uses the supplied web contents port exactly once', () => {
  let registrations = 0;
  let popup!: (details: { url: string }) => WindowOpenResponse;
  const opened: string[] = [];
  const contents: Pick<NavigableContents, 'setWindowOpenHandler'> = {
    setWindowOpenHandler({ handler }) { registrations += 1; popup = handler; },
  };
  installGuestWindowOpenPolicy({
    contents,
    isSupervisedGuestUrl: () => false,
    openExternal: ({ url }) => opened.push(url),
  });
  assert.equal(registrations, 1);
  assert.deepEqual(popup({ url: 'https://sign-in.example/' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://sign-in.example/']);
});

test('window navigation retains its initial origin after denying a foreign navigation', () => {
  const fake = installOnFake();
  assert.equal(fake.navigate('https://foreign.example/'), true);
  assert.equal(fake.navigate(`${APP_ORIGIN}/admin`), false);
  assert.equal(fake.navigate('https://foreign.example/again'), true);
  assert.deepEqual(fake.opened, ['https://foreign.example/', 'https://foreign.example/again']);
});

test('an opaque initial origin cannot admit a main-frame redirect by matching null origins', () => {
  const fake = installOnFake((contents, openExternal) => installAppWindowNavigationPolicy({ contents, appOrigin: 'file:///initial.html', openExternal: ({ url }) => openExternal(url) }));
  assert.equal(fake.redirect('file:///foreign.html', true), true);
  assert.equal(fake.redirect('https://external.example/', true), true);
  assert.equal(fake.redirect('https://external.example/', false), false);
  assert.deepEqual(fake.opened, ['https://external.example/']);
});

const RENDERER = "file:///Applications/Sample.app/Contents/Resources/app/dist/renderer/index.html";

const pages = (overrides: { attachUrl?: string } = {}) => ({
  isSupervisedSite: ({ url }: { url: string }) => url.startsWith("http://127.0.0.1:4567/"), // the fake's own shortcut; the real one is isSupervisedGuestUrl
  rendererFileUrl: RENDERER,
  ...overrides,
});


test("isShellPageUrl admits a supervised site's pages", () => {
  assert.equal(isShellPageUrl({ raw: "http://127.0.0.1:4567/admin/", pages: pages() }, { attachUrl: pages().attachUrl }), true);
  assert.equal(isShellPageUrl({ raw: "http://127.0.0.1:4568/admin/", pages: pages() }, { attachUrl: pages().attachUrl }), false);
});


test("isShellPageUrl admits attach mode's origin by parsed origin, and nothing when there is no attach url", () => {
  const attach = pages({ attachUrl: "http://localhost:5173" });
  assert.equal(isShellPageUrl({ raw: "http://localhost:5173/admin/pages", pages: attach }, { attachUrl: attach.attachUrl }), true);
  assert.equal(isShellPageUrl({ raw: "http://localhost:5173@evil.example/admin/", pages: attach }, { attachUrl: attach.attachUrl }), false);
  assert.equal(isShellPageUrl({ raw: "http://localhost:51730/admin/", pages: attach }, { attachUrl: attach.attachUrl }), false);
  assert.equal(isShellPageUrl({ raw: "http://localhost:5173/admin/", pages: pages() }, { attachUrl: pages().attachUrl }), false);
  assert.equal(isShellPageUrl({ raw: "http://localhost:5173/admin/", pages: pages({ attachUrl: "" }) }, { attachUrl: pages({ attachUrl: "" }).attachUrl }), false);
});


test("isShellPageUrl admits the sites home renderer's own file, whatever its hash or query, and no other file", () => {
  assert.equal(isShellPageUrl({ raw: RENDERER, pages: pages() }, { attachUrl: pages().attachUrl }), true);
  assert.equal(isShellPageUrl({ raw: `${RENDERER}#/projects`, pages: pages() }, { attachUrl: pages().attachUrl }), true);
  assert.equal(isShellPageUrl({ raw: `${RENDERER}?tab=1`, pages: pages() }, { attachUrl: pages().attachUrl }), true);
  assert.equal(isShellPageUrl({ raw: "file:///tmp/index.html", pages: pages() }, { attachUrl: pages().attachUrl }), false);
  assert.equal(isShellPageUrl({ raw: "file://evil-host/Applications/Sample.app/Contents/Resources/app/dist/renderer/index.html", pages: pages() }, { attachUrl: pages().attachUrl }), false);
});


test("isShellPageUrl refuses foreign pages and garbage without throwing", () => {
  for (const raw of ["https://evil.example/admin/", "javascript:alert(1)", "data:text/html,x", "about:blank", "", "not a url"]) {
    assert.equal(isShellPageUrl({ raw, pages: pages({ attachUrl: "http://localhost:5173" }) }, { attachUrl: pages({ attachUrl: "http://localhost:5173" }).attachUrl }), false, raw);
  }
});





const installSitesHome = (contents: NavigableContents, openExternal: (url: string) => void) =>
  installRendererNavigationPolicy({ contents, ...{ rendererFileUrl: RENDERER, openExternal: ({ url }) => openExternal(url) } });


test("sites home: navigating the window to a remote page is prevented and handed to the OS browser", () => {
  const fake = installOnFake(installSitesHome);
  assert.equal(fake.navigate("https://evil.example/"), true);
  assert.equal(fake.navigate("http://127.0.0.1:4567/admin/"), true);
  assert.deepEqual(fake.opened, ["https://evil.example/", "http://127.0.0.1:4567/admin/"]);
});


test("sites home: navigating to any other file, or a non-http(s) scheme, is prevented and never reaches the OS", () => {
  const fake = installOnFake(installSitesHome);
  assert.equal(fake.navigate("file:///Users/someone/Downloads/dropped.html"), true);
  assert.equal(fake.navigate("file://evil-host/Applications/Sample.app/Contents/Resources/app/dist/renderer/index.html"), true);
  assert.equal(fake.navigate("javascript:alert(1)"), true);
  assert.equal(fake.navigate("data:text/html,<script>sampleRunner</script>"), true);
  assert.deepEqual(fake.opened, []);
});


test("sites home: the renderer's own file still loads, whatever its hash or query", () => {
  const fake = installOnFake(installSitesHome);
  assert.equal(fake.navigate(RENDERER), false);
  assert.equal(fake.navigate(`${RENDERER}#/projects`), false);
  assert.deepEqual(fake.opened, []);
});


test("sites home: a remote popup is denied and handed to the OS browser; a main-frame redirect off the renderer is prevented", () => {
  const fake = installOnFake(installSitesHome);
  assert.deepEqual(fake.windowOpen("https://evil.example/"), { action: "deny" });
  assert.deepEqual(fake.opened, ["https://evil.example/"]);
  assert.equal(fake.redirect("https://evil.example/", true), true);
});
