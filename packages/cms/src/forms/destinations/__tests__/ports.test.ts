import { expect, it, vi } from "vitest";
import { createCustomCredentialConnectionPort } from "../connection-port.js";
import { buildFormDestinationRegistry, type FormDestinationModule } from "../../index.js";
import { createFormDestinationPort, type FormDestinationPortDeps } from "../port.js";

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

it("returns only a fresh matching credential for a permitted adapter, including optional transport metadata", async () => {
  const findById = vi.fn(async () => ({ label: "Relay key", worksFor: ["adapter"] }));
  const resolveByLabel = vi.fn<Parameters<typeof createCustomCredentialConnectionPort>[0]["resolveByLabel"]>()
    .mockResolvedValueOnce({ id: "original", connection: { token: "fixture-token-1", username: "reporter" }, baseUrl: "https://api.example", additionalHosts: ["https://cdn.example"] })
    .mockResolvedValueOnce({ id: "original", connection: { token: "fixture-token-2" }, baseUrl: "https://api.example" })
    .mockResolvedValueOnce(null);
  const resolve = createCustomCredentialConnectionPort({ findById, resolveByLabel });
  const input = { workspaceId: "ws-7", connectionRef: "original", adapterId: "ADAPTER" };
  expect(await resolve(input)).toEqual({ token: "fixture-token-1", username: "reporter", baseUrl: "https://api.example", additionalHosts: ["https://cdn.example"] });
  expect(await resolve(input)).toEqual({ token: "fixture-token-2", baseUrl: "https://api.example" });
  expect(await resolve(input)).toBeNull();
  expect(findById.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ workspaceId: "ws-7", id: "original" }]));
  expect(resolveByLabel.mock.calls).toEqual(Array.from({ length: 3 }, () => [{ workspaceId: "ws-7", label: "Relay key" }]));
});

it("does not open a credential unlisted for any adapter or missing entirely", async () => {
  const findById = vi.fn<Parameters<typeof createCustomCredentialConnectionPort>[0]["findById"]>()
    .mockResolvedValueOnce({ label: "private" }).mockResolvedValueOnce(null);
  const resolveByLabel = vi.fn();
  const resolve = createCustomCredentialConnectionPort({ findById, resolveByLabel });
  const input = { workspaceId: "ws-7", connectionRef: "original", adapterId: "adapter" };
  expect(await resolve(input)).toBeNull();
  expect(await resolve(input)).toBeNull();
  expect(resolveByLabel.mock.calls).toEqual([]);
});

const receiverInput = { workspaceId: "ws-7", hostingTargetId: "host-a", projectName: "newsletter", kit: { fetch: vi.fn(), timeouts: {} } };
const receiving: FormDestinationModule = { pull: async () => ({ items: [], nextAfter: 0, hasMore: false }), ack: async () => ({ acknowledged: 0 }) };
const forms: Awaited<ReturnType<FormDestinationPortDeps["listForms"]>> = [
  { slug: "join", fields: [{ name: "email", required: true }], successPath: "/thanks" },
];

function receiverFixture({
  setting, external = {}, withCredential = false,
}: { setting?: string; external?: FormDestinationModule; withCredential?: boolean } = {}) {
  const registry = buildFormDestinationRegistry({ refusals: [], loaded: [
    { descriptor: { id: "co", label: "Co", module: "co.mjs", receive: "co-hosted", hosts: ["host-a"] }, pluginId: "plug-co", module: receiving },
    { descriptor: { id: "relay", label: "Relay", module: "relay.mjs", receive: "external", ...(withCredential ? { credentialLabel: "Relay account" } : {}) }, pluginId: "plug-relay",
      module: { ...receiving, prepare: async () => ({ submitUrl: "https://relay.example/forms" }), ...external } },
  ] });
  const save = vi.fn<Awaited<ReturnType<FormDestinationPortDeps["formReceiverKey"]>>["save"]>(async () => {});
  const secret = "receiver-key-7";
  const deps = {
    listForms: vi.fn<FormDestinationPortDeps["listForms"]>(async () => forms),
    hasExistingKey: vi.fn<FormDestinationPortDeps["hasExistingKey"]>(async () => false),
    readExistingKey: vi.fn<FormDestinationPortDeps["readExistingKey"]>(async () => undefined),
    resolveCredential: vi.fn<FormDestinationPortDeps["resolveCredential"]>(async () => null),
    formReceiverKey: vi.fn<FormDestinationPortDeps["formReceiverKey"]>(async () => ({ secret, save })),
    noReceiverMessage: ({ reason }: { reason: string }) => `Off because ${reason}.`,
    missingCredentialMessage: ({ id, label }: { id: string; label: string }) => `${id} needs '${label}'`,
    loadRegistry: vi.fn<FormDestinationPortDeps["loadRegistry"]>(async () => registry),
    readSetting: vi.fn<FormDestinationPortDeps["readSetting"]>(async () => setting),
  } satisfies FormDestinationPortDeps;
  return { deps, save, secret };
}

