import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type AdminWidget } from "./fixtures/api.js";
import { navigate } from "./fixtures/navigation.js";
import { createFakeWidgetsPort } from "./fixtures/memory.js";
import { useWidgetInstanceEditor, useWiredWidgetInstanceEditor } from "./fixtures/use-widget-instance-editor.js";

/**
 * @file Characterization tests for `useWidgetInstanceEditor` — first direct test file for this
 * hook (previously exercised only indirectly, and only for two `?type=` edge cases, through
 * `WidgetInstanceEditor.unit.test.tsx`). Written against CURRENT behavior per the complexity-pass
 * dispatch: this hook is explicitly NOT being restructured in this pass (its
 * `[message,error,fieldErrors,loading,saving]` cluster is slated for a shared `useAsyncAction`
 * primitive elsewhere) — these tests exist to give that future adoption a green baseline to work
 * against, not to assert what the hook "should" do differently.
 *
 * Follows the fetch-mocking-via-`api`-spies harness `use-collection-entry-editor.unit.test.ts`
 * established for this package's hook tests, including its `navigate` mock shape.
 */

vi.mock("./fixtures/navigation.js", () => ({ navigate: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(navigate).mockClear();
});

const EXISTING_WIDGET: AdminWidget = {
  id: "w1",
  workspaceId: "ws1",
  slug: "hero-banner",
  title: "Hero banner",
  status: "active",
  widgetType: "text",
  config: { body: "hello" },
  updatedAt: "2026-08-01T00:00:00.000Z",
  version: 2,
};

const WHERE_USED = { count: 1, references: [{ kind: "region" as const, sourceEntryId: "e1", fieldPath: "regions.0" }] };

describe("initial state — new widget (widgetId null)", () => {
  it("starts with widget null, blank title, the type's default config, and loading=false", () => {
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: "text" }));

    expect(result.current.isNew).toBe(true);
    expect(result.current.widget).toBeNull();
    expect(result.current.title).toBe("");
    expect(result.current.config).toEqual({ body: "" }); // defaultWidgetConfig("text")
    expect(result.current.whereUsed).toEqual({ count: 0, references: [] });
    expect(result.current.loading).toBe(false);
    expect(result.current.widgetType).toBe("text");
  });

  it("defaults the config to the 'text' type's shape when widgetType is null (no ?type= at all)", () => {
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: null }));
    // resolveEditorWidgetType(isNew=true, null, null) -> null, so the CONTROLLER's widgetType is
    // null — but the config-seeding effect independently falls back to "text" via `?? "text"`,
    // which is why config is non-empty even though widgetType itself reads null.
    expect(result.current.widgetType).toBeNull();
    expect(result.current.config).toEqual({ body: "" });
  });

  it("resolves widgetType from resolveEditorWidgetType for a known query type", () => {
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: "menu" }));
    expect(result.current.widgetType).toBe("menu");
    expect(result.current.config).toEqual({ menuRef: "" });
  });

  it("does not call api.getWidget for a new widget", () => {
    const getWidget = vi.spyOn(api, "getWidget");
    renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: "text" }));
    expect(getWidget).not.toHaveBeenCalled();
  });
});

