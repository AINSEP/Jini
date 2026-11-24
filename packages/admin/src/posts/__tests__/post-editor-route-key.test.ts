import { describe, expect, it } from "vitest";

import { createPostEditorRouteKeyStore } from "../post-editor-route-key.js";

/** @file `post-editor-route-key.ts` — a save-driven slug rename keeps the editor's panel key. */
describe("createPostEditorRouteKeyStore", () => {
  it("is the segment itself until a rename is recorded", () => {
    expect(createPostEditorRouteKeyStore().routeKey({ segment: "key-test-plain" })).toBe("key-test-plain");
  });

  it("maps a renamed slug back to the original key, through a chain of renames", () => {
    const store = createPostEditorRouteKeyStore();
    store.rememberRename({ from: "untitled-6", to: "first" });
    store.rememberRename({ from: "first", to: "second" });
    expect(store.routeKey({ segment: "first" })).toBe("untitled-6");
    expect(store.routeKey({ segment: "second" })).toBe("untitled-6");
  });

  it("ignores a no-op rename", () => {
    const store = createPostEditorRouteKeyStore();
    store.rememberRename({ from: "same", to: "same" });
    expect(store.routeKey({ segment: "same" })).toBe("same");
  });

  it("gives each new post its own draft key, handed to the slug on first Save and then retired", () => {
    const store = createPostEditorRouteKeyStore();
    expect(store.routeKey({ segment: "" })).toBe("new-post-draft:1");
    expect(store.routeKey({ segment: "" })).toBe("new-post-draft:1");
    store.rememberRename({ from: "", to: "post-a" });
    expect(store.routeKey({ segment: "post-a" })).toBe("new-post-draft:1");
    expect(store.routeKey({ segment: "" })).toBe("new-post-draft:2");
    store.rememberRename({ from: "", to: "post-b" });
    expect(store.routeKey({ segment: "post-b" })).toBe("new-post-draft:2");
    expect(store.routeKey({ segment: "post-a" })).toBe("new-post-draft:1");
  });

  it("keeps two stores independent so one host instance never leaks keys into another", () => {
    const one = createPostEditorRouteKeyStore();
    const other = createPostEditorRouteKeyStore();
    one.rememberRename({ from: "", to: "leak" });
    expect(other.routeKey({ segment: "leak" })).toBe("leak");
    expect(other.routeKey({ segment: "" })).toBe("new-post-draft:1");
  });
});