it("does not create a key or receiver for a form-less site without a saved key", async () => {
  const { deps } = receiverFixture({ setting: "relay" });
  deps.listForms.mockResolvedValue([]);
  const port = createFormDestinationPort(deps);
  expect(await port.previewInput(receiverInput)).toEqual({});
  expect(await port.prepare(receiverInput)).toEqual({ hosting: { forms: [] } });
  expect(deps.hasExistingKey.mock.calls).toEqual([[{ workspaceId: "ws-7", hostingTargetId: "host-a" }]]);
  expect(deps.readExistingKey.mock.calls).toEqual([[{ workspaceId: "ws-7", hostingTargetId: "host-a" }]]);
  expect(deps.loadRegistry.mock.calls).toEqual([]);
  expect(deps.formReceiverKey.mock.calls).toEqual([]);
});

it("previews auto co-hosting without a key and only prepares a host-scoped key", async () => {
  const { deps, save } = receiverFixture();
  const options = { newSecret: () => "new-secret" };
  const port = createFormDestinationPort(deps, options);
  expect(await port.previewInput(receiverInput)).toEqual({ hosting: { forms } });
  expect(deps.formReceiverKey.mock.calls).toEqual([]);
  const plan = await port.prepare(receiverInput);
  expect(plan.hosting).toEqual({ forms, secret: "receiver-key-7" });
  expect(deps.formReceiverKey.mock.calls).toEqual([[{ workspaceId: "ws-7", scope: "host-a" }, options]]);
  expect(deps.readSetting.mock.calls).toEqual([[{ workspaceId: "ws-7" }], [{ workspaceId: "ws-7" }]]);
  await plan.save!({ url: "https://published.example/newsletter" });
  expect(save.mock.calls).toEqual([[{ url: "https://published.example/newsletter" }]]);
});

it("reports an explicitly disabled receiver and prepares nothing", async () => {
  const { deps } = receiverFixture({ setting: "none" });
  const port = createFormDestinationPort(deps);
  expect(await port.previewInput(receiverInput)).toEqual({ formSubmissions: {
    status: "off", forms: 1, changes: [], message: "Off because the site's form receiver setting (core.forms receiver) is none.",
  } });
  expect(await port.prepare(receiverInput)).toEqual({});
  expect(deps.formReceiverKey.mock.calls).toEqual([]);
});

it("explains why an explicit unavailable receiver blocks publishing", async () => {
  const { deps } = receiverFixture({ setting: "retired" });
  const port = createFormDestinationPort(deps);
  const reason = "form destination 'retired' is not installed, or its plugin is turned off. Turn the plugin on, or set the site's form receiver (core.forms receiver) to auto or none, then publish again";
  expect(await port.previewInput(receiverInput)).toEqual({ formSubmissions: {
    status: "off", forms: 1, changes: [], message: `Form submissions: ${reason}.`,
  } });
  await expect(port.prepare(receiverInput)).rejects.toThrow(reason);
  expect(deps.formReceiverKey.mock.calls).toEqual([]);
});

