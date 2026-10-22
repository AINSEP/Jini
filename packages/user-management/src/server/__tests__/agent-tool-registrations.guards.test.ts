import { describe, expect, it } from "vitest";
import { identityInput, requireIdentityCatalogEntry } from "../agent-tool-registrations.js";

// The two boundary guards that catch a handler drifting from the published catalog. Real handlers
// only ever pass ids and fields their schema declares, so these are driven directly.

describe("identity tool catalog/handler drift guards", () => {
  it("names the missing tool when a handler asks for an id the catalog does not publish", () => {
    expect(() => requireIdentityCatalogEntry({ toolId: "identity_not_a_tool" })).toThrow(
      "agent-tool-registrations: catalog has no entry named 'identity_not_a_tool' — @jini-ai/user-management/server catalog drifted",
    );
    expect(requireIdentityCatalogEntry({ toolId: "identity_user_create" }).name).toBe("identity_user_create");
  });

  it("refuses a required read of a field the published schema leaves optional, and lets opt() report it absent", () => {
    const input = identityInput({ toolId: "identity_user_create", input: { username: "ada", password: "correct horse battery" } });
    expect(input.req("username")).toBe("ada");
    expect(input.opt("email")).toBeUndefined();
    expect(() => input.req("email")).toThrow(
      "identity tool 'identity_user_create': the handler reads 'email' as required, but the published inputSchema does not mark it required — add it to that schema's 'required' list, or read it with opt() and handle its absence",
    );
  });
});
