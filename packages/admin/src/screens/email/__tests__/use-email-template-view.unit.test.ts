// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useEmailTemplateView } from "../hooks/use-email-template-view.hooks.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("starts on Preview unless the caller requests HTML and retains the operator's selections", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 640px)" }));
  const defaults = renderHook(() => useEmailTemplateView());
  expect(defaults.result.current.tab).toBe("preview");
  expect(defaults.result.current.device).toBe("mobile");
  const explicit = renderHook(() => useEmailTemplateView({ initialTab: "html" }));
  expect(explicit.result.current.tab).toBe("html");
  act(() => {
    explicit.result.current.setTab("preview");
    explicit.result.current.setDevice("tablet");
  });
  explicit.rerender();
  expect(explicit.result.current.tab).toBe("preview");
  expect(explicit.result.current.device).toBe("tablet");
  expect(defaults.result.current.device).toBe("mobile");
});

it("measures the attached pane, updates on resize and disconnects on detach", () => {
  const registrations = new Map<Element, (entries: { target: Element; contentRect: { width: number } }[]) => void>();
  class Observer {
    private target: Element | null = null;
    constructor(private readonly onResize: (entries: { target: Element; contentRect: { width: number } }[]) => void) {}
    observe(target: Element) { this.target = target; registrations.set(target, this.onResize); }
    disconnect() { if (this.target) registrations.delete(this.target); }
  }
  vi.stubGlobal("ResizeObserver", Observer);
  const { result } = renderHook(() => useEmailTemplateView());
  expect(result.current.paneWidth).toBe(880);
  const frame = document.createElement("div");
  act(() => result.current.frameRef(frame));
  const resize = registrations.get(frame);
  if (!resize) throw new Error("The preview frame was not observed");
  act(() => resize([{ target: frame, contentRect: { width: 714 } }]));
  expect(result.current.paneWidth).toBe(714);
  act(() => resize([{ target: frame, contentRect: { width: 502 } }]));
  expect(result.current.paneWidth).toBe(502);
  act(() => result.current.frameRef(null));
  expect(registrations.size).toBe(0);
});
