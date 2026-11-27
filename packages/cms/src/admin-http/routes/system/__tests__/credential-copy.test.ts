import { ToolInputError } from "@jini-ai/core";
import { isRouteReply, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { expect, it, vi } from "vitest";
import {
  credentialCopyGrantRoute, credentialCopyListRoute,
  type CredentialCopyPrincipal, type CredentialCopyRouteDeps,
} from "../credential-copy.js";

const owner = { id: "owner-2" };
const request = { sourceSiteId: "shared-keys", ids: ["release-key"], overwrite: false };

function fixture() {
  const choices = [
    { keyId: "release-key", kind: "signing", name: "Release signer", siteName: "Origin", locked: "Unlock in settings", omittedCount: 0 },
    { keyId: "preview-key", kind: "hosting", name: "Preview", siteName: "", locked: "" },
  ];
  const authorize = vi.fn<JsonRouteAuthorize>(async () => {});
  const permissionFor = vi.fn<NonNullable<ReturnType<CredentialCopyRouteDeps["projectKeys"]>>["permissionFor"]>(async ({ keyId }) => {
    if (!choices.some((choice) => choice.keyId === keyId)) throw new ToolInputError({ message: "That saved key was removed." });
    return "credentials.signing.write";
  });
  const use = vi.fn<NonNullable<ReturnType<CredentialCopyRouteDeps["projectKeys"]>>["use"]>(async ({ keyId }) => ({ keyId: `linked-${keyId}` }));
  const listChoices = vi.fn(async (_required: Record<string, never>) => choices);
  const admitInstance = vi.fn<CredentialCopyRouteDeps["admitInstance"]>(async () => true);
  const isLocalRequest = vi.fn<CredentialCopyRouteDeps["isLocalRequest"]>(() => true);
  const projectKeys = vi.fn<CredentialCopyRouteDeps["projectKeys"]>(() => ({ listChoices, permissionFor, use }));
  const deps: CredentialCopyRouteDeps = { workspaceId: "ws-2", ownerPrincipalId: async () => owner.id, admitInstance, isLocalRequest, projectKeys };
  return { deps, authorize, admitInstance, isLocalRequest, projectKeys, listChoices, permissionFor, use };
}

async function call(
  route: typeof credentialCopyListRoute | typeof credentialCopyGrantRoute,
  required: { deps: CredentialCopyRouteDeps; authorize?: JsonRouteAuthorize; context?: CredentialCopyPrincipal },
  body?: unknown,
) {
  const parsed = await route.parse({ params: { workspaceId: "ws-2" }, query: {}, body });
  if (!parsed.ok) throw new Error("unexpected parse refusal");
  const result = await route.handle({ ...required, input: parsed.value }, {});
  if (!result.ok) throw new Error("unexpected contract failure");
  return result.value;
}

function refusal(value: unknown) {
  if (!isRouteReply(value)) throw new Error("expected a branded refusal reply");
  return { status: value.status, body: value.body };
}

it("lists only picker-facing fields, preserving an explicitly zero omitted count", async () => {
  const f = fixture();
  expect(await call(credentialCopyListRoute, { ...f, context: owner })).toEqual({ sources: [
    { siteId: "shared-keys", name: "Shared Keys", keys: [
      { id: "release-key", kind: "signing", label: "Release signer", provider: null, worksFor: [], siteName: "Origin", locked: "Unlock in settings", omittedCount: 0 },
      { id: "preview-key", kind: "hosting", label: "Preview", provider: null, worksFor: [] },
    ] },
  ] });
  expect(f.listChoices.mock.calls).toEqual([[{}]]);
  expect(f.authorize.mock.calls).toEqual([[{ permission: "system.write" }]]);
  expect(f.admitInstance.mock.calls).toEqual([[{ principalId: "owner-2", permission: "system.write" }]]);
  expect(f.isLocalRequest.mock.calls).toEqual([[{ context: owner }]]);
});

it.each(["principal", "authorizer"] as const)("fails closed when the mount omits the %s", async (missing) => {
  const f = fixture();
  await expect(call(credentialCopyListRoute, missing === "principal" ? f : { deps: f.deps, context: owner }))
    .rejects.toThrow("credential copy was mounted without the admin authenticate/authorize ports");
  expect(f.projectKeys.mock.calls).toEqual([]);
});

it("refuses non-owners before RBAC or key-store discovery", async () => {
  const f = fixture();
  expect(refusal(await call(credentialCopyListRoute, { ...f, context: { id: "editor-2" } })))
    .toEqual({ status: 403, body: { reasonCode: "owner-only" } });
  expect(f.authorize.mock.calls).toEqual([]);
  expect(f.projectKeys.mock.calls).toEqual([]);
});

it("propagates RBAC denial without asking the instance or loading saved keys", async () => {
  const f = fixture();
  const denied = new Error("system.write denied");
  f.authorize.mockRejectedValueOnce(denied);
  await expect(call(credentialCopyGrantRoute, { ...f, context: owner }, request)).rejects.toBe(denied);
  expect(f.admitInstance.mock.calls).toEqual([]);
  expect(f.projectKeys.mock.calls).toEqual([]);
});

it("refuses instance denial without looking for saved keys", async () => {
  const f = fixture();
  f.admitInstance.mockResolvedValueOnce(false);
  expect(refusal(await call(credentialCopyListRoute, { ...f, context: owner })))
    .toEqual({ status: 403, body: { reasonCode: "owner-only" } });
  expect(f.admitInstance.mock.calls).toEqual([[{ principalId: "owner-2", permission: "system.write" }]]);
  expect(f.projectKeys.mock.calls).toEqual([]);
});

it.each(["no store", "remote browser"] as const)("offers no saved keys to a host with %s", async (mode) => {
  const f = fixture();
  if (mode === "no store") f.projectKeys.mockReturnValueOnce(undefined);
  else f.isLocalRequest.mockReturnValueOnce(false);
  expect(refusal(await call(credentialCopyListRoute, { ...f, context: owner })))
    .toEqual({ status: 403, body: { reasonCode: "local-host-only" } });
  expect(f.listChoices.mock.calls).toEqual([]);
});

it.each<[string, unknown]>([
  ["null", null], ["a string", "release-key"], ["an array", []],
  ["an extra field", { ...request, targetSiteId: "not-server-bound" }],
  ["another source", { ...request, sourceSiteId: "other-site" }],
  ["a scalar id", { ...request, ids: "release-key" }],
  ["no ids", { ...request, ids: [] }],
  ["101 ids", { ...request, ids: Array.from({ length: 101 }, () => "release-key") }],
  ["two ids", { ...request, ids: ["release-key", "preview-key"] }],
  ["a number id", { ...request, ids: [37] }],
  ["an empty id", { ...request, ids: [""] }],
  ["an overlong id", { ...request, ids: ["x".repeat(513)] }],
  ["a control character", { ...request, ids: ["bad\nkey"] }],
  ["overwrite", { ...request, overwrite: true }],
])("rejects %s without resolving a key", async (_name, body) => {
  const f = fixture();
  expect(refusal(await call(credentialCopyGrantRoute, { ...f, context: owner }, body)))
    .toEqual({ status: 400, body: { reasonCode: "invalid-request" } });
  expect(f.permissionFor.mock.calls).toEqual([]);
  expect(f.use.mock.calls).toEqual([]);
});

it("writes one reference only after the kind-specific authorization and returns the resulting id", async () => {
  const f = fixture();
  expect(await call(credentialCopyGrantRoute, { ...f, context: owner }, request))
    .toEqual({ results: [{ kind: "reference", id: "linked-release-key", status: "granted" }] });
  expect(f.permissionFor.mock.calls).toEqual([[{ keyId: "release-key" }]]);
  expect(f.authorize.mock.calls).toEqual([[{ permission: "system.write" }], [{ permission: "credentials.signing.write" }]]);
  expect(f.admitInstance.mock.calls).toEqual([
    [{ principalId: "owner-2", permission: "system.write" }],
    [{ principalId: "owner-2", permission: "credentials.signing.write" }],
  ]);
  expect(f.use.mock.calls).toEqual([[{ keyId: "release-key", use: true }]]);
});

it("declines to write when the key kind's instance admission is denied", async () => {
  const f = fixture();
  f.admitInstance.mockImplementation(async ({ permission }) => permission === "system.write");
  expect(refusal(await call(credentialCopyGrantRoute, { ...f, context: owner }, request)))
    .toEqual({ status: 403, body: { reasonCode: "owner-only" } });
  expect(f.authorize.mock.calls).toEqual([[{ permission: "system.write" }], [{ permission: "credentials.signing.write" }]]);
  expect(f.use.mock.calls).toEqual([]);
});

it("maps a removed key to the store's public conflict without writing a reference", async () => {
  const f = fixture();
  expect(refusal(await call(credentialCopyGrantRoute, { ...f, context: owner }, { ...request, ids: ["gone-key"] })))
    .toEqual({ status: 409, body: { reasonCode: "saved-key-refused", message: "That saved key was removed." } });
  expect(f.permissionFor.mock.calls).toEqual([[{ keyId: "gone-key" }]]);
  expect(f.use.mock.calls).toEqual([]);
});

it("does not serialize a private key-store failure as a public conflict", async () => {
  const f = fixture();
  const failure = new Error("private device key path unavailable");
  f.use.mockRejectedValueOnce(failure);
  await expect(call(credentialCopyGrantRoute, { ...f, context: owner }, request)).rejects.toBe(failure);
  expect(f.use.mock.calls).toEqual([[{ keyId: "release-key", use: true }]]);
});
