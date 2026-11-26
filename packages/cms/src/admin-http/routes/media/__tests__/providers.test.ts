import { isRouteReply } from "@jini-ai/core/contracts/server";
import { describe, expect, it } from "vitest";
import { mediaGetProvidersRoute, mediaProvidersReply } from "../get-providers.js";
import { mediaPutProvidersRoute, type MediaPutProvidersRouteDeps } from "../put-providers.js";
import { raw, PRINCIPAL, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";
import { createHash } from "node:crypto";
import { AesGcmSecretSealer } from "@jini-ai/platform/secrets";
import { InMemoryVaultRepo, SecretsVaultService, createVaultMetaParsers } from "@jini-ai/platform/secrets/credential-sets";
import { MediaProviderCredentialVaultRepo, type MediaCredentialVaultPolicy } from "../../../../media/site/provider-credential-vault.js";
import { getMediaProviderCredentialsModel, saveMediaProviderCredentials, patchMediaProvider, removeMediaProvider, MediaProviderCredentialStaleError, type MediaProviderCredentialRowDeps, type MediaProviderCredentialInput } from "../../../../media/site/provider-credential-store.js";
import { mediaPatchProviderRoute } from "../patch-provider.js";
import { mediaDeleteProviderRoute } from "../delete-provider.js";

class HostValidationError extends Error {}
class HostUnconfiguredError extends Error {}
/** Host-worded refusals: the copy below is a value no real host ships, so the test proves it was injected. */
const REFUSALS: MediaPutProvidersRouteDeps["saveErrorMappings"] = [
  { matches: ({ err }) => err instanceof HostValidationError, status: 400, code: "TEST_VALIDATION" },
  { matches: ({ err }) => err instanceof HostUnconfiguredError, status: 503, code: "TEST_UNCONFIGURED", error: "test store is off" },
];
const MAP = { openai: { configured: true, last4: "abcd" } };
const READ_MODEL = { providers: MAP, revision: "rev-1" };
/** The answer every provider route gives: the bare markers map as the body, the revision as a strong ETag. */
const REPLY = { status: 200, body: MAP, headers: { etag: '"rev-1"' } };
const STALE = { status: 409, body: { error: "Your provider list changed in another window. Reload and try again.", code: "MEDIA_PROVIDERS_STALE" } };

it.each(["changed", "identical"])("a pre-delete ETag cannot overwrite a same-tick recreated provider (%s safe metadata)", async (metadata) => {
  const vault = new InMemoryVaultRepo({});
  const policy: MediaCredentialVaultPolicy = { ownerKey: "test", legacyIds: {}, parseMeta: ({ meta }) => ({ baseUrl: null, model: null, ...meta as { model?: string | null } }) };
  let nextId = 0;
  const idGen = { newId: () => `fresh-${++nextId}` };
  const repo = new MediaProviderCredentialVaultRepo({ vault, policy, idGen });
  const keyring = { activeKey: async () => ({ keyId: "k" }), derive: async () => new Uint8Array(32).fill(7), deriveSigningSecret: async () => new Uint8Array(32) };
  const sealer = new AesGcmSecretSealer({ keyring });
  const clock = { nowMs: () => Date.parse("2026-11-26T00:00:00.000Z") };
  const deps: MediaProviderCredentialRowDeps = { repo, vaultPolicy: policy, keyring, sealer, clock, idGen,
    sha256Hex: ({ text }) => createHash("sha256").update(text).digest("hex"), builtInProviderIds: new Set(["openai"]),
    credentialPolicy: { assertCredentialFreeField: () => {}, normalizeCredentialToken: ({ value }) => String(value) },
    credentialInputMessage: () => undefined, storageMessage: "storage",
    createVault: ({ repo: target }) => new SecretsVaultService({ repo: target.vault!, keyring, sealer, metaParsers: createVaultMetaParsers({}), authorize: async () => {}, now: () => new Date(clock.nowMs()).toISOString(), newId: idGen.newId }) };
  const { authorize } = recordingAuthorize();
  const rowErrors = { saveErrorMappings: [], outwardErrorMessage: ({ error }: { error: Error }) => error.message };
  const patchDeps = { workspaceId: WORKSPACE_ID, ...rowErrors, patchProvider: (input: { workspaceId: string; providerId: string; fields: { apiKey?: string; model?: string } }) => patchMediaProvider({ deps, ...input }) };
  const input = { providerId: "openai", body: { apiKey: "fixture-token-123456", model: "first" } };
  await mediaPatchProviderRoute.handle({ input, deps: patchDeps, authorize });
  const read = () => mediaGetProvidersRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, getProviders: ({ workspaceId }) => getMediaProviderCredentialsModel({ deps, workspaceId }) }, authorize });
  const before = await read();
  expect(before.ok).toBe(true);
  if (!before.ok) throw new Error("expected GET reply");
  const firstTag = before.value.headers!.etag!;
  await mediaDeleteProviderRoute.handle({ input: { providerId: "openai" }, deps: { workspaceId: WORKSPACE_ID, ...rowErrors, removeProvider: (input) => removeMediaProvider({ deps, ...input }) }, authorize });
  await mediaPatchProviderRoute.handle({ input: { ...input, body: { ...input.body, model: metadata === "changed" ? "second" : "first" } }, deps: patchDeps, authorize });
  const recreated = await repo.listByWorkspaceId({ workspaceId: WORKSPACE_ID });
  expect(recreated[0]?.vaultRecord?.id).toBe("fresh-2");
  const after = await read();
  expect(after.ok && after.value.headers!.etag).not.toBe(firstTag);
  if (!after.ok) throw new Error("expected GET reply after recreate");
  const freshTag = after.value.headers?.etag;
  expect(freshTag).toMatch(/^"mp1-[a-f0-9]{64}"$/);
  const parsed = mediaPutProvidersRoute.parse({ ...raw({}, { openai: { model: "stale overwrite" } }), headers: { "if-match": firstTag } });
  if (!parsed.ok) throw new Error("expected parsed PUT");
  const putDeps: MediaPutProvidersRouteDeps = { workspaceId: WORKSPACE_ID, ...rowErrors, saveProviders: async ({ workspaceId, providers, expectedRevision }) => {
    try { await saveMediaProviderCredentials({ deps, input: { workspaceId, providers: providers as Record<string, MediaProviderCredentialInput> } }, { expectedRevision }); }
    catch (error) { if (error instanceof MediaProviderCredentialStaleError) return { outcome: "stale" }; throw error; }
    return { outcome: "saved", ...await getMediaProviderCredentialsModel({ deps, workspaceId }) };
  } };
  expect(await refusalOf(() => mediaPutProvidersRoute.handle({ input: parsed.value, deps: putDeps, authorize }))).toEqual(STALE);
  expect(await repo.listByWorkspaceId({ workspaceId: WORKSPACE_ID })).toEqual(recreated);
  const fresh = mediaPutProvidersRoute.parse({ ...raw({}, { openai: { model: "fresh write" } }), headers: { "if-match": freshTag! } });
  if (!fresh.ok) throw new Error("expected parsed PUT");
  const saved = await mediaPutProvidersRoute.handle({ input: fresh.value, deps: putDeps, authorize });
  expect(saved.ok && saved.value.status).toBe(200);
  const readBack = await read();
  expect(readBack.ok && readBack.value.body).toMatchObject({ openai: { model: "fresh write" } });
  await mediaPatchProviderRoute.handle({ input: { ...input, body: { apiKey: "rotated-token-123456" } }, deps: patchDeps, authorize });
  expect((await repo.listByWorkspaceId({ workspaceId: WORKSPACE_ID }))[0]?.vaultRecord?.id).toBe("fresh-2");
});

