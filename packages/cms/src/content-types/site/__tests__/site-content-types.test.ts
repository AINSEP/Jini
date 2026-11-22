import { describe, it, expect } from "vitest";

import { SYSTEM_CONTENT_TYPES } from "../system-content-types.js";
import { DECLARED_CONTENT_TYPE_OWNERS, declaredOwnerFor } from "../declared-content-type-owners.js";
import { toolMetadata } from "../tool-metadata.js";

/** @file Characterizes the site content-type vocabulary: system types, declared owners, tool metadata. */
describe("site content-types vocabulary", () => {
  it("lists the platform-plumbing types a collection list must never resolve", () => {
    expect(SYSTEM_CONTENT_TYPES).toEqual(["widget", "widget_area", "menu"]);
  });

  it("declares widget envelope owners and leaves every other type site-owned", () => {
    expect(DECLARED_CONTENT_TYPE_OWNERS).toEqual({ widget: "widget", widget_area: "widgets" });
    expect(Object.isFrozen(DECLARED_CONTENT_TYPE_OWNERS)).toBe(true);
    expect(declaredOwnerFor({ key: "widget_area" })).toBe("widgets");
    expect(declaredOwnerFor({ key: "post" })).toBeUndefined();
    expect(declaredOwnerFor({ key: "toString" })).toBeUndefined();
  });

  it("declares metadata for exactly the content-type tool catalog", () => {
    expect(Object.keys(toolMetadata).sort()).toEqual([
      "collections_content_type_define",
      "collections_content_type_deprecate",
      "collections_content_type_list",
      "collections_content_type_reactivate",
      "collections_content_type_tombstone",
      "collections_content_type_update_fields",
      "collections_execute_cleanup",
      "collections_plan_cleanup",
    ]);
  });
});
