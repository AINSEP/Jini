/**
 * @file `windows/app-window.ts`: the standalone app window, built through a fake `BrowserWindow`
 * factory and a recording navigation-policy installer.
 */
import { describe, expect, it } from "vitest";

import { appWindowOptions, createAppWindow, type AppWindow, type AppWindowOptions } from "../index.js";

const APP = "http://127.0.0.1:4567";

interface FakeContents { id: string }

/** A window fake that records every step in `log`, in order, plus the title listener. */
function fakeWindowFactory() {
  const log: string[] = [];
  const created: AppWindowOptions[] = [];
  const policies: Array<{ contents: FakeContents; appOrigin: string }> = [];
  let titleUpdated: ((event: { preventDefault(): void }) => void) | undefined;
  const window: AppWindow<FakeContents> = {
    webContents: { id: "contents" },
    on(event, listener) {
      log.push(event);
      titleUpdated = listener;
      return undefined;
    },
    async loadURL(url) {
      log.push(`load ${url}`);
    },
  };
  const ports = {
    createBrowserWindow: (options: AppWindowOptions) => { created.push(options); log.push("create"); return window; },
    installNavigationPolicy: (policy: { contents: FakeContents; appOrigin: string }) => { policies.push(policy); log.push("policy"); },
  };
  return {
    log, created, policies, window, ports,
    /** @returns whether the title update was prevented. */
    updateTitle(): boolean {
      let prevented = false;
      titleUpdated!({ preventDefault: () => { prevented = true; } }); // `!`: registered by createAppWindow.
      return prevented;
    },
  };
}

describe("appWindowOptions", () => {
  it("is 1360x900 with a 1024x700 floor, sandboxed, with the injected preload and title", () => {
    expect(appWindowOptions({ preloadPath: "/preload.cjs", title: "Host" })).toEqual({
      width: 1360, height: 900, minWidth: 1024, minHeight: 700, title: "Host", show: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: "/preload.cjs" },
    });
  });

  it("applies a site's partition; a self-test window stays hidden", () => {
    const options = appWindowOptions({ preloadPath: "/p", title: "My Site" }, { partition: "persist:site-a", selftest: true });
    expect(options.title).toBe("My Site");
    expect(options.show).toBe(false);
    expect(options.webPreferences.partition).toBe("persist:site-a");
  });

  it("leaves out the partition key entirely when there is none (default session)", () => {
    for (const partition of [undefined, ""]) {
      expect("partition" in appWindowOptions({ preloadPath: "/p", title: "T" }, { partition }).webPreferences).toBe(false);
    }
  });
});

describe("createAppWindow", () => {
  it("runs create, track, pin title, install the boundary, then load", () => {
    const fake = fakeWindowFactory();
    const tracked: unknown[] = [];
    const window = createAppWindow(
      { url: `${APP}/admin`, title: "Site A", preloadPath: "/preload.cjs", ports: fake.ports },
      { partition: "persist:a", trackWindow: (w) => { tracked.push(w); fake.log.push("track"); } },
    );
    expect(window).toBe(fake.window);
    expect(tracked).toEqual([fake.window]);
    expect(fake.log).toEqual(["create", "track", "page-title-updated", "policy", `load ${APP}/admin`]);
    expect(fake.created[0]).toMatchObject({ title: "Site A", show: true, webPreferences: { partition: "persist:a", preload: "/preload.cjs" } });
  });

  it("opens and loads without a tracker; a self-test window is hidden", () => {
    const fake = fakeWindowFactory();
    createAppWindow({ url: `${APP}/admin`, title: "T", preloadPath: "/p", ports: fake.ports }, { selftest: true });
    expect(fake.log).toEqual(["create", "page-title-updated", "policy", `load ${APP}/admin`]);
    expect(fake.created[0]?.show).toBe(false);
    expect(fake.created[0]?.title).toBe("T");
  });

  it("does not let the page retitle the window", () => {
    const fake = fakeWindowFactory();
    createAppWindow({ url: `${APP}/admin`, title: "T", preloadPath: "/p", ports: fake.ports });
    expect(fake.updateTitle()).toBe(true);
  });

  it("pins the boundary to the loaded URL's parsed origin on the window's own contents", () => {
    const fake = fakeWindowFactory();
    createAppWindow({ url: `${APP}/admin/pages?x=1#frag`, title: "T", preloadPath: "/p", ports: fake.ports });
    expect(fake.policies).toEqual([{ contents: fake.window.webContents, appOrigin: APP }]);
  });

  it("throws on an unparseable URL before any boundary or load", () => {
    const fake = fakeWindowFactory();
    expect(() => createAppWindow({ url: "not a url", title: "T", preloadPath: "/p", ports: fake.ports })).toThrow(TypeError);
    expect(fake.policies).toEqual([]);
    expect(fake.log.some((step) => step.startsWith("load"))).toBe(false);
  });
});
