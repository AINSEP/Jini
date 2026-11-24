import { describe, expect, it } from "vitest";

import { isWorkspaceDirty } from "../rules.js";

/** @file The rename form's dirty-state rule (the host keeps its error-copy overrides and their tests). */

const WORKSPACE = { name: "My Site", slug: "my-site" };

describe("isWorkspaceDirty", () => {
  it("is false when the draft matches the persisted workspace exactly", () => {
    expect(isWorkspaceDirty({ workspace: WORKSPACE, name: "My Site", slug: "my-site" })).toBe(false);
  });

  it("is true when the draft name differs", () => {
    expect(isWorkspaceDirty({ workspace: WORKSPACE, name: "New Name", slug: "my-site" })).toBe(true);
  });

  it("is true when the draft slug differs", () => {
    expect(isWorkspaceDirty({ workspace: WORKSPACE, name: "My Site", slug: "new-slug" })).toBe(true);
  });

  it("is true when both differ", () => {
    expect(isWorkspaceDirty({ workspace: WORKSPACE, name: "New Name", slug: "new-slug" })).toBe(true);
  });
});
