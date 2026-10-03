// @vitest-environment jsdom
// Generalized existing router regression cases; legacy host URL rewriting is host policy.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminHref } from '../../core/routing/rules.js';
import { navigate, readRoutePath } from '../navigation.js';
function at(url: string) { window.history.replaceState(null, '', url); }
beforeEach(() => at('/admin/'));
afterEach(() => at('/'));

describe("navigate does not stack duplicate history entries", () => {
  it("no-ops when the target is the current URL", () => {
    at("/admin/settings");
    const before = window.history.length;
    navigate({ window, routePath: "/settings" });
    navigate({ window, routePath: "/settings" });
    navigate({ window, routePath: "/settings" });
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe("/admin/settings");
  });

  it("no-ops across a trailing-slash difference, which routes to the same screen", () => {
    // `parseRoute` drops empty segments, so `/admin/settings/` and `/admin/settings` are one screen.
    at("/admin/settings/");
    const before = window.history.length;
    navigate({ window, routePath: "/settings" });
    expect(window.history.length).toBe(before);
  });

  it("no-ops for a path the browser percent-encodes", () => {
    // `pushState` stores a normalized URL, so comparing raw strings never matched here and the guard
    // silently failed for anything containing a space or non-ASCII character.
    at("/admin/collections/my recipe");
    const before = window.history.length;
    navigate({ window, routePath: "/collections/my recipe" });
    expect(window.history.length).toBe(before);
  });

  it("still navigates when only the query differs", () => {
    at("/admin/widgets/new?type=text");
    navigate({ window, routePath: "/widgets/new?type=image" });
    expect(window.location.search).toBe("?type=image");
  });
});

describe("route path vs URL", () => {
  it("adminHref applies the base once", () => {
    expect(adminHref({ routePath: "/settings" })).toBe("/admin/settings");
    expect(adminHref({ routePath: "/" })).toBe("/admin/");
  });

  it("currentRoutePath strips the base, with or without a trailing slash", () => {
    at("/admin");
    expect(readRoutePath({ window })).toBe("/");
    at("/admin/");
    expect(readRoutePath({ window })).toBe("/");
    at("/admin/posts/abc");
    expect(readRoutePath({ window })).toBe("/posts/abc");
  });
});