describe("initial load — existing widget (widgetId set)", () => {
  it("starts loading=true synchronously, before the fetch resolves", () => {
    vi.spyOn(api, "getWidget").mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));
    expect(result.current.loading).toBe(true);
    expect(result.current.isNew).toBe(false);
  });

  it("seeds widget/title/config/whereUsed from the resolved response, and sets loading=false", async () => {
    vi.spyOn(api, "getWidget").mockResolvedValue({ widget: EXISTING_WIDGET, whereUsed: WHERE_USED });
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.widget).toEqual(EXISTING_WIDGET);
    expect(result.current.title).toBe("Hero banner");
    expect(result.current.config).toEqual({ body: "hello" });
    expect(result.current.whereUsed).toEqual(WHERE_USED);
    expect(result.current.widgetType).toBe("text"); // resolved from the loaded widget's own type
    expect(result.current.error).toBeNull();
  });

  it("calls api.getWidget with exactly the widgetId prop", async () => {
    const getWidget = vi.spyOn(api, "getWidget").mockResolvedValue({ widget: EXISTING_WIDGET, whereUsed: WHERE_USED });
    renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));
    await waitFor(() => expect(getWidget).toHaveBeenCalledWith("w1"));
  });

  it("sets a describable error and loading=false when the load rejects with an Error", async () => {
    vi.spyOn(api, "getWidget").mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
    expect(result.current.widget).toBeNull();
  });

  it("falls back to 'failed to load widget' when the rejection is not an Error/ApiError", async () => {
    vi.spyOn(api, "getWidget").mockRejectedValue("string rejection");
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("failed to load widget");
  });

  it("reloads when widgetId changes across a rerender", async () => {
    const getWidget = vi
      .spyOn(api, "getWidget")
      .mockResolvedValueOnce({ widget: EXISTING_WIDGET, whereUsed: WHERE_USED })
      .mockResolvedValueOnce({ widget: { ...EXISTING_WIDGET, id: "w2", title: "Other widget" }, whereUsed: { count: 0, references: [] } });

    const { result, rerender } = renderHook(({ widgetId }) => useWiredWidgetInstanceEditor({ widgetId, widgetType: null }), {
      initialProps: { widgetId: "w1" },
    });
    await waitFor(() => expect(result.current.title).toBe("Hero banner"));

    rerender({ widgetId: "w2" });
    await waitFor(() => expect(result.current.title).toBe("Other widget"));

    expect(getWidget).toHaveBeenCalledTimes(2);
    expect(getWidget).toHaveBeenNthCalledWith(2, "w2");
  });
});

describe("save — no-op guards", () => {
  it("does not call any api method when widgetType has not resolved (null)", async () => {
    const createWidget = vi.spyOn(api, "createWidget");
    const updateWidget = vi.spyOn(api, "updateWidget");
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: null }));

    await act(async () => {
      await result.current.save();
    });

    expect(createWidget).not.toHaveBeenCalled();
    expect(updateWidget).not.toHaveBeenCalled();
  });

  it("does not call api.updateWidget when editing but the widget hasn't loaded yet", async () => {
    vi.spyOn(api, "getWidget").mockReturnValue(new Promise(() => {})); // never resolves -> widget stays null
    const updateWidget = vi.spyOn(api, "updateWidget");
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: "text" }));

    await act(async () => {
      await result.current.save();
    });

    expect(updateWidget).not.toHaveBeenCalled();
  });
});

describe("save — create (isNew)", () => {
  it("calls api.createWidget with widgetType/title/config, and navigates to the new widget's slug", async () => {
    const createWidget = vi.spyOn(api, "createWidget").mockResolvedValue({ widget: { ...EXISTING_WIDGET, id: "w9", slug: "new-text-widget" } });
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: "text" }));
    act(() => result.current.setTitle("New Text Widget"));

    await act(async () => {
      await result.current.save();
    });

    expect(createWidget).toHaveBeenCalledWith({ widgetType: "text", title: "New Text Widget", config: { body: "" } });
    // Slug, not id (2026-09-22, URL-uses-slug) — mirrors `use-form-editor.hooks.ts`'s create-navigate.
    expect(navigate).toHaveBeenCalledWith("/widgets/new-text-widget", undefined);
  });

  it("sets saving=true while the create is in flight, false after it settles", async () => {
    let resolveCreate: ((r: { widget: AdminWidget }) => void) | undefined;
    vi.spyOn(api, "createWidget").mockReturnValue(new Promise((resolve) => (resolveCreate = resolve)));
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: "text" }));

    let promise!: Promise<void>;
    act(() => {
      promise = result.current.save();
    });
    expect(result.current.saving).toBe(true);

    await act(async () => {
      resolveCreate?.({ widget: { ...EXISTING_WIDGET, id: "w9" } });
      await promise;
    });
    expect(result.current.saving).toBe(false);
  });

  it("does NOT set a success message on create — the hook navigates away instead", async () => {
    // Documented as observed behavior, not asserted as correct: unlike the update path (which sets
    // `Saved · version N`), the create path only calls `navigate` and returns — `message` is never
    // set at all on a successful create. Worth a look separately (see report), not changed here.
    vi.spyOn(api, "createWidget").mockResolvedValue({ widget: { ...EXISTING_WIDGET, id: "w9" } });
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: "text" }));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.message).toBeNull();
  });
});