describe("mediaGetProvidersRoute", () => {
  it("keeps the method, path, status and no body cap; parses nothing", () => {
    expect([mediaGetProvidersRoute.method, mediaGetProvidersRoute.path, mediaGetProvidersRoute.successStatus, mediaGetProvidersRoute.maxBodyBytes])
      .toEqual(["get", "/api/admin/v1/workspaces/:workspaceId/media/providers", undefined, undefined]);
    expect(mediaGetProvidersRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
  });

  it("authorizes media.read with no entity id and answers the bare map with its revision in the ETag", async () => {
    const { authorize, calls } = recordingAuthorize();
    const asked: unknown[] = [];
    const deps = { workspaceId: WORKSPACE_ID, getProviders: async (input: { workspaceId: string }) => { asked.push(input); return READ_MODEL; } };
    const result = await mediaGetProvidersRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize }, { signal });
    expect(result.ok && isRouteReply(result.value)).toBe(true);
    expect(result).toEqual({ ok: true, value: REPLY });
    expect(calls).toEqual([{ permission: "media.read", entityType: "media" }]);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID }]);
    let reads = 0;
    const counting = { workspaceId: WORKSPACE_ID, getProviders: async () => { reads += 1; return { providers: {}, revision: "r" }; } };
    await expect(mediaGetProvidersRoute.handle({ input: {}, deps: counting, authorize: recordingAuthorize(["media.read"]).authorize })).rejects.toThrow("denied");
    await expect(mediaGetProvidersRoute.handle({ input: {}, deps: counting })).rejects.toThrow(/no authorizer/);
    expect(reads).toBe(0);
  });

  it("refuses to put a revision that is not a plain strong ETag on the wire (a host wiring bug, not caller input)", () => {
    expect(mediaProvidersReply({ model: { providers: {}, revision: "a1-B2_c3.d4:e5" } }).headers).toEqual({ etag: '"a1-B2_c3.d4:e5"' });
    for (const revision of ["", 'has"quote', "has space", "x".repeat(201), "line\nbreak"]) {
      expect(() => mediaProvidersReply({ model: { providers: {}, revision } })).toThrow("media provider revision is not header-safe");
    }
  });
});

