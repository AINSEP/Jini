import { describe, it, expect } from "vitest";

import { contentEditPermission, createLiveCollectionTermPolicy } from "../content-targets.js";
import { toolMetadata } from "../tool-metadata.js";

describe("site taxonomy content targets", () => {
  it("never lets widget types carry terms and accepts any live collection", async () => {
    const policy = createLiveCollectionTermPolicy({ workspaceId: "ws", contentTypeRepo: { findByKey: async () => ({ status: "active" }) } });
    expect(await policy.taxonomiesFor({ contentType: "widget" })).toBeNull();
    expect(await policy.taxonomiesFor({ contentType: "widget_area" })).toBeNull();
    expect(await policy.taxonomiesFor({ contentType: "recipe" })).toBe("all");
  });

  it("maps post/page to content.write and collection entries to admin.collections.manage", () => {
    expect(contentEditPermission({ contentType: "post" })).toBe("content.write");
    expect(contentEditPermission({ contentType: "page" })).toBe("content.write");
    expect(contentEditPermission({ contentType: "recipe" })).toBe("admin.collections.manage");
  });
});

describe("site taxonomy tool metadata", () => {
  it("asks for a plan only before the irreversible merge", () => {
    const asking = Object.entries(toolMetadata).filter(([, meta]) => meta.approval.confirmation === "plan").map(([id]) => id);
    expect(asking).toEqual(["taxonomy_execute_merge_term"]);
    expect(toolMetadata.taxonomy_execute_merge_term.approval.class).toBe("delete");
    expect(toolMetadata.taxonomy_list.approval).toEqual({ class: "read", confirmation: "direct" });
  });
});
