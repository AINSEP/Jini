import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WidgetInstanceEditor, widgetInstanceGuard } from "./fixtures/pages.js";
import type { WidgetInstanceEditorController } from "./fixtures/use-widget-instance-editor.js";
import type { AdminWidget } from "./fixtures/api.js";

/**
 * @file `WidgetInstanceEditor` — pins the fix for the audit's Major finding on
 * `/widgets/new?type=garbage-nonsense`: a missing `?type=` was already handled ("No widget type
 * specified."), but a garbage one previously reached a full live editor shell — title field,
 * working Save button — with zero config fields and zero explanation. Follows the RTL harness
 * `Plugins.unit.test.tsx` established for this package.
 */

let fetchMock: ReturnType<typeof vi.fn<(...args: any[]) => any>>;

beforeEach(() => {
  fetchMock = vi.fn();
  // `WidgetInstanceEditor` now also reads `core.language.locale` (via `useAdminLocale`) to
  // translate its own chrome — unconditionally, ahead of the guard below, since it's a top-level
  // hook call. Routed here rather than through `fetchMock`, so `fetchMock` keeps meaning exactly
  // what this file's tests assert on it: widget-data calls only, none of which should fire while
  // the guard is bailing out on a bad `?type=`.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/settings/effective")) {
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    }
    return fetchMock(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a garbage ?type= on /widgets/new", () => {
  it("renders an Unknown widget type error instead of a live editor shell", () => {
    render(<WidgetInstanceEditor widgetId={null} widgetType="garbage-nonsense" />);

    expect(screen.getByText('Unknown widget type "garbage-nonsense".')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Widget title")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a missing ?type= on /widgets/new (still handled)", () => {
  it("renders No widget type specified, unaffected by the new check", () => {
    render(<WidgetInstanceEditor widgetId={null} widgetType={null} />);
    expect(screen.getByText("No widget type specified.")).toBeInTheDocument();
  });
});

describe("a known widget type on /widgets/new", () => {
  it("renders the live editor shell normally", () => {
    render(<WidgetInstanceEditor widgetId={null} widgetType="text" />);

    expect(screen.getByPlaceholderText("Widget title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("gives the title field a real accessible name, not just a placeholder", () => {
    render(<WidgetInstanceEditor widgetId={null} widgetType="text" />);

    const titleInput = screen.getByLabelText("Widget title");
    expect(titleInput).toHaveAttribute("placeholder", "Widget title");
  });
});

describe("WidgetConfigFields wiring (Batch D2 i18n — components/shared-components-i18n.ts)", () => {
  it("threads a Spanish locale into the nested WidgetConfigFields via a SECOND t bound to shared-components-i18n, not this screen's own widgets-i18n t", () => {
    // This screen's own `t` (from `use-widget-instance-editor.hooks.ts`) is bound to
    // `widgets-i18n.ts`'s `WIDGETS_DICT` — a DIFFERENT dictionary from `WidgetConfigFields`'s own
    // `shared-components-i18n.ts`. Left as an untranslated passthrough here on purpose: this test
    // only needs to prove `locale` reaches `WidgetInstanceEditor.tsx`'s own `sharedT` (built off
    // `shared-components-i18n.ts`'s real, exported `t`), not that every string on the page is
    // Spanish. "Texto" below is that real dictionary's actual `es` value for `WidgetConfigFields`'s
    // "Text" key (`SHARED_COMPONENTS_DICT.es.Text`) — not a fake stand-in string — so this fails if
    // `WidgetInstanceEditor.tsx` ever stops building `sharedT` or passes the wrong `locale` into it.
    function useFakeEditor() {
      return {
        isNew: true,
        widget: null,
        whereUsed: { count: 0, references: [] },
        title: "",
        setTitle: vi.fn(),
        config: {},
        setConfig: vi.fn(),
        message: null,
        error: null,
        fieldErrors: [],
        loading: false,
        saving: false,
        widgetType: "text" as const,
        save: vi.fn(),
        confirmLeave: vi.fn(() => true),
        t: (key: string) => key,
        locale: "es",
      };
    }

    render(<WidgetInstanceEditor widgetId={null} widgetType="text" useWidgetInstanceEditorHook={useFakeEditor} />);

    expect(screen.getByLabelText("Texto")).toBeInTheDocument();
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
  });
});

function editorController(overrides: Partial<WidgetInstanceEditorController> = {}): WidgetInstanceEditorController {
  return { isNew: true, widget: null, whereUsed: { count: 0, references: [] }, title: "", setTitle: vi.fn(), config: {}, setConfig: vi.fn(), message: null, error: null, fieldErrors: [], loading: false, saving: false, widgetType: "text", save: vi.fn(), confirmLeave: vi.fn(() => true), t: (key) => key, locale: "en", ...overrides };
}

describe("editor controls", () => {
  it("sends the edited title and config to Save, and blocks Back when leaving is declined", async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    const confirmLeave = vi.fn(() => false);
    function useEditor() {
      const [title, setTitle] = useState("");
      const [config, setConfig] = useState<Record<string, unknown>>({ body: "" });
      return editorController({ title, setTitle, config, setConfig, save: async () => { saved({ title, config }); }, confirmLeave });
    }
    render(<WidgetInstanceEditor widgetId={null} widgetType="text" useWidgetInstanceEditorHook={useEditor} />);
    await user.type(screen.getByLabelText("Widget title"), "Announcement");
    await user.type(screen.getByLabelText("Text"), "Shipping Friday");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith({ title: "Announcement", config: { body: "Shipping Friday" } });
    expect(fireEvent.click(screen.getByRole("link", { name: "Back: Widgets" }))).toBe(false);
    expect(confirmLeave).toHaveBeenCalledTimes(1);
  });

  it("shows the controller's success, save error and field errors", () => {
    render(<WidgetInstanceEditor widgetId={null} widgetType="text" useWidgetInstanceEditorHook={() => editorController({ message: "Saved widget.", error: "Write denied", fieldErrors: [{ field: "text", reason: "Text is required" }] })} />);
    expect(screen.getByText("Saved widget.")).toBeInTheDocument();
    expect(screen.getAllByRole("alert").map((node) => node.textContent)).toEqual(["Write denied", "text: Text is required"]);
  });
});

// Direct tests for the pure decision function pulled out of `WidgetInstanceEditor` in the
// complexity pass (cyc 14/cog 11 -> 9/7) — the four early-exit states are now one top-level
// function, testable without mounting the component or its hook.
const FAKE_WIDGET = {
  id: "w1",
  workspaceId: "ws1",
  slug: "hero-text",
  title: "Hero text",
  status: "active" as const,
  widgetType: "text" as const,
  config: { body: "hi" },
  updatedAt: "2026-01-01",
  version: 1,
} satisfies AdminWidget;

describe("widgetInstanceGuard", () => {
  it("returns fetch-error when loading a widget failed and none is already loaded", () => {
    expect(widgetInstanceGuard({ error: "boom", isNew: false, widget: null, loading: false, widgetType: "text" })).toEqual({
      kind: "fetch-error",
      message: "boom",
    });
  });

  it("does NOT return fetch-error once a widget is loaded, even if a stale error is still set", () => {
    // Mirrors the original inline guard's `!widget` condition: an error from a prior failed save
    // must not blank out an already-rendered editor.
    expect(widgetInstanceGuard({ error: "stale save error", isNew: false, widget: FAKE_WIDGET, loading: false, widgetType: "text" })).toBeNull();
  });

  it("does NOT return fetch-error on the new-widget screen, even with an error set", () => {
    expect(widgetInstanceGuard({ error: "save failed", isNew: true, widget: null, loading: false, widgetType: "text" })).toBeNull();
  });

  it("returns loading whenever loading is true, ahead of the no-type/unknown-type checks", () => {
    expect(widgetInstanceGuard({ error: null, isNew: false, widget: null, loading: true, widgetType: null })).toEqual({ kind: "loading" });
  });

  it("returns no-type when widgetType is null and not loading", () => {
    expect(widgetInstanceGuard({ error: null, isNew: true, widget: null, loading: false, widgetType: null })).toEqual({ kind: "no-type" });
  });

  it("returns unknown-type for a garbage type on the NEW-widget screen only", () => {
    expect(widgetInstanceGuard({ error: null, isNew: true, widget: null, loading: false, widgetType: "garbage-nonsense" })).toEqual({
      kind: "unknown-type",
      widgetType: "garbage-nonsense",
    });
  });

  it("does NOT check unknown-type for an already-loaded widget (server validated it at creation)", () => {
    expect(
      widgetInstanceGuard({ error: null, isNew: false, widget: FAKE_WIDGET, loading: false, widgetType: "garbage-nonsense" }),
    ).toBeNull();
  });

  it("returns null (no guard) once everything is ready to render the full editor shell", () => {
    expect(widgetInstanceGuard({ error: null, isNew: false, widget: FAKE_WIDGET, loading: false, widgetType: "text" })).toBeNull();
    expect(widgetInstanceGuard({ error: null, isNew: true, widget: null, loading: false, widgetType: "text" })).toBeNull();
  });
});
