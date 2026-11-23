// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publishContentRefresh, resetContentRefreshBus } from "../../lib/content-refresh-bus.js";
import { useContentRefreshSubscription } from "../use-content-refresh-subscription.hooks.js";

/**
 * @file `useContentRefreshSubscription` — driven through the REAL `lib/content-refresh-bus`, same
 * choice `use-taxonomy.hooks.ts`'s own content-refresh suite makes and for the same reason (see that
 * file's header): the thing worth asserting is the wiring between this hook and the bus, not either
 * module's internals in isolation.
 */

afterEach(() => resetContentRefreshBus());

it("calls onRefresh when an unscoped (\"refresh everything\") notification fires", () => {
  const onRefresh = vi.fn();
  renderHook(() => useContentRefreshSubscription({ resource: "posts", onRefresh }));

  publishContentRefresh();

  expect(onRefresh).toHaveBeenCalledTimes(1);
});

it("calls onRefresh when the notification names this resource", () => {
  const onRefresh = vi.fn();
  renderHook(() => useContentRefreshSubscription({ resource: "posts", onRefresh }));

  publishContentRefresh(["posts"]);

  expect(onRefresh).toHaveBeenCalledTimes(1);
});

it("ignores a notification that names only other resources", () => {
  const onRefresh = vi.fn();
  renderHook(() => useContentRefreshSubscription({ resource: "posts", onRefresh }));

  publishContentRefresh(["taxonomy"]);

  expect(onRefresh).not.toHaveBeenCalled();
});

it("stops calling onRefresh once unmounted", () => {
  const onRefresh = vi.fn();
  const { unmount } = renderHook(() => useContentRefreshSubscription({ resource: "posts", onRefresh }));

  unmount();
  publishContentRefresh();

  expect(onRefresh).not.toHaveBeenCalled();
});

describe("resubscription", () => {
  it("re-subscribes under the new resource when `resource` changes, dropping the old one", () => {
    const onRefresh = vi.fn();
    const { rerender } = renderHook(({ resource }) => useContentRefreshSubscription({ resource, onRefresh }), {
      initialProps: { resource: "posts" },
    });

    rerender({ resource: "pages" });
    publishContentRefresh(["posts"]);
    expect(onRefresh).not.toHaveBeenCalled();

    publishContentRefresh(["pages"]);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

it("uses the latest onRefresh callback for the same resource", () => {
  const oldRefresh = vi.fn();
  const newRefresh = vi.fn();
  const { rerender } = renderHook(({ onRefresh }) => useContentRefreshSubscription({ resource: "posts", onRefresh }), {
    initialProps: { onRefresh: oldRefresh },
  });
  rerender({ onRefresh: newRefresh });
  publishContentRefresh(["posts"]);
  expect(oldRefresh).not.toHaveBeenCalled();
  expect(newRefresh).toHaveBeenCalledTimes(1);
});
