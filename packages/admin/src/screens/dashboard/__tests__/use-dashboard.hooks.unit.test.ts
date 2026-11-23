// @vitest-environment jsdom
import { act, renderHook, waitFor } from "../../../__tests__/fetch-query-support.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDashboard, type DashboardDependencies } from "../hooks/use-dashboard.hooks.js";
import { createFakeDashboardPort } from "../hooks/fake-dashboard-port.js";
import type { DashboardPort } from "../hooks/dashboard-port.hooks.js";
import type { DashboardActivityRow } from "../dashboard-view.types.js";
import { AdminBootScopeContext } from "../../../shell/lib/admin-boot-scope.js";
import { createElement, type ReactNode } from "react";
import { publishContentRefresh } from "../../../shell/lib/content-refresh-bus.js";

const DISMISSED_KEY = "host.admin.default-password-banner.dismissed";

/** The host seams every call binds: an API-client base case that shows an Error's own words (the
 *  host's contract this suite was written against) and the host-namespaced Dismiss key. */
const HOST: Pick<DashboardDependencies, "describeError" | "passwordBannerDismissedKey"> = {
  describeError: ({ e, fallback }) => (e instanceof Error ? e.message || fallback : fallback),
  passwordBannerDismissedKey: DISMISSED_KEY,
};

/**
 * @file `useDashboard`'s injected-port seam (2026-08-14, closes the port-conversion gap
 * `use-dashboard.hooks.ts`'s own file header describes) — proves the five independent reads run
 * against `createFakeDashboardPort` with zero `fetch` involved, complementing
 * `Dashboard.unit.test.tsx`'s existing end-to-end (stubbed-`fetch`, real `useWiredDashboard`)
 * coverage the same way `use-form-editor.unit.test.tsx` complements `FormEditor.unit.test.tsx`.
 * Now: `Dashboard.unit.test.tsx` is the host's end-to-end screen test; the form-editor pair named
 * above is the host's too.
 */

function postFixture(overrides: Partial<DashboardActivityRow> = {}): DashboardActivityRow {
  return {
    id: "p1",
    kind: "post",
    title: "Hello",
    slug: "hello",
    status: "published",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("useDashboard — active theme after an out-of-band activation", () => {
  // Owner 11-02: the Appearance card kept the old theme's name after the chat activated a new theme.
  it("re-reads the active theme when an assistant run announces a content refresh", async () => {
    const port = createFakeDashboardPort({ activeThemeId: "starter", activeThemeName: "Starter" });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));
    await waitFor(() => expect(result.current.themeName).toBe("Starter"));

    vi.spyOn(port, "getPresentation").mockResolvedValue({ settings: { activeThemeId: "ground" }, availableThemes: [{ id: "ground", name: "Ground" }] });
    act(() => publishContentRefresh());

    await waitFor(() => expect(result.current.themeName).toBe("Ground"));
  });
});

