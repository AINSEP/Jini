import { expect, it, vi } from "vitest";
import { createCustomCredentialConnectionPort } from "../connection-port.js";
import { createFormDestinationPort } from "../port.js";

it("a renamed label cannot leak a different credential", async () => {
  const resolveByLabel = vi.fn(async () => ({ id: "different", connection: { token: "private" }, baseUrl: "https://api.example" }));
  const port = createCustomCredentialConnectionPort({ findById: async () => ({ label: "renamed", worksFor: ["adapter"] }), resolveByLabel });
  expect(await port({ workspaceId: "ws", connectionRef: "original", adapterId: "adapter" })).toBeNull();
  expect(resolveByLabel).toHaveBeenCalledWith({ workspaceId: "ws", label: "renamed" });
});

it("an unapproved adapter does not open a secret", async () => {
  const resolveByLabel = vi.fn();
  const port = createCustomCredentialConnectionPort({ findById: async () => ({ label: "card", worksFor: ["other"] }), resolveByLabel });
  expect(await port({ workspaceId: "ws", connectionRef: "original", adapterId: "ADAPTER" })).toBeNull();
  expect(resolveByLabel).not.toHaveBeenCalled();
});

it("form-less preview never creates a receiver key", async () => {
  const formReceiverKey = vi.fn();
  const loadRegistry = vi.fn();
  const port = createFormDestinationPort({ listForms: async () => [], hasExistingKey: async () => true,
    readExistingKey: async () => "existing", resolveCredential: vi.fn(), formReceiverKey,
    loadRegistry, readSetting: vi.fn(), noReceiverMessage: () => "off", missingCredentialMessage: () => "missing" });
  const input = { workspaceId: "ws", hostingTargetId: "host", projectName: "project", kit: { fetch: vi.fn(), timeouts: {} } };
  expect(await port.previewInput(input)).toEqual({ hosting: { forms: [] } });
  expect(await port.prepare(input)).toEqual({ hosting: { forms: [], secret: "existing" } });
  expect(formReceiverKey).not.toHaveBeenCalled();
  expect(loadRegistry).not.toHaveBeenCalled();
});
