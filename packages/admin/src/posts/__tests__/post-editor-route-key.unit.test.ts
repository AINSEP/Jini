import { describe, expect, it } from "vitest";

import { postEditorRouteKey, rememberPostEditorRouteRename } from "../post-editor-route-key.js";

/** @file `post-editor-route-key.ts` — a save-driven slug rename keeps the editor's panel key. */
describe("postEditorRouteKey", () => {
  it("is the segment itself until a rename is recorded", () => {
    expect(postEditorRouteKey({ segment: "key-test-plain" })).toBe("key-test-plain");
  });

  it("maps a renamed slug back to the original key, through a chain of renames", () => {
    rememberPostEditorRouteRename({ from: "key-test-untitled-6", to: "key-test-first" });
    rememberPostEditorRouteRename({ from: "key-test-first", to: "key-test-second" });
    expect(postEditorRouteKey({ segment: "key-test-first" })).toBe("key-test-untitled-6");
    expect(postEditorRouteKey({ segment: "key-test-second" })).toBe("key-test-untitled-6");
  });

  it("ignores a no-op rename", () => {
    rememberPostEditorRouteRename({ from: "key-test-same", to: "key-test-same" });
    expect(postEditorRouteKey({ segment: "key-test-same" })).toBe("key-test-same");
  });
});
