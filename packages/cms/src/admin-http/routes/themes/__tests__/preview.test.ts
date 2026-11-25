import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { describe, expect, it, vi } from "vitest";

import { themePreviewRoute, type ThemePreviewRouteDeps, type ThemePreviewRouteTheme } from "../preview.js";

const signal = new AbortController().signal;
const PERMISSION_CALL = { permission: "theme.set", entityType: "presentation" };

function theme(id: string, { tier = "static", status = "valid", pages = { index: "<main></main>" } as Record<string, string> | undefined, dir = `/themes/${id}` } = {}): ThemePreviewRouteTheme {
  return { status, manifest: { id, tier }, dir, ...(pages === undefined ? {} : { pages }) };
}

/** A capture queue whose stored versions live in a map; `capture` decides what a drain writes. */
function fakeQueue({ stored = {} as Record<string, number>, capture = (): number | null => 5_000 } = {}) {
  const versions = new Map(Object.entries(stored));
  const enqueued: Array<{ name: string; url: string; lifecycle: string }> = [];
  const pending: Array<{ name: string; url: string; lifecycle: string }> = [];
  const queue: NonNullable<ThemePreviewRouteDeps["previews"]> = {
    versions({ sites, targets }) {
      const result: Record<string, number> = {};
      for (const site of sites) {
        const version = versions.get(site.name);
        if (version !== undefined && !(Date.parse(site.createdAt) > version)) result[site.name] = version;
      }
      for (const target of targets) if (result[target.name] === undefined) { enqueued.push(target); pending.push(target); }
      return result;
    },
    read: ({ name }) => (versions.has(name) ? Buffer.from(`jpeg:${name}:${versions.get(name)}`) : null),
    async idle() {
      for (let target = pending.shift(); target; target = pending.shift()) {
        const written = capture();
        if (written !== null) versions.set(target.name, written);
      }
    },
  };
  return { queue, enqueued };
}

function build(overrides: Partial<ThemePreviewRouteDeps> = {}) {
  const authorizeCalls: unknown[] = [];
  const deps: ThemePreviewRouteDeps = {
    themes: [theme("editorial-rose")], previews: undefined,
    servingAddress: () => ({ scheme: "https", port: 3000 }),
    contentVersion: () => 1_000, shippedImage: () => null, waitMs: 50, previewContentType: "image/jpeg",
    ...overrides,
  };
  const authorize = async (required: unknown) => { authorizeCalls.push(required); };
  const get = (themeId: string | undefined, { allow = authorize } = {}) => themePreviewRoute.handle({
    raw: { body: undefined, query: {}, params: themeId === undefined ? { workspaceId: "ws" } : { workspaceId: "ws", themeId } },
    deps, context: { id: "operator" }, authorize: allow as never,
  }, { signal });
  return { get, authorizeCalls, deps };
}