describe("save — update (existing widget)", () => {
  async function mountLoaded() {
    vi.spyOn(api, "getWidget").mockResolvedValue({ widget: EXISTING_WIDGET, whereUsed: WHERE_USED });
    const view = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    return view;
  }

  it("calls api.updateWidget with id/baseVersion/title/config, updates widget+config, and sets a version message", async () => {
    const view = await mountLoaded();
    const updateWidget = vi.spyOn(api, "updateWidget").mockResolvedValue({ widget: { ...EXISTING_WIDGET, version: 3, config: { body: "server normalized" } } });
    act(() => view.result.current.setConfig({ body: "edited" }));

    await act(async () => {
      await view.result.current.save();
    });

    expect(updateWidget).toHaveBeenCalledWith({ id: "w1", baseVersion: 2, title: "Hero banner", config: { body: "edited" } });
    expect(view.result.current.widget?.version).toBe(3);
    expect(view.result.current.config).toEqual({ body: "server normalized" });
    expect(view.result.current.message).toBe("Saved · version 3");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sends an edited title with the update and shows the saved title", async () => {
    const view = await mountLoaded();
    const updateWidget = vi
      .spyOn(api, "updateWidget")
      .mockResolvedValue({ widget: { ...EXISTING_WIDGET, title: "Autumn Hero", version: 3 } });
    act(() => view.result.current.setTitle("Autumn Hero"));

    await act(async () => {
      await view.result.current.save();
    });

    expect(updateWidget).toHaveBeenCalledWith({ id: "w1", baseVersion: 2, title: "Autumn Hero", config: { body: "hello" } });
    expect(view.result.current.title).toBe("Autumn Hero");
  });

  /** The sibling test above sends the same title the server echoes back, so it stays green even if
   *  `save()` never reseeds the field from the response — deleting `setTitle(saved.title)` survives
   *  it. This one makes the two values DIFFER: the server returns the title it actually stored, and
   *  the field has to show that, not the operator's draft, or the next save sends a stale
   *  `baseVersion`-matched title that silently disagrees with the row. */
  it("shows the title the server stored, not the draft, when the two differ", async () => {
    const view = await mountLoaded();
    vi.spyOn(api, "updateWidget").mockResolvedValue({ widget: { ...EXISTING_WIDGET, title: "Autumn Hero", version: 3 } });
    act(() => view.result.current.setTitle("  Autumn Hero  "));

    await act(async () => {
      await view.result.current.save();
    });

    expect(view.result.current.title).toBe("Autumn Hero");
  });

  it("maps a WIDGETS_VERSION_CONFLICT ApiError to STALE_VERSION_MESSAGE", async () => {
    const view = await mountLoaded();
    vi.spyOn(api, "updateWidget").mockRejectedValue(new ApiError("stale", 409, "WIDGETS_VERSION_CONFLICT"));

    await act(async () => {
      await view.result.current.save();
    });

    expect(view.result.current.error).toBe("This widget changed since you loaded it, refresh and try again.");
    expect(view.result.current.fieldErrors).toEqual([]);
  });

  it("maps a WIDGETS_CONFIG_VALIDATION_ERROR ApiError to fieldErrors + a describable error message", async () => {
    const view = await mountLoaded();
    const fieldErrors = [{ field: "body", reason: "too long" }];
    vi.spyOn(api, "updateWidget").mockRejectedValue(
      new ApiError("invalid config", 409, "WIDGETS_CONFIG_VALIDATION_ERROR", { details: { fieldErrors } })
    );

    await act(async () => {
      await view.result.current.save();
    });

    expect(view.result.current.fieldErrors).toEqual(fieldErrors);
    expect(view.result.current.error).toBe("invalid config");
  });

  it("falls back to 'save failed' for any other ApiError code", async () => {
    const view = await mountLoaded();
    vi.spyOn(api, "updateWidget").mockRejectedValue(new ApiError("", 500, "SOME_OTHER_CODE"));

    await act(async () => {
      await view.result.current.save();
    });

    expect(view.result.current.error).toBe("save failed");
    expect(view.result.current.fieldErrors).toEqual([]);
  });

  it("uses a plain Error's own (possibly empty) message rather than the 'save failed' fallback", async () => {
    // `describeApiError` (lib/api.ts) special-cases `ApiError` to fall back on an EMPTY message
    // (`e.message || fallback`), but for a plain `Error` it does `e instanceof Error ? e.message :
    // fallback` — no `||` — so an empty-message plain Error yields `""`, not the fallback. Observed
    // and pinned as-is (see report); not asserted as correct, and not fixed in this pass.
    const view = await mountLoaded();
    vi.spyOn(api, "updateWidget").mockRejectedValue(new Error());

    await act(async () => {
      await view.result.current.save();
    });

    expect(view.result.current.error).toBe("");
  });

  it("uses a plain Error's real message when it has one", async () => {
    const view = await mountLoaded();
    vi.spyOn(api, "updateWidget").mockRejectedValue(new Error("boom"));

    await act(async () => {
      await view.result.current.save();
    });

    expect(view.result.current.error).toBe("boom");
  });

  it("clears a prior message/error/fieldErrors when re-invoked", async () => {
    const view = await mountLoaded();
    vi.spyOn(api, "updateWidget").mockRejectedValueOnce(new ApiError("invalid", 409, "WIDGETS_CONFIG_VALIDATION_ERROR", { details: { fieldErrors: [{ field: "x", reason: "y" }] } }));
    await act(async () => {
      await view.result.current.save();
    });
    expect(view.result.current.error).not.toBeNull();
    expect(view.result.current.fieldErrors).not.toEqual([]);

    vi.spyOn(api, "updateWidget").mockResolvedValueOnce({ widget: EXISTING_WIDGET });
    await act(async () => {
      await view.result.current.save();
    });
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.fieldErrors).toEqual([]);
  });
});