describe("useDashboard — injected port", () => {
  it.each([
    ["listPostsError", "posts"],
    ["listPagesError", "pages"],
    ["listMediaError", "media"],
  ] as const)("reports %s independently of the healthy comments count", async (errorOption, stat) => {
    const port = createFakeDashboardPort({ [errorOption]: new Error(`${stat} unavailable`), pendingCommentsCount: 3 });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current[stat]).toEqual({ value: null, error: `${stat} unavailable` }));
    await waitFor(() => expect(result.current.comments).toEqual({ value: 3, error: null }));
  });

  it("reports a presentation failure without hiding the healthy posts count", async () => {
    const port = createFakeDashboardPort({ getPresentationError: new Error("theme unavailable"), posts: [postFixture()] });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.themeError).toBe("theme unavailable"));
    expect(result.current.themeId).toBeNull();
    expect(result.current.themeName).toBeNull();
    await waitFor(() => expect(result.current.posts).toEqual({ value: 1, error: null }));
  });

  it("loads all five stats from the fake port's seed, with no fetch involved", async () => {
    const networkMock = vi.fn();
    vi.stubGlobal("fetch", networkMock);
    const port = createFakeDashboardPort({
      posts: [postFixture({ id: "p1", status: "published" }), postFixture({ id: "p2", status: "draft", kind: "post" })],
      pages: [postFixture({ id: "pg1", kind: "page", status: "draft" })],
      media: [{ status: "active" }, { status: "active" }, { status: "trashed" }],
      pendingCommentsCount: 4,
      activeThemeId: "quartz-libre",
      activeThemeName: "Meridian",
    });

    const listCommentsQueue = vi.spyOn(port, "listCommentsQueue");
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.posts.value).toBe(2));
    expect(result.current.published).toBe(1);
    expect(result.current.pages.value).toBe(1);
    expect(result.current.drafts).toBe(1);
    expect(result.current.media.value).toBe(2);
    expect(result.current.comments.value).toBe(4);
    expect(listCommentsQueue).toHaveBeenCalledExactlyOnceWith({ status: "pending" });
    expect(result.current.themeId).toBe("quartz-libre");
    expect(result.current.themeName).toBe("Meridian");
    expect(networkMock).not.toHaveBeenCalled();
  });

  it("merges posts and pages into `recent`, independent of which settles first", async () => {
    const port = createFakeDashboardPort({
      posts: [postFixture({ id: "p1", updatedAt: "2026-08-01T00:00:00.000Z" })],
      pages: [postFixture({ id: "pg1", kind: "page", updatedAt: "2026-08-02T00:00:00.000Z" })],
    });

    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.recent).not.toBeNull());
    // Newest-first (pages' 08-02 row before posts' 08-01 row) — proves both sources landed in one
    // merged list rather than one silently overwriting the other.
    expect(result.current.recent?.map((r) => r.id)).toEqual(["pg1", "p1"]);
  });

  it("keeps each stat's error independent — a failed comments read does not blank the posts count", async () => {
    const port = createFakeDashboardPort({
      posts: [postFixture()],
      listCommentsQueueError: new Error("comments unavailable"),
    });

    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.comments.error).toBe("comments unavailable"));
    expect(result.current.posts.value).toBe(1);
    expect(result.current.posts.error).toBeNull();
  });

  it("passes the injected t straight through, proving it isn't a hardcoded DASHBOARD_DICT lookup", () => {
    const port = createFakeDashboardPort();
    const t = (key: string) => `[${key}]`;
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t }));

    expect(result.current.t("Dashboard")).toBe("[Dashboard]");
  });
});

describe("useDashboard — default-password banner (password-banner plan, 2026-09-24, Slice 3)", () => {
  afterEach(() => {
    localStorage.removeItem(DISMISSED_KEY);
  });

  it("does not persist a dismissal before the password status identifies the user", async () => {
    localStorage.removeItem(DISMISSED_KEY);
    let resolveStatus!: (status: { usesDefaultPassword: boolean; principalId: string }) => void;
    const status = new Promise<{ usesDefaultPassword: boolean; principalId: string }>((resolve) => { resolveStatus = resolve; });
    const port = { ...createFakeDashboardPort(), getPasswordStatus: () => status };
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    act(() => result.current.dismissDefaultPasswordBanner());
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
    expect(result.current.showDefaultPasswordBanner).toBe(false);

    await act(async () => { resolveStatus({ usesDefaultPassword: true, principalId: "late-user" }); });
    await waitFor(() => expect(result.current.showDefaultPasswordBanner).toBe(true));
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  it("shows once the port reports usesDefaultPassword: true", async () => {
    const port = createFakeDashboardPort({ usesDefaultPassword: true });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.showDefaultPasswordBanner).toBe(true));
  });

  it("hides after dismiss, and persists the dismissal to localStorage under the caller's own id", async () => {
    const port = createFakeDashboardPort({ usesDefaultPassword: true });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));
    await waitFor(() => expect(result.current.showDefaultPasswordBanner).toBe(true));

    result.current.dismissDefaultPasswordBanner();

    await waitFor(() => expect(result.current.showDefaultPasswordBanner).toBe(false));
    expect(localStorage.getItem(DISMISSED_KEY)).toBe("fake-user-1");
  });

  it("stays hidden on a fresh mount when the same user already dismissed it", async () => {
    localStorage.setItem(DISMISSED_KEY, "fake-user-1");
    const port = createFakeDashboardPort({ usesDefaultPassword: true });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.themeId).not.toBeNull());
    expect(result.current.showDefaultPasswordBanner).toBe(false);
  });

  it("re-appears for a different user signed in on the same browser", async () => {
    const portA = createFakeDashboardPort({ usesDefaultPassword: true, principalId: "user-a" });
    const first = renderHook(() => useDashboard({ ...HOST, port: portA, locale: "en", t: (key) => key }));
    await waitFor(() => expect(first.result.current.showDefaultPasswordBanner).toBe(true));
    first.result.current.dismissDefaultPasswordBanner();
    await waitFor(() => expect(first.result.current.showDefaultPasswordBanner).toBe(false));
    first.unmount();

    const portB = createFakeDashboardPort({ usesDefaultPassword: true, principalId: "user-b" });
    const { result } = renderHook(() => useDashboard({ ...HOST, port: portB, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.showDefaultPasswordBanner).toBe(true));
  });

  it("stays hidden when the status fetch rejects — advisory, swallowed, no error state", async () => {
    const port = createFakeDashboardPort({ getPasswordStatusError: new Error("boom") });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.themeId).not.toBeNull());
    expect(result.current.showDefaultPasswordBanner).toBe(false);
  });

  it("still renders when localStorage throws on read", async () => {
    const realGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("storage disabled");
    };
    try {
      const port = createFakeDashboardPort({ usesDefaultPassword: true });
      const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

      await waitFor(() => expect(result.current.showDefaultPasswordBanner).toBe(true));
    } finally {
      Storage.prototype.getItem = realGetItem;
    }
  });
});

