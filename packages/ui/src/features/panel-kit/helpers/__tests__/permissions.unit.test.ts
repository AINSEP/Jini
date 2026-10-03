import { describe, expect, it } from "vitest";

import { hasPermission } from "../permissions";

/**
 * @file `hasPermission()` — pins the wildcard-affordance bug fix (owner's `["*"]` grant was
 * being checked with a literal `.includes()` in `Settings.tsx`/`Comments.tsx`, so the wildcard
 * never matched any real permission name and the workspace owner lost every gated affordance).
 */

describe("hasPermission", () => {
  it("grants access to an owner holding the unconstrained wildcard, for any permission asked", () => {
    expect(hasPermission({ permissions: ["*"], permission: "comments.read" })).toBe(true);
    expect(hasPermission({ permissions: ["*"], permission: "settings.global.write" })).toBe(true);
    expect(hasPermission({ permissions: ["*"], permission: "anything.at.all" })).toBe(true);
  });

  it("grants access for exactly the permission a specific grant names, and no other", () => {
    expect(hasPermission({ permissions: ["comments.read"], permission: "comments.read" })).toBe(true);
    expect(hasPermission({ permissions: ["comments.read"], permission: "comments.configure" })).toBe(false);
  });

  it("denies a principal holding neither the wildcard nor the requested permission", () => {
    expect(hasPermission({ permissions: [], permission: "comments.read" })).toBe(false);
    expect(hasPermission({ permissions: ["comments.moderate"], permission: "comments.read" })).toBe(false);
  });

  it("pins the near-miss: a concrete grant must never satisfy a request for the literal wildcard string", () => {
    // The regression this guards against is a helper that checks "*" on the wrong side of the
    // comparison -- e.g. treating `permission === "*"` as "any permission works" instead of "the
    // caller holds an actual wildcard grant". `hasPermission(["posts.read"], "*")` would pass
    // every case above even with that inversion, so it needs its own assertion: holding
    // `posts.read` (a real, specific grant) must not be read as holding `"*"` itself.
    expect(hasPermission({ permissions: ["posts.read"], permission: "*" })).toBe(false);
    // Same shape with no grants at all.
    expect(hasPermission({ permissions: [], permission: "*" })).toBe(false);
  });
});
