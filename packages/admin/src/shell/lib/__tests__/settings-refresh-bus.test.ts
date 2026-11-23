import { afterEach, expect, test, vi } from "vitest";

import { publishSettingsRefresh, resetSettingsRefreshBus, subscribeToSettingsRefresh } from "../settings-refresh-bus.js";
import { spyShellFailures } from "./shell-failure-log.fakes.js";

/**
 * @file The bus between "settings changed elsewhere" and the mounted tabs.
 *
 * Two publishers reach it (a finished assistant run, an SSE frame) and every settings slice
 * subscribes, so the failure modes worth pinning are the ones that would silently stop updates:
 * a listener that outlives its component, and one broken subscriber taking the rest down with it.
 */

afterEach(() => resetSettingsRefreshBus());

test("delivers to every subscriber", () => {
  const seen: string[] = [];
  subscribeToSettingsRefresh(() => seen.push("a"));
  subscribeToSettingsRefresh(() => seen.push("b"));

  publishSettingsRefresh();

  expect(seen).toEqual(["a", "b"]);
});

test("passes namespaces through, and normalizes 'no information' to null", () => {
  const scopes: unknown[] = [];
  subscribeToSettingsRefresh((scope) => scopes.push(scope));

  publishSettingsRefresh(["core.language"]);
  publishSettingsRefresh();
  // An empty array means the publisher knew of no namespaces, which is not the same as "only these
  // zero" — it must not be mistaken for a scope that matches nothing, or the refresh is dropped.
  publishSettingsRefresh([]);

  expect(scopes).toEqual([["core.language"], null, null]);
});

test("unsubscribing stops delivery", () => {
  const listener = vi.fn();
  const dispose = subscribeToSettingsRefresh(listener);

  publishSettingsRefresh();
  dispose();
  publishSettingsRefresh();

  expect(listener).toHaveBeenCalledTimes(1);
});

test("one throwing subscriber does not suppress the others", () => {
  const errors = spyShellFailures();
  const survivor = vi.fn();

  subscribeToSettingsRefresh(() => {
    throw new Error("settings tab blew up");
  });
  subscribeToSettingsRefresh(survivor);

  // Publishers are transport/lifecycle code — an SSE frame, a run ending — with no sensible way to
  // handle one settings tab's failure.
  expect(() => publishSettingsRefresh()).not.toThrow();
  expect(survivor).toHaveBeenCalledTimes(1);
  expect(errors).toHaveBeenCalledTimes(1);

  errors.mockRestore();
});

test("a subscriber added during a publish does not receive that same publish", () => {
  const seen: string[] = [];
  subscribeToSettingsRefresh(() => {
    seen.push("first");
    subscribeToSettingsRefresh(() => seen.push("late"));
  });

  publishSettingsRefresh();

  // Publishing iterates a snapshot rather than the live Set. Without that this is an infinite
  // loop, not a subtle ordering question.
  expect(seen).toEqual(["first"]);

  publishSettingsRefresh();
  expect(seen).toEqual(["first", "first", "late"]);
});
