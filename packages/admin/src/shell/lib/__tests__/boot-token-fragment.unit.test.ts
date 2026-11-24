import { expect, it, vi } from "vitest";

import { takeBootToken } from "../boot-token-fragment.js";

/**
 * @file `takeBootToken` — the pure read/strip step for the zip launcher's one-time `#boot=<token>`
 * sign-in link (the host's run-from-zip plan, S2).
 * A fake `Location`/`History` pair is passed directly rather than driving real `window.location` —
 * the function's whole contract is this narrow read/write surface, so exercising it through the real
 * DOM would only add jsdom navigation quirks (see `../router.ts`'s own tests for how those bite)
 * without proving anything more.
 */

function fakeLocationAt(hash: string, pathname = "/admin/", search = "") {
  return { hash, pathname, search };
}

function fakeHistory() {
  return { replaceState: vi.fn() };
}

it("returns null and never touches the URL when there is no hash at all", () => {
  const location = fakeLocationAt("");
  const history = fakeHistory();

  expect(takeBootToken({ location, history })).toBeNull();
  expect(history.replaceState).not.toHaveBeenCalled();
});

it("returns null and never touches the URL when the hash has no `boot` param", () => {
  const location = fakeLocationAt("#foo=bar");
  const history = fakeHistory();

  expect(takeBootToken({ location, history })).toBeNull();
  expect(history.replaceState).not.toHaveBeenCalled();
});

it("returns null and never touches the URL when `boot` is present but empty", () => {
  const location = fakeLocationAt("#boot=");
  const history = fakeHistory();

  expect(takeBootToken({ location, history })).toBeNull();
  expect(history.replaceState).not.toHaveBeenCalled();
});

it("returns the token and strips ONLY `boot` when it is the only hash param", () => {
  const location = fakeLocationAt("#boot=abc123", "/admin/", "");
  const history = fakeHistory();

  expect(takeBootToken({ location, history })).toBe("abc123");
  expect(history.replaceState).toHaveBeenCalledTimes(1);
  expect(history.replaceState).toHaveBeenCalledWith(null, "", "/admin/");
});

it("keeps every other hash param, in place, and preserves pathname + search", () => {
  const location = fakeLocationAt("#boot=abc123&foo=bar", "/admin/settings", "?tab=general");
  const history = fakeHistory();

  expect(takeBootToken({ location, history })).toBe("abc123");
  expect(history.replaceState).toHaveBeenCalledWith(null, "", "/admin/settings?tab=general#foo=bar");
});

it("strips `boot` when it is not the first hash param", () => {
  const location = fakeLocationAt("#foo=bar&boot=abc123");
  const history = fakeHistory();

  expect(takeBootToken({ location, history })).toBe("abc123");
  expect(history.replaceState).toHaveBeenCalledWith(null, "", "/admin/#foo=bar");
});