describe("useDashboard — site key banner (site-key plan §A.6)", () => {
  it("shows for missing-with-data", async () => {
    const port = createFakeDashboardPort({ siteKeyState: "missing-with-data" });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.showSiteKeyBanner).toBe(true));
    expect(result.current.siteKeyBannerMessage.length).toBeGreaterThan(0);
  });

  it("hides for the normal active state", async () => {
    const port = createFakeDashboardPort({ siteKeyState: "active" });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.themeId).not.toBeNull());
    expect(result.current.showSiteKeyBanner).toBe(false);
  });

  it("hides when the status fetch rejects — advisory, swallowed, same fail-closed default as the password banner", async () => {
    const port = createFakeDashboardPort({ getSiteKeyStateError: new Error("boom") });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.themeId).not.toBeNull());
    expect(result.current.showSiteKeyBanner).toBe(false);
  });
});

describe("useDashboard — boundary pins (L162 refactor)", () => {
  it.each([
    ["listPosts", "posts", "no se pudieron cargar las entradas"],
    ["listPages", "pages", "no se pudieron cargar las páginas"],
    ["listMedia", "media", "no se pudo cargar el contenido multimedia"],
    ["listCommentsQueue", "comments", "no se pudieron cargar los comentarios"],
  ] as const)("%s rejecting with a non-Error reports the locale's own fallback on the %s stat", async (method, stat, message) => {
    const port: DashboardPort = { ...createFakeDashboardPort(), [method]: () => Promise.reject("offline") };
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "es", t: (key) => key }));

    await waitFor(() => expect(result.current[stat]).toEqual({ value: null, error: message }));
  });

  it("getPresentation rejecting with a non-Error reports the locale's own theme fallback", async () => {
    const port: DashboardPort = { ...createFakeDashboardPort(), getPresentation: () => Promise.reject("offline") };
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "es", t: (key) => key }));

    await waitFor(() => expect(result.current.themeError).toBe("no se pudo cargar el tema activo"));
  });

  it("an API error with an empty message falls back to the English source string", async () => {
    const port: DashboardPort = { ...createFakeDashboardPort(), listPosts: () => Promise.reject(new Error("")) };
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.posts.error).toBe("failed to load posts"));
  });

  it("starts every stat pending before any read settles", () => {
    const pending = new Promise<never>(() => {});
    const port: DashboardPort = {
      listPosts: () => pending, listPages: () => pending, listMedia: () => pending, listCommentsQueue: () => pending,
      getPresentation: () => pending, getPasswordStatus: () => pending, getSiteKeyState: () => pending,
    };
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    expect(result.current).toMatchObject({
      posts: { value: null, error: null }, published: null, pages: { value: null, error: null }, drafts: null,
      media: { value: null, error: null }, comments: { value: null, error: null },
      themeId: null, themeName: null, themeError: null, recent: null,
      showDefaultPasswordBanner: false, showSiteKeyBanner: false, siteKeyBannerMessage: "",
    });
  });

  it("builds `recent` from posts alone while pages are still pending", async () => {
    const port: DashboardPort = { ...createFakeDashboardPort({ posts: [postFixture({ id: "p1" })] }), listPages: () => new Promise<never>(() => {}) };
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.recent?.map((row) => row.id)).toEqual(["p1"]));
    expect(result.current.pages).toEqual({ value: null, error: null });
    expect(result.current.drafts).toBeNull();
  });

  it("builds `recent` from pages alone while posts are still pending", async () => {
    const port: DashboardPort = { ...createFakeDashboardPort({ pages: [postFixture({ id: "pg1", kind: "page" })] }), listPosts: () => new Promise<never>(() => {}) };
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.recent?.map((row) => row.id)).toEqual(["pg1"]));
    expect(result.current.posts).toEqual({ value: null, error: null });
    expect(result.current.published).toBeNull();
  });

  it("names the active theme by its id when the presentation carries no display name", async () => {
    const port = createFakeDashboardPort({ activeThemeId: "quartz-libre" });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.themeName).toBe("quartz-libre"));
  });
});

