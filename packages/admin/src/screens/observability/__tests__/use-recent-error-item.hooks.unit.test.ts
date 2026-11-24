// @vitest-environment jsdom
import { act, renderHook as renderHookOriginal, type RenderHookOptions } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "@jini-ai/ui";

import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { createFakeRecentServerErrorsPort } from "../hooks/recent-server-errors-dependencies.hooks.js";
import { useRecentErrorItem as useRecentErrorItemHost } from "../hooks/use-recent-error-item.hooks.js";

// The host binds the UI library's copy hook (its 1.5s "Copied" reset) into this kit slot.
const kit = fakeAdminKit({ hooks: { useCopyToClipboard } });
const wrapper = ({ children }: { children: ReactNode }) => createElement(AdminKitProvider, { kit, children });
function renderHook<Result, Props>(callback: (props: Props) => Result, options: RenderHookOptions<Props> = {}) {
  return renderHookOriginal(callback, { wrapper, ...options });
}

// The host injects the copy hook; the tests inject the UI library's.
function useRecentErrorItem(args: { copyText: string; clipboard: ReturnType<typeof createFakeRecentServerErrorsPort> }) {
  return useRecentErrorItemHost({ ...args, useCopyToClipboardHook: useCopyToClipboard });
}

/** @file One Recent errors row's state — disclosure and Copy feedback — against the fake port. */

afterEach(() => {
  vi.useRealTimers();
});

describe("useRecentErrorItem", () => {
  it("starts collapsed with a detail id, and toggle opens and closes it", () => {
    const { result } = renderHook(() => useRecentErrorItem({ copyText: "Time: x", clipboard: createFakeRecentServerErrorsPort() }));
    expect(result.current.expanded).toBe(false);
    expect(result.current.detailId).not.toBe("");
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
  });

  it("copies the row's text, flips copied on, then back off", async () => {
    vi.useFakeTimers();
    const clipboard = createFakeRecentServerErrorsPort();
    const { result } = renderHook(() => useRecentErrorItem({ copyText: "Time: x\nMessage:\nboom", clipboard }));

    await act(async () => {
      await expect(result.current.copy()).resolves.toBe(true);
    });
    expect(clipboard.copied).toEqual(["Time: x\nMessage:\nboom"]);
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.copied).toBe(false);
  });

  it("does not claim Copied when the browser refused the copy", async () => {
    const clipboard = createFakeRecentServerErrorsPort({ copyResult: false });
    const { result } = renderHook(() => useRecentErrorItem({ copyText: "x", clipboard }));
    await act(async () => {
      await expect(result.current.copy()).resolves.toBe(false);
    });
    expect(clipboard.copied).toEqual(["x"]);
    expect(result.current.copied).toBe(false);
  });
});
