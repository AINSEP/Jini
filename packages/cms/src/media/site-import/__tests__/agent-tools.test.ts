import { describe, expect, it } from "vitest";
import { buildMediaGenerationAgentToolCatalog } from "../../site-generation/agent-tools.js";
import { buildMediaImportAgentToolCatalog } from "../agent-tools.js";

const importCatalog = () => buildMediaImportAgentToolCatalog({ fsRootIds: ["site", "custom"], fsFolderReadRecovery: "Ask the owner.", mediaAssetReadToolId: "read_asset" });
const toolSchema = (name: string) => {
  const tool = importCatalog().find((t) => t.name === name);
  return tool?.inputSchema as { additionalProperties: boolean; properties: Record<string, { type: string; description: string }> };
};

describe("media import and generation catalogs accept a factual description", () => {
  it.each(["media_import_from_url", "media_import_local_file"])("%s offers an optional string description of the picture", (name) => {
    const schema = toolSchema(name);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.description?.type).toBe("string");
    expect(schema.properties.description?.description).toMatch(/factual/i);
    expect(schema.properties.description?.description).toMatch(/never the (generation )?prompt/i);
    expect((importCatalog().find((t) => t.name === name)?.inputSchema as { required: string[] }).required).not.toContain("description");
  });

  it("media_generate_asset offers description and keeps it distinct from the generation prompt", () => {
    const tool = buildMediaGenerationAgentToolCatalog({ imageModelIds: ["m1"], mediaAssetReadToolId: "read_asset" })[0];
    const props = (tool?.inputSchema as { properties: Record<string, { type: string; description: string }>; required: string[] }).properties;
    expect(props.description?.type).toBe("string");
    expect(props.description?.description).toMatch(/never the (generation )?prompt/i);
    expect((tool?.inputSchema as { required: string[] }).required).toEqual(["prompt"]);
  });

  it("does not leak a host or product name into the description guidance", () => {
    const text = JSON.stringify([toolSchema("media_import_from_url").properties.description, toolSchema("media_import_local_file").properties.description]);
    expect(text).not.toMatch(/tovu|media_update_metadata/i);
  });

  it("media_replace_file shares no description input (it replaces bytes, not metadata)", () => {
    expect(toolSchema("media_replace_file").properties.description).toBeUndefined();
  });
});