it("describes an external receiver without a preview using its label and form count", async () => {
  const { deps } = receiverFixture({ setting: "relay" });
  expect(await createFormDestinationPort(deps).previewInput(receiverInput)).toEqual({ formSubmissions: {
    status: "on", forms: 1, changes: [], message: "Form submissions: on (1 forms), received by Relay.",
  } });
  expect(deps.resolveCredential.mock.calls).toEqual([]);
  expect(deps.formReceiverKey.mock.calls).toEqual([]);
});

it("opens the named relay credential, then saves its external URL rather than the published site's URL", async () => {
  const preview = vi.fn<NonNullable<FormDestinationModule["preview"]>>(async () => ({ status: "on", forms: 1, message: "Relay ready.", changes: [] }));
  const prepare = vi.fn<NonNullable<FormDestinationModule["prepare"]>>(async () => ({ submitUrl: "https://relay.example/forms" }));
  const { deps, save } = receiverFixture({ setting: "relay", withCredential: true, external: { preview, prepare } });
  deps.resolveCredential.mockResolvedValue({ token: "fixture-relay", baseUrl: "https://api.example", username: "writer", additionalHosts: ["https://unused.example"] });
  const port = createFormDestinationPort(deps);
  const args = {
    forms, kit: receiverInput.kit, site: { projectName: "newsletter" },
    credential: { token: "fixture-relay", baseUrl: "https://api.example", username: "writer" },
  };
  expect(await port.previewInput(receiverInput)).toEqual({ formSubmissions: { status: "on", forms: 1, message: "Relay ready.", changes: [] } });
  expect(preview.mock.calls).toEqual([[args]]);
  expect(deps.formReceiverKey.mock.calls).toEqual([]);
  const plan = await port.prepare(receiverInput);
  expect(plan.submitUrl).toBe("https://relay.example/forms");
  expect(prepare.mock.calls).toEqual([[{ ...args, secret: "receiver-key-7" }]]);
  expect(deps.resolveCredential.mock.calls).toEqual(Array.from({ length: 2 }, () => [{ workspaceId: "ws-7", label: "Relay account" }]));
  await plan.save!({ url: "https://published.example/wrong-receiver" });
  expect(save.mock.calls).toEqual([[{ url: "https://relay.example/forms" }]]);
});

it("explains missing relay credentials without running vendor preview or prepare", async () => {
  const preview = vi.fn();
  const prepare = vi.fn();
  const { deps, save } = receiverFixture({ setting: "relay", withCredential: true, external: { preview, prepare } });
  const port = createFormDestinationPort(deps);
  expect(await port.previewInput(receiverInput)).toEqual({ formSubmissions: {
    status: "off", forms: 1, changes: [], message: "Form submissions: relay needs 'Relay account'.",
  } });
  await expect(port.prepare(receiverInput)).rejects.toThrow("form destination 'relay' could not prepare its receiver: relay needs 'Relay account'");
  expect(preview.mock.calls).toEqual([]);
  expect(prepare.mock.calls).toEqual([]);
  expect(save.mock.calls).toEqual([]);
});

it("redacts every occurrence of the prepared receiver key from a port failure", async () => {
  const { deps, save } = receiverFixture({ setting: "relay", external: {
    prepare: async ({ secret }) => { throw new Error(`refused ${secret} again ${secret}`); },
  } });
  await expect(createFormDestinationPort(deps).prepare(receiverInput))
    .rejects.toThrow("form destination 'relay' could not prepare its receiver: refused [redacted] again [redacted]");
  expect(save.mock.calls).toEqual([]);
});

it("keeps an external preview rejection distinct from a receiver that is ready to use", async () => {
  const { deps } = receiverFixture({ setting: "relay", external: {
    preview: async () => { throw "Relay is undergoing maintenance"; },
  } });
  expect(await createFormDestinationPort(deps).previewInput(receiverInput)).toEqual({
    formSubmissions: { status: "off", forms: 1, changes: [], message: "Form submissions: Relay is undergoing maintenance." },
  });
  expect(deps.formReceiverKey.mock.calls).toEqual([]);
});