describe("mediaPutProvidersRoute", () => {
  const putDeps = (save: MediaPutProvidersRouteDeps["saveProviders"]): MediaPutProvidersRouteDeps => ({ workspaceId: WORKSPACE_ID, saveProviders: save, saveErrorMappings: REFUSALS, outwardErrorMessage: ({ error }) => error.message });

  it("keeps the method, path, status and no body cap; a missing body is the empty set", () => {
    expect([mediaPutProvidersRoute.method, mediaPutProvidersRoute.path, mediaPutProvidersRoute.successStatus, mediaPutProvidersRoute.maxBodyBytes])
      .toEqual(["put", "/api/admin/v1/workspaces/:workspaceId/media/providers", undefined, undefined]);
    expect(mediaPutProvidersRoute.parse(raw({}, { openai: { apiKey: "k" } }))).toEqual({ ok: true, value: { providers: { openai: { apiKey: "k" } } } });
    expect(mediaPutProvidersRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { providers: {} } });
    expect(mediaPutProvidersRoute.parse(raw({}, null))).toEqual({ ok: true, value: { providers: {} } });
  });

  it("reads the last-read revision from one strong If-Match tag and nothing looser", () => {
    const withMatch = (value: string) => mediaPutProvidersRoute.parse({ ...raw({}, {}), headers: { "if-match": value } });
    expect(withMatch('"rev-1"')).toEqual({ ok: true, value: { providers: {}, expectedRevision: "rev-1" } });
    for (const loose of ['W/"rev-1"', "*", "rev-1", '"rev-1", "rev-2"', '""']) expect(withMatch(loose)).toEqual({ ok: true, value: { providers: {} } });
  });

  it("authorizes admin.integrations.manage with no entity id, saves the whole set against the revision and answers the markers", async () => {
    const { authorize, calls } = recordingAuthorize();
    const saved: unknown[] = [];
    const deps = putDeps(async (input) => { saved.push(input); return { outcome: "saved", ...READ_MODEL }; });
    const result = await mediaPutProvidersRoute.handle({ input: { providers: { openai: { apiKey: "k" } }, expectedRevision: "rev-0" }, deps, context: PRINCIPAL, authorize }, { signal });
    expect(result).toEqual({ ok: true, value: REPLY });
    expect(calls).toEqual([{ permission: "admin.integrations.manage", entityType: "media" }]);
    expect(saved).toEqual([{ workspaceId: WORKSPACE_ID, providers: { openai: { apiKey: "k" } }, expectedRevision: "rev-0" }]);
  });

  it("a stale legacy PUT never reaches a write", async () => {
    // A host store whose compare runs inside its own writer boundary, as the real one must.
    const store = { revision: "rev-2", providers: { openai: { apiKey: "test-token-newer" } } as Record<string, unknown> };
    const asked: unknown[] = [];
    const deps = putDeps(async (input) => {
      asked.push(input);
      if (input.expectedRevision !== store.revision) return { outcome: "stale" };
      store.providers = input.providers;
      return { outcome: "saved", providers: {}, revision: "rev-3" };
    });
    const put = (input: { providers: Record<string, unknown>; expectedRevision?: string }) =>
      refusalOf(() => mediaPutProvidersRoute.handle({ input, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }));

    expect(await put({ providers: {} })).toEqual(STALE);
    expect(asked).toEqual([]);
    expect(await put({ providers: {}, expectedRevision: "rev-1" })).toEqual(STALE);
    expect(asked).toEqual([{ workspaceId: WORKSPACE_ID, providers: {}, expectedRevision: "rev-1" }]);
    expect(store).toEqual({ revision: "rev-2", providers: { openai: { apiKey: "test-token-newer" } } });
    expect(JSON.stringify(STALE)).not.toContain("test-token");
  });

  it("answers the host's mapped refusals (own message or the host copy) and rethrows the rest", async () => {
    const { authorize } = recordingAuthorize();
    const failWith = (error: Error) => putDeps(async () => { throw error; });
    const call = (deps: MediaPutProvidersRouteDeps) => mediaPutProvidersRoute.handle({ input: { providers: {}, expectedRevision: "rev-1" }, deps, context: PRINCIPAL, authorize });
    expect(await refusalOf(() => call(failWith(new HostValidationError("unknown provider 'x'"))))).toEqual({ status: 400, body: { error: "unknown provider 'x'", code: "TEST_VALIDATION" } });
    expect(await refusalOf(() => call(failWith(new HostUnconfiguredError("private detail"))))).toEqual({ status: 503, body: { error: "test store is off", code: "TEST_UNCONFIGURED" } });
    await expect(call(failWith(new Error("vault gone")))).rejects.toThrow("vault gone");
    let saves = 0;
    await expect(mediaPutProvidersRoute.handle({ input: { providers: {}, expectedRevision: "rev-1" }, deps: putDeps(async () => { saves += 1; return { outcome: "saved", ...READ_MODEL }; }), authorize: recordingAuthorize(["admin.integrations.manage"]).authorize })).rejects.toThrow("denied");
    expect(saves).toBe(0);
  });
});
