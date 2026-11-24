import { describe, expect, expectTypeOf, it } from "vitest";
import { createPermanentDeleteAgentToolCatalog, createPermanentDeleteSpecs, type PermanentDeleteToolId } from "../agent-tools.js";

const SOURCE = "records_read.saved_credential";
const IDS = [
  "trash_empty", "trash_purge_item", "media_purge_asset", "comments_purge_comment", "identity_user_delete",
  "external_mcp_delete", "custom_credential_delete", "deployment_delete_provider_credential", "source_control_delete_credential",
] as const;

describe("createPermanentDeleteSpecs", () => {
  const specs = createPermanentDeleteSpecs({ customCredentialIdSource: SOURCE });

  it("keeps the tool id a literal union", () => {
    expectTypeOf<PermanentDeleteToolId>().toEqualTypeOf<(typeof IDS)[number]>();
    expect(specs.map((s) => s.name)).toEqual(IDS);
  });

  it("names the host-injected credential source in the custom credential guidance", () => {
    expect(specs.find((s) => s.name === "custom_credential_delete")?.guidance).toBe(
      `Use the saved id from ${SOURCE}. Removes only the saved credential; it does not revoke the key at the provider or change the assistant's own model credential.`,
    );
  });

  it("builds one confirmation-gated catalog entry per spec", () => {
    const catalog = createPermanentDeleteAgentToolCatalog({ specs });
    expect(catalog.map((t) => t.name)).toEqual(IDS);
    const custom = catalog.find((t) => t.name === "custom_credential_delete");
    expect(custom?.description.startsWith(`Permanently delete a saved custom provider credential / API token. Use the saved id from ${SOURCE}. `)).toBe(true);
    expect(custom?.description).toContain("the agent cannot self-confirm");
    expect(custom?.inputSchema).toEqual({
      type: "object", additionalProperties: false,
      properties: { credentialId: { type: "string", minLength: 1, description: "The saved custom-credentials id to permanently delete." } },
      required: ["credentialId"],
    });
    expect(catalog[0]?.inputSchema).toEqual({ type: "object", additionalProperties: false, properties: {}, required: [] });
    expect(catalog.every((t) => t.sideEffects === "mutates-durable-state")).toBe(true);
    expect(custom?.authorization).toEqual({ permission: "custom-credentials.write" });
  });
});