describe("useDashboard — default-password banner boundary pins (L162 refactor)", () => {
  afterEach(() => {
    localStorage.removeItem(DISMISSED_KEY);
  });

  it("stays hidden when the port reports usesDefaultPassword: false", async () => {
    const port = createFakeDashboardPort({ usesDefaultPassword: false });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.themeId).not.toBeNull());
    expect(result.current.showDefaultPasswordBanner).toBe(false);
  });

  it("asks the port for the boot scope's own principal id", async () => {
    const port = createFakeDashboardPort();
    const getPasswordStatus = vi.spyOn(port, "getPasswordStatus");
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(AdminBootScopeContext.Provider, { value: { principalId: "boot-user", checking: false }, children });
    renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }), { wrapper });

    await waitFor(() => expect(getPasswordStatus).toHaveBeenCalledExactlyOnceWith({ principalId: "boot-user" }));
  });

  it("asks the port with a null principal id outside an authenticated boot scope", async () => {
    const port = createFakeDashboardPort();
    const getPasswordStatus = vi.spyOn(port, "getPasswordStatus");
    renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(getPasswordStatus).toHaveBeenCalledExactlyOnceWith({ principalId: null }));
  });

  it("still hides for this session when localStorage throws on write", async () => {
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("storage full");
    };
    try {
      const port = createFakeDashboardPort({ usesDefaultPassword: true });
      const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));
      await waitFor(() => expect(result.current.showDefaultPasswordBanner).toBe(true));

      act(() => result.current.dismissDefaultPasswordBanner());

      expect(result.current.showDefaultPasswordBanner).toBe(false);
    } finally {
      Storage.prototype.setItem = realSetItem;
    }
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });
});

describe("useDashboard — site key banner boundary pins (L162 refactor)", () => {
  it.each([
    ["missing-with-data", "This site has saved credentials, but no site key was found to open them."],
    ["mismatch", "This site's key doesn't match the one its data was saved with. Saved credentials can't be opened."],
    ["invalid", "This site's key isn't in a usable format. Saved credentials can't be opened."],
  ] as const)("shows %s with its own copy, translated through the injected t", async (siteKeyState, copy) => {
    const port = createFakeDashboardPort({ siteKeyState });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => `[${key}]` }));

    await waitFor(() => expect(result.current.showSiteKeyBanner).toBe(true));
    expect(result.current.siteKeyBannerMessage).toBe(`[${copy}]`);
  });

  it("hides plain missing with an empty message", async () => {
    const port = createFakeDashboardPort({ siteKeyState: "missing" });
    const { result } = renderHook(() => useDashboard({ ...HOST, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.themeId).not.toBeNull());
    expect(result.current.showSiteKeyBanner).toBe(false);
    expect(result.current.siteKeyBannerMessage).toBe("");
  });
});

describe("useDashboard — injected host seams", () => {
  it("describes a failed read through the injected describeError, not a built-in rule", async () => {
    const port = createFakeDashboardPort({ listPostsError: new Error("raw server words") });
    const describeError = vi.fn(({ fallback }: { e: unknown; fallback: string }) => `host: ${fallback}`);
    const { result } = renderHook(() => useDashboard({ ...HOST, describeError, port, locale: "en", t: (key) => key }));

    await waitFor(() => expect(result.current.posts.error).toBe("host: failed to load posts"));
    expect(describeError).toHaveBeenCalledWith({ e: expect.any(Error), fallback: "failed to load posts" });
  });

  it("persists the dismissal under the injected storage key", async () => {
    const port = createFakeDashboardPort({ usesDefaultPassword: true });
    const { result } = renderHook(() => useDashboard({ ...HOST, passwordBannerDismissedKey: "other.key", port, locale: "en", t: (key) => key }));
    await waitFor(() => expect(result.current.showDefaultPasswordBanner).toBe(true));

    act(() => result.current.dismissDefaultPasswordBanner());

    expect(localStorage.getItem("other.key")).toBe("fake-user-1");
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
    localStorage.removeItem("other.key");
  });
});