/**
 * `confirmLeave` — unsaved-changes guard (Opus themes+widgets review, OPEN item 2): this editor had
 * no protection against navigating away from an unsaved title/config edit at all. Wires the shared
 * `useDirtyGuard` the same way `use-post-editor.hooks.ts` already does for Posts/Pages.
 */
describe("confirmLeave — unsaved-changes guard", () => {
  it("prompts and returns the operator's answer once the title has changed", async () => {
    vi.spyOn(api, "getWidget").mockResolvedValue({ widget: EXISTING_WIDGET, whereUsed: WHERE_USED });
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setTitle("Edited"));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(result.current.confirmLeave()).toBe(false);
    expect(confirmSpy).toHaveBeenCalledOnce();
  });

  it("prompts once the config has changed, even with the title untouched", async () => {
    vi.spyOn(api, "getWidget").mockResolvedValue({ widget: EXISTING_WIDGET, whereUsed: WHERE_USED });
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setConfig({ body: "edited" }));

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    expect(result.current.confirmLeave()).toBe(true);
    expect(confirmSpy).toHaveBeenCalledOnce();
  });

  it("does not prompt when nothing has changed since load", async () => {
    vi.spyOn(api, "getWidget").mockResolvedValue({ widget: EXISTING_WIDGET, whereUsed: WHERE_USED });
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: "w1", widgetType: null }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const confirmSpy = vi.spyOn(window, "confirm");
    expect(result.current.confirmLeave()).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("does not prompt for a brand-new, not-yet-saved widget — nothing loaded to compare against", () => {
    const { result } = renderHook(() => useWiredWidgetInstanceEditor({ widgetId: null, widgetType: "text" }));
    act(() => result.current.setTitle("Draft"));

    const confirmSpy = vi.spyOn(window, "confirm");
    expect(result.current.confirmLeave()).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

/**
 * The "injected port" half — every test above drives `useWiredWidgetInstanceEditor` and proves
 * behavior via `vi.spyOn(api, ...)`, which is real coverage but doesn't itself prove the DEPENDENCY
 * is injected rather than reached for (a spy on the module intercepts either way). These call
 * `useWidgetInstanceEditor` directly with `createFakeWidgetsPort`/a fake `navigate` — no `api`
 * spy, no `vi.mock("./fixtures/navigation.js")` — so a real network/router touch has nothing to land on.
 */
describe("useWidgetInstanceEditor — injected port (no api spy, no router mock)", () => {
  it("translates the post-save 'Saved · version N' notice into the operator's locale", async () => {
    const port = createFakeWidgetsPort({ widgets: [EXISTING_WIDGET] });
    const { result } = renderHook(() =>
      useWidgetInstanceEditor({ widgetId: "w1", widgetType: null }, { port, locale: "de", navigate: vi.fn(), t: (key: string) => key })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save();
    });

    expect(result.current.message).toBe("Gespeichert · Version 3");
  });

  it("loads from the injected port and never touches the real api client", async () => {
    const getWidgetSpy = vi.spyOn(api, "getWidget");
    const port = createFakeWidgetsPort({ widgets: [EXISTING_WIDGET] });
    const { result } = renderHook(() =>
      useWidgetInstanceEditor({ widgetId: "w1", widgetType: null }, { port, locale: "en", navigate: vi.fn(), t: (key: string) => key })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.title).toBe("Hero banner");
    expect(getWidgetSpy).not.toHaveBeenCalled();
  });

  it("routes create through the injected port and calls the injected navigate, never the real router", async () => {
    const createWidgetSpy = vi.spyOn(api, "createWidget");
    const port = createFakeWidgetsPort();
    const fakeNavigate = vi.fn();
    const { result } = renderHook(() =>
      useWidgetInstanceEditor({ widgetId: null, widgetType: "text" }, { port, locale: "en", navigate: fakeNavigate, t: (key: string) => key })
    );
    act(() => result.current.setTitle("New Text Widget"));

    await act(async () => {
      await result.current.save();
    });

    expect(port.widgets).toHaveLength(1);
    expect(port.widgets[0]?.title).toBe("New Text Widget");
    expect(fakeNavigate).toHaveBeenCalledWith(`/widgets/${port.widgets[0]?.slug}`, undefined);
    expect(createWidgetSpy).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  /**
   * Negative verification (per this refactor's own required check): temporarily replacing
   * `port.getWidget(...)`/`port.createWidget(...)`/`navigate(...)` in
   * `use-widget-instance-editor.hooks.ts` with direct calls to the real `api`/`lib/router` imports
   * and re-running this suite fails all three assertions above (the real `api` calls reject with no
   * network in this test env, and the real `navigate` mock — not `fakeNavigate` — is what would
   * receive the call) — see this feature's commit/handoff report for the recorded run.
   */
  /**
   * URL-uses-slug (2026-09-22): the server now resolves `getWidget` by slug OR id
   * (`read-service.ts`'s `getWidgetInstance`), and `panels.tsx` passes whatever `:widgetId` the URL
   * held straight through as `props.widgetId`. Loading by the widget's OWN slug (the common case,
   * and the only path `WidgetsLibrary.tsx`'s row link and the create-navigate produce) must not
   * touch history — see `widgetSlugRedirectPath`'s own doc comment (`../rules.ts`).
   */
  it("does not replace-navigate when the URL already carries the widget's own slug", async () => {
    const port = createFakeWidgetsPort({ widgets: [EXISTING_WIDGET] });
    const fakeNavigate = vi.fn();
    const { result } = renderHook(() =>
      useWidgetInstanceEditor({ widgetId: EXISTING_WIDGET.slug, widgetType: null }, { port, locale: "en", navigate: fakeNavigate, t: (key: string) => key })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.widget?.id).toBe(EXISTING_WIDGET.id);
    expect(fakeNavigate).not.toHaveBeenCalled();
  });

  /**
   * The old-bookmark case this fix exists for: an id-based `/admin/widgets/<uuid>` link (the
   * pre-2026-09-22 URL shape) still loads the right widget (the server resolves it via
   * `findById`), and the hook replace-navigates the URL to the widget's slug once it does — see
   * `widgetSlugRedirectPath` (`../rules.ts`) for why this only fires for a UUID-shaped id, not any
   * string that merely differs from the slug.
   */
  it("replace-navigates to the slug URL when the URL carried the widget's raw (UUID-shaped) id", async () => {
    const WIDGET_UUID = "b7e6c8a0-1f2d-4e3a-9c5b-6a7d8e9f0a1b";
    const port = createFakeWidgetsPort({ widgets: [{ ...EXISTING_WIDGET, id: WIDGET_UUID }] });
    const fakeNavigate = vi.fn();
    const { result } = renderHook(() =>
      useWidgetInstanceEditor({ widgetId: WIDGET_UUID, widgetType: null }, { port, locale: "en", navigate: fakeNavigate, t: (key: string) => key })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fakeNavigate).toHaveBeenCalledWith(`/widgets/${EXISTING_WIDGET.slug}`, { replace: true });
  });

  it("does not resolve widget while the injected port's get call is still pending", () => {
    const port = createFakeWidgetsPort();
    port.getWidget = () => new Promise(() => {});
    const { result } = renderHook(() =>
      useWidgetInstanceEditor({ widgetId: "w1", widgetType: null }, { port, locale: "en", navigate: vi.fn(), t: (key: string) => key })
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.widget).toBeNull();
  });

  /**
   * Stale-response race (2026-08-12 audit finding, fixed alongside `use-widget-region-editor
   * .hooks.ts` and `use-menu-editor.hooks.ts` — same commit series): this is a route-param loader
   * the panel router reuses across every `:id`, so navigating from widget A to widget B while A's
   * `getWidget` is still in flight must not let A's (now-stale) response land after B's — that would
   * silently show A's title/config under B's URL, and a subsequent save would then write over the
   * WRONG widget. Negatively verified live per this fix's own commit message: removing the
   * `cancelled` guard from the hook's effect (restoring the pre-fix body) makes this test fail —
   * `title` ends up `"Widget A"` instead of `"Widget B"` once A's deferred promise resolves last.
   */
  it("does not let a stale getWidget response (for a widget navigated away from) overwrite the currently-viewed widget", async () => {
    let resolveA!: (value: { widget: AdminWidget; whereUsed: { count: 0; references: [] } }) => void;
    let resolveB!: (value: { widget: AdminWidget; whereUsed: { count: 0; references: [] } }) => void;
    const pendingA = new Promise<{ widget: AdminWidget; whereUsed: { count: 0; references: [] } }>((resolve) => {
      resolveA = resolve;
    });
    const pendingB = new Promise<{ widget: AdminWidget; whereUsed: { count: 0; references: [] } }>((resolve) => {
      resolveB = resolve;
    });
    const WIDGET_A: AdminWidget = { ...EXISTING_WIDGET, id: "widget-a", title: "Widget A" };
    const WIDGET_B: AdminWidget = { ...EXISTING_WIDGET, id: "widget-b", title: "Widget B" };

    const port = createFakeWidgetsPort({ widgets: [WIDGET_A, WIDGET_B] });
    port.getWidget = (id: string) => (id === "widget-a" ? pendingA : pendingB);

    const { result, rerender } = renderHook(
      (props: { widgetId: string }) =>
        useWidgetInstanceEditor({ widgetId: props.widgetId, widgetType: null }, { port, locale: "en", navigate: vi.fn(), t: (key: string) => key }),
      { initialProps: { widgetId: "widget-a" } }
    );

    // Navigate to widget B before A's own request has resolved — this fires the effect's cleanup,
    // flipping A's `cancelled` flag, and starts a fresh request for B.
    rerender({ widgetId: "widget-b" });

    // Resolve B first (the current, wanted response), then A last (the stale one) — the exact
    // out-of-order arrival the panel router can produce on a slow/uneven connection.
    resolveB({ widget: WIDGET_B, whereUsed: { count: 0, references: [] } });
    await waitFor(() => expect(result.current.title).toBe("Widget B"));

    resolveA({ widget: WIDGET_A, whereUsed: { count: 0, references: [] } });
    // Give A's now-resolved (but cancelled) promise a microtask turn to attempt its (guarded) write.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.title).toBe("Widget B");
    expect(result.current.widget?.id).toBe("widget-b");
  });

  /**
   * Stale-response race, save() half (2026-08-12 audit finding — the load-side guard above closes
   * one half of this bug class, but `save()` had no guard of its own until this fix): clicking Save
   * on widget A, then navigating to widget B before A's `updateWidget` resolves, must not let A's
   * (now-stale) response overwrite B's state — that would silently show A's saved title/config under
   * B's URL, and a SECOND save from there would then write to the wrong record (`widget.id` would
   * still read A's id). Negatively verified per this fix's own commit: reverting the `activeEntityRef`
   * guard in `save()` (restoring the pre-fix body) makes this test fail — `title`/`config` end up
   * A's post-save values instead of B's, and `saving` gets stuck reflecting A's completion.
   */
  it("does not let a stale updateWidget response (for a widget navigated away from while saving) overwrite the currently-viewed widget", async () => {
    const WIDGET_A: AdminWidget = { ...EXISTING_WIDGET, id: "widget-a", title: "Widget A", version: 2, config: { body: "a-original" } };
    const WIDGET_B: AdminWidget = { ...EXISTING_WIDGET, id: "widget-b", title: "Widget B", version: 5, config: { body: "b-original" } };
    const port = createFakeWidgetsPort({ widgets: [WIDGET_A, WIDGET_B] });

    let resolveSaveA!: (value: { widget: AdminWidget }) => void;
    const pendingSaveA = new Promise<{ widget: AdminWidget }>((resolve) => {
      resolveSaveA = resolve;
    });
    port.updateWidget = (target) => (target.id === "widget-a" ? pendingSaveA : Promise.reject(new Error("unexpected updateWidget call")));

    const { result, rerender } = renderHook(
      (props: { widgetId: string }) =>
        useWidgetInstanceEditor({ widgetId: props.widgetId, widgetType: null }, { port, locale: "en", navigate: vi.fn(), t: (key: string) => key }),
      { initialProps: { widgetId: "widget-a" } }
    );
    await waitFor(() => expect(result.current.title).toBe("Widget A"));

    // Click Save on widget A — updateWidget("widget-a") is now in flight.
    act(() => {
      void result.current.save();
    });
    expect(result.current.saving).toBe(true);

    // Navigate to widget B before A's save resolves.
    rerender({ widgetId: "widget-b" });
    await waitFor(() => expect(result.current.title).toBe("Widget B"));
    // The load effect's own reset clears the spinner for the newly-viewed widget rather than
    // leaving it stuck on A's still-pending save.
    expect(result.current.saving).toBe(false);

    // Resolve A's save last — the exact out-of-order arrival a slow connection can produce.
    await act(async () => {
      resolveSaveA({ widget: { ...WIDGET_A, version: 3, config: { body: "a-edited-after-navigating-away" } } });
      await Promise.resolve();
    });

    expect(result.current.widget?.id).toBe("widget-b");
    expect(result.current.title).toBe("Widget B");
    expect(result.current.config).toEqual({ body: "b-original" });
    expect(result.current.message).toBeNull();
    expect(result.current.saving).toBe(false);
  });
});
