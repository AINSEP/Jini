// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPublishRequestStore } from "../publish-request.store.js";

interface Result {
  opened: boolean;
  planned: boolean;
  site: string | null;
  willPublish: string[];
  willOverwrite: string[];
  leftAlone: { label: string; reason: string }[];
  unmatchedItems: string[];
  unknownTypes: string[];
  nextStep: string;
}

const unplannedResult = (): Result => ({
  opened: true,
  planned: false,
  site: null,
  willPublish: [],
  willOverwrite: [],
  leftAlone: [],
  unmatchedItems: [],
  unknownTypes: [],
  nextStep: "The Publish dialog was closed before it could work out what would be published.",
});
const liveSiteResult = (): Result => ({
  ...unplannedResult(),
  opened: false,
  nextStep: "This is the live site, so there is nowhere to publish to. Publish from your local copy of the site instead.",
});

let available = true;
const { closePublishRequest, requestPublish, usePublishRequest } = createPublishRequestStore<
  { types?: string[] },
  { entityTypes: string[] },
  Result
>({ isPublishToLiveAvailable: () => available, unplannedResult, liveSiteResult });

/**
 * @file `publish-criteria-tool-webmcp-plan-2026-09-24.md` §4 S2's `publish-request.store.ts` — the
 * app-level store the host's app root reads to decide whether (and with what criteria) to mount
 * `PublishContentDialog`. Nothing here touches a port or a plan; see the store's own file header.
 */

describe("publish-request.store", () => {
  beforeEach(() => closePublishRequest());
  afterEach(() => {
    closePublishRequest();
    available = true;
  });

  it("on the live site resolves without opening anything, reading the host's flag on every ask", async () => {
    const { result } = renderHook(() => usePublishRequest());
    available = false;
    let pending!: ReturnType<typeof requestPublish>;
    act(() => {
      pending = requestPublish({ types: ["page"] });
    });
    expect(result.current).toBeNull();
    expect(await pending).toEqual({
      opened: false,
      planned: false,
      site: null,
      willPublish: [],
      willOverwrite: [],
      leftAlone: [],
      unmatchedItems: [],
      unknownTypes: [],
      nextStep: "This is the live site, so there is nowhere to publish to. Publish from your local copy of the site instead.",
    });
    available = true;
    act(() => {
      void requestPublish({ types: ["page"] });
    });
    expect(result.current?.criteria).toEqual({ types: ["page"] });
  });

  it("two stores never share an open request", () => {
    const other = createPublishRequestStore({ isPublishToLiveAvailable: () => true, unplannedResult, liveSiteResult });
    const { result } = renderHook(() => other.usePublishRequest());
    act(() => {
      void requestPublish({ types: ["page"] });
    });
    expect(result.current).toBeNull();
  });

  it("uses an empty server snapshot even while a client publish request is open", async () => {
    const { result } = renderHook(() => usePublishRequest());
    let pending!: ReturnType<typeof requestPublish>;
    act(() => {
      pending = requestPublish({ types: ["page"] });
    });
    const clientRequest = result.current;
    expect(clientRequest?.criteria).toEqual({ types: ["page"] });

    function RequestState() {
      const request = usePublishRequest();
      return createElement("span", null, request === null ? "No publish request" : "Publish request open");
    }

    expect(renderToString(createElement(RequestState))).toBe("<span>No publish request</span>");
    expect(result.current).toBe(clientRequest);

    act(() => closePublishRequest());
    expect(result.current).toBeNull();
    expect(await pending).toMatchObject({ opened: true, planned: false });
  });

  it("requestPublish({types:['page']}) sets the open request", () => {
    const { result } = renderHook(() => usePublishRequest());
    expect(result.current).toBeNull();

    act(() => {
      void requestPublish({ types: ["page"] });
    });

    expect(result.current).not.toBeNull();
    expect(result.current?.criteria).toEqual({ types: ["page"] });
    expect(typeof result.current?.requestId).toBe("string");
  });

  it("a second call replaces it with a new requestId", () => {
    const { result } = renderHook(() => usePublishRequest());

    act(() => {
      void requestPublish({ types: ["page"] });
    });
    const first = result.current;

    act(() => {
      void requestPublish({ types: ["menu"] });
    });
    const second = result.current;

    expect(second?.criteria).toEqual({ types: ["menu"] });
    expect(second?.requestId).not.toBe(first?.requestId);
  });

  it("a second call settles the first request's own promise, so no caller waits forever", async () => {
    const { result } = renderHook(() => usePublishRequest());

    let firstResult: Awaited<ReturnType<typeof requestPublish>> | undefined;
    act(() => {
      void requestPublish({ types: ["page"] }).then((r) => {
        firstResult = r;
      });
    });

    await act(async () => {
      void requestPublish({ types: ["menu"] });
      await Promise.resolve();
    });

    expect(firstResult).toEqual(
      expect.objectContaining({ opened: true, planned: false })
    );
  });

  it("close() resolves the pending promise with opened:true", async () => {
    const { result } = renderHook(() => usePublishRequest());

    let settled: Awaited<ReturnType<typeof requestPublish>> | undefined;
    act(() => {
      void requestPublish({}).then((r) => {
        settled = r;
      });
    });
    expect(result.current).not.toBeNull();

    await act(async () => {
      closePublishRequest();
      await Promise.resolve();
    });

    expect(result.current).toBeNull();
    expect(settled?.opened).toBe(true);
    expect(settled?.planned).toBe(false);
  });

  it("closing with nothing open is a no-op", () => {
    const { result } = renderHook(() => usePublishRequest());
    expect(() => closePublishRequest()).not.toThrow();
    expect(result.current).toBeNull();
  });

  // plan-publish-sections-2026-09-25.md §2 S2 — a section button's `requestPublish({}, scope)` must
  // carry the scope through to whoever mounts the dialog from this store, same as `criteria` already
  // does.
  it("requestPublish({}, {entityTypes:['page']}) carries the scope on the open request", () => {
    const { result } = renderHook(() => usePublishRequest());

    act(() => {
      void requestPublish({}, { entityTypes: ["page"] });
    });

    expect(result.current?.scope).toEqual({ entityTypes: ["page"] });
  });

  it("requestPublish with no scope argument leaves scope undefined, not an empty object", () => {
    const { result } = renderHook(() => usePublishRequest());

    act(() => {
      void requestPublish({ types: ["page"] });
    });

    expect(result.current?.scope).toBeUndefined();
  });
});
