import { describe, expect, it } from "vitest";

import { publishScopeDescriptionKey, publishScopeTitleKey, type PublishScopeSection } from "../publish-scope.js";

/**
 * @file The pure label rules behind the Publish dialog's title and description, against a fixture
 * section table standing in for the host's (the host injects `sectionForEntityTypes`).
 */

const SECTIONS: readonly (PublishScopeSection & { entityTypes: readonly string[] })[] = [
  { entityTypes: ["page"], labelKey: "Publish pages", descriptionKey: "Sends your pages to the live site." },
  { entityTypes: ["widget", "widget-area"], labelKey: "Publish widgets", descriptionKey: "Sends your widgets to the live site." },
];

function sectionForEntityTypes({ entityTypes }: { entityTypes: readonly string[] }): PublishScopeSection | undefined {
  const wanted = new Set(entityTypes);
  return SECTIONS.find((s) => s.entityTypes.length === wanted.size && s.entityTypes.every((t) => wanted.has(t)));
}

const ALL = "Sends your posts, pages and media to the live site. Deploy ships code; publish ships content.";

describe("publishScopeTitleKey", () => {
  it("reads an absent scope or an absent entityTypes as publishing everything", () => {
    expect(publishScopeTitleKey({ scope: undefined, sectionForEntityTypes })).toBe("Publish all content");
    expect(publishScopeTitleKey({ scope: {}, sectionForEntityTypes })).toBe("Publish all content");
  });

  it("reads one section's whole entity-type set as that section's label, in any order", () => {
    expect(publishScopeTitleKey({ scope: { entityTypes: ["page"] }, sectionForEntityTypes })).toBe("Publish pages");
    expect(publishScopeTitleKey({ scope: { entityTypes: ["widget-area", "widget"] }, sectionForEntityTypes })).toBe("Publish widgets");
  });

  it("lets non-empty entityKeys win as a single-item publish", () => {
    expect(publishScopeTitleKey({ scope: { entityTypes: ["page"], entityKeys: ["page:1"] }, sectionForEntityTypes })).toBe("Publish item");
  });

  it("treats an empty entityKeys as absent", () => {
    expect(publishScopeTitleKey({ scope: { entityTypes: ["page"], entityKeys: [] }, sectionForEntityTypes })).toBe("Publish pages");
  });

  it("falls back to everything when no section matches exactly", () => {
    expect(publishScopeTitleKey({ scope: { entityTypes: ["page", "post"] }, sectionForEntityTypes })).toBe("Publish all content");
    expect(publishScopeTitleKey({ scope: { entityTypes: ["widget"] }, sectionForEntityTypes })).toBe("Publish all content");
  });
});

describe("publishScopeDescriptionKey", () => {
  it("names only what the dialog sends, through the same resolution as the title", () => {
    expect(publishScopeDescriptionKey({ scope: undefined, sectionForEntityTypes })).toBe(ALL);
    expect(publishScopeDescriptionKey({ scope: { entityTypes: ["page", "post"] }, sectionForEntityTypes })).toBe(ALL);
    expect(publishScopeDescriptionKey({ scope: { entityTypes: ["page"] }, sectionForEntityTypes })).toBe("Sends your pages to the live site.");
    expect(publishScopeDescriptionKey({ scope: { entityTypes: ["page"], entityKeys: ["page:1"] }, sectionForEntityTypes })).toBe("Sends this item to the live site.");
  });
});
