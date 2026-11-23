import assert from "node:assert/strict";
import { test } from "vitest";

import { mediaAgentToolCatalog } from "../agent-tools.js";
import { MEDIA_MAX_DESCRIPTION_LENGTH } from "../media-service.js";

function tool(name: string) {
  const found = mediaAgentToolCatalog.find((entry) => entry.name === name);
  assert.ok(found?.inputSchema, `${name} must be in the catalog with an input schema`);
  return { description: found.description, properties: found.inputSchema.properties as Record<string, Record<string, unknown>> };
}

/** Media descriptions for semantic search: agents can write a description and are told search reads it. */
test("media_update_metadata accepts a bounded plain-language description", () => {
  assert.deepEqual(tool("media_update_metadata").properties.description, {
    type: "string",
    maxLength: MEDIA_MAX_DESCRIPTION_LENGTH,
    description: "Plain-language description of what the media shows, used by search.",
  });
});

test("media_list_assets tells agents that search matches the description", () => {
  const list = tool("media_list_assets");
  assert.match(list.description, /\bdescription\b/);
  assert.match(String(list.properties.query?.description), /\bdescription\b/);
});
