import type { ToolRegistration } from "@jini-ai/core";
import { expect, it } from "vitest";
import { withLargeUploadRouting } from "../large-upload-routing.js";

const registration: ToolRegistration = {
  descriptor: { id: "media_upload_asset", description: "Upload bytes.", inputSchema: { type: "object" }, requiresConfirmation: true },
  handler: async () => ({}),
  policy: { authorize: () => "allow" },
};

it("appends injected routing text to the upload tool, preserving fields and handler identity", () => {
  const result = withLargeUploadRouting({ registration, routingText: "Use another path." });
  expect(result.descriptor).toEqual({ ...registration.descriptor, description: "Upload bytes. Use another path." });
  expect(result.handler).toBe(registration.handler);
  expect(result.policy).toBe(registration.policy);
  expect(registration.descriptor.description).toBe("Upload bytes.");
});

it("returns another tool by identity", () => {
  const other: ToolRegistration = { ...registration, descriptor: { ...registration.descriptor, id: "media_list_assets" } };
  expect(withLargeUploadRouting({ registration: other, routingText: "Use another path." })).toBe(other);
});

it("does not add a leading space when the original description is empty", () => {
  const empty: ToolRegistration = { ...registration, descriptor: { ...registration.descriptor, description: "" } };
  expect(withLargeUploadRouting({ registration: empty, routingText: "Use another path." }).descriptor.description).toBe("Use another path.");
});