describe("themePreviewRoute", () => {
  it("pins the method, path and the buffered-redirect reply", () => {
    expect(themePreviewRoute.method).toBe("get");
    expect(themePreviewRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/themes/:themeId/preview");
    expect(themePreviewRoute.bufferedReply).toBe("redirect");
  });

  it("serves a capture taken after the theme's last edit as-is, immutable, with no new capture queued", async () => {
    const { queue, enqueued } = fakeQueue({ stored: { "editorial-rose": 2_000 } });
    const t = build({ previews: queue });
    const response = await t.get("editorial-rose");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("jpeg:editorial-rose:2000");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(enqueued).toEqual([]);
    expect(t.authorizeCalls).toEqual([PERMISSION_CALL]);
  });

  it("re-captures a theme edited after its capture, from its own render, and waits for it", async () => {
    const { queue, enqueued } = fakeQueue({ stored: { "editorial-rose": 500 }, capture: () => 9_000 });
    const response = await build({ previews: queue }).get("editorial-rose");
    expect(enqueued).toEqual([{ name: "editorial-rose", url: "https://localhost:3000/theme-explore/editorial-rose/index", lifecycle: "1000" }]);
    expect(await response.text()).toBe("jpeg:editorial-rose:9000");
  });

  it("captures an index-less theme at its first page and percent-encodes the ids in the URL", async () => {
    const { queue, enqueued } = fakeQueue();
    await build({ previews: queue, themes: [theme("one pager", { pages: { "ho me": "" } })], servingAddress: () => ({ scheme: "http", port: 8080 }) }).get("one pager");
    expect(enqueued[0]?.url).toBe("http://localhost:8080/theme-explore/one%20pager/ho%20me");
  });

  it("falls back to the shipped screenshot (a no-store 302), else a no-store 404, when no capture can be made", async () => {
    const failing = fakeQueue({ capture: () => null });
    const redirect = await build({ previews: failing.queue, shippedImage: () => "/shipped.png" }).get("editorial-rose");
    expect([redirect.status, redirect.headers.get("location"), redirect.headers.get("cache-control")]).toEqual([302, "/shipped.png", "no-store"]);
    const none = await build({ previews: failing.queue }).get("editorial-rose");
    expect(none.status).toBe(404);
    expect(none.headers.get("cache-control")).toBe("no-store");
    expect(none.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await none.json()).toEqual({ code: "THEME_PREVIEW_NOT_FOUND", error: "no preview" });
    const off = await build({ shippedImage: () => "/shipped.png" }).get("editorial-rose");
    expect([off.status, off.headers.get("location")]).toEqual([302, "/shipped.png"]);
  });

  it("does not wait past waitMs for a slow capture: the fallback answers", async () => {
    const slow = { versions: () => ({}), read: () => null, idle: () => new Promise<void>(() => {}) };
    expect((await build({ previews: slow }).get("editorial-rose")).status).toBe(404);
  });

  it("answers unknown, invalid and non-static themes with the 404, never touching the queue", async () => {
    const { queue, enqueued } = fakeQueue();
    const t = build({ previews: queue, themes: [theme("editorial-rose"), theme("shop", { tier: "templated" }), theme("broken", { status: "invalid" })] });
    for (const id of ["missing", "shop", "broken", undefined]) {
      const response = await t.get(id);
      expect([id, response.status, await response.json()]).toEqual([id, 404, { code: "THEME_NOT_FOUND", error: "no such static theme" }]);
      expect(response.headers.get("cache-control")).toBeNull();
    }
    expect(enqueued).toEqual([]);
  });

  it("asks for theme.set before it looks at any theme, and a refusal reaches no queue", async () => {
    const { queue, enqueued } = fakeQueue();
    const t = build({ previews: queue });
    const refuse = async () => { throw new RouteRefusalError({ status: 403, body: { error: "forbidden" } }); };
    await expect(t.get("editorial-rose", { allow: refuse })).rejects.toBeInstanceOf(RouteRefusalError);
    expect(enqueued).toEqual([]);
  });

  it("skips the queue and uses the uncached fallback when the theme has no pages (empty or absent map)", async () => {
    const boom = () => { throw new Error("queue must not be touched"); };
    const queue = { versions: boom, read: boom, idle: boom };
    for (const pages of [{}, undefined]) {
      const response = await build({ previews: queue, themes: [{ ...theme("bare"), pages }], shippedImage: () => "/fallback.png" }).get("bare");
      expect([response.status, response.headers.get("location"), response.headers.get("cache-control")]).toEqual([302, "/fallback.png", "no-store"]);
    }
  });

  it("uses the shipped image when a recorded capture has no bytes, and when no serving address exists", async () => {
    const stored = fakeQueue({ stored: { "editorial-rose": 2_000 } });
    stored.queue.read = () => null;
    expect((await build({ previews: stored.queue, shippedImage: () => "/fallback.png" }).get("editorial-rose")).status).toBe(302);
    const unserved = fakeQueue();
    unserved.queue.read = () => { throw new Error("unrecorded capture must not be read"); };
    const response = await build({ previews: unserved.queue, servingAddress: () => undefined, shippedImage: () => "/fallback.png" }).get("editorial-rose");
    expect(response.status).toBe(302);
    expect(unserved.enqueued).toEqual([]);
  });

  it("still serves a completed capture when the queue drain rejects, and logs the rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const queue = { versions: (): Record<string, number> => (++calls < 3 ? {} : { "editorial-rose": 2_000 }), read: () => Buffer.from("completed"), idle: async () => { throw new Error("drain failed after capture"); } };
    const response = await build({ previews: queue }).get("editorial-rose");
    expect(await response.text()).toBe("completed");
    expect(calls).toBe(3);
    expect(warn.mock.calls[0]?.[0]).toBe("[theme-preview] Could not wait for the preview capture:");
    warn.mockRestore();
  });

  it("lets a queue failure surface to the host's error port", async () => {
    const queue = { versions: () => { throw new Error("store offline"); }, read: () => null, idle: async () => {} };
    await expect(build({ previews: queue }).get("editorial-rose")).rejects.toThrow("store offline");
  });
});
