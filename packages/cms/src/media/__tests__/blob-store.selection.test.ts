import { describe, expect, it, vi } from "vitest";
import { createObjectStoreRegistry, type ObjectStore, type ObjectStoreProvider } from "@jini-ai/core/object-store";
import { providerOk, providerRejected } from "@jini-ai/core/provider-registry";
import { readMediaStoreEnvChoice, selectMediaBlobStore, type MediaObjectStorePorts } from "../blob-store.selection.js";

const declaration = { providerId: "example_store", selector: "example", settings: { bucket: "EX_BUCKET" }, credentialFields: { accessKeyId: "EX_KEY" }, secret: "EX_SECRET", required: ["EX_BUCKET", "EX_KEY", "EX_SECRET"] };
const localStore = {} as ObjectStore;
const ports = (setting: string, credential?: { fields: Record<string, string | undefined>; secret: string }): (() => MediaObjectStorePorts<null>) => () => ({
  host: null,
  loadBundledRegistry: async () => { throw new Error("not used"); },
  loadSiteRegistry: async () => { throw new Error("not used"); },
  readSetting: async () => setting,
  resolveSharedCredential: async () => credential,
});

describe("readMediaStoreEnvChoice", () => {
  it("reads the env name it is given", () => {
    expect(readMediaStoreEnvChoice({ env: {}, envName: "MEDIA_STORE" })).toEqual({ kind: "unset" });
    expect(readMediaStoreEnvChoice({ env: { MEDIA_STORE: "local" }, envName: "MEDIA_STORE" })).toEqual({ kind: "local" });
  });
  it("names that env in its errors and maps a complete remote config", () => {
    expect(() => readMediaStoreEnvChoice({ env: { MEDIA_STORE: "nope" }, envName: "MEDIA_STORE" }, { envDeclarations: [declaration] })).toThrow("Unknown MEDIA_STORE 'nope' — expected 'local' or 'example'.");
    expect(() => readMediaStoreEnvChoice({ env: { MEDIA_STORE: "example", EX_BUCKET: "b" }, envName: "MEDIA_STORE" }, { envDeclarations: [declaration] })).toThrow("MEDIA_STORE=example requires EX_BUCKET, EX_KEY, EX_SECRET — missing: EX_KEY, EX_SECRET.");
    expect(readMediaStoreEnvChoice({ env: { MEDIA_STORE: "example", EX_BUCKET: "b", EX_KEY: "k", EX_SECRET: "s" }, envName: "MEDIA_STORE" }, { envDeclarations: [declaration] }))
      .toEqual({ kind: "remote", providerId: "example_store", settings: { bucket: "b" }, credential: { fields: { accessKeyId: "k" }, secret: "s" } });
  });
});

describe("selectMediaBlobStore", () => {
  it("uses the injected local store for an explicit local override, never touching the ports", () => {
    let localCalls = 0;
    const result = selectMediaBlobStore({ env: { MEDIA_STORE: "local" }, envName: "MEDIA_STORE", settingName: "media.store", local: () => { localCalls += 1; return localStore; }, ports: () => { throw new Error("ports must not be read"); } });
    expect(localCalls).toBe(1);
    expect(result.mediaIsRemoteByEnv).toBe(false);
  });
  it("names the setting when a remote setting has no saved connection", async () => {
    const { isMediaRemote, blobStore } = selectMediaBlobStore({ env: {}, envName: "MEDIA_STORE", settingName: "media.store", local: () => localStore, ports: ports("example_store") });
    expect(await isMediaRemote()).toBe(true);
    await expect(blobStore.get({ storageKey: "ws/a/blobs/aa/aa" } as never)).rejects.toThrow("Media storage 'example_store' has no saved connection — connect it first, or clear media.store.");
  });
  it("refuses a mediaBucket that names the public bucket", async () => {
    const { blobStore } = selectMediaBlobStore({ env: {}, envName: "MEDIA_STORE", settingName: "media.store", local: () => localStore, ports: ports("example_store", { fields: { bucket: "pub", mediaBucket: " PUB " }, secret: "s" }) });
    await expect(blobStore.get({ storageKey: "ws/a/blobs/aa/aa" } as never)).rejects.toThrow("needs a 'mediaBucket' different from the connection's public 'bucket'");
  });
});

function memoryObjectStore(): ObjectStore {
  const objects = new Map<string, Uint8Array>();
  return {
    async get({ key }) { return objects.get(key) ?? null; },
    async put({ key, bytes }, { ifAbsent } = {}) {
      if (ifAbsent && objects.has(key)) return { written: false };
      objects.set(key, bytes);
      return { written: true };
    },
    async head({ key }) { const value = objects.get(key); return value ? { size: value.byteLength } : null; },
    async delete({ key }) { objects.delete(key); },
  };
}

const required = { envName: "MEDIA_STORE", settingName: "media.store", local: () => { throw new Error("unexpected local storage"); } };
const remoteEnv = { MEDIA_STORE: "example", EX_BUCKET: "private-override", EX_KEY: "key", EX_SECRET: "fixture-secret" };
const digest = "aa" + "b".repeat(62);
const storageKey = `ws/west/blobs/aa/${digest}`;
const payload = Uint8Array.from([7, 8, 9]);

it("environment remote selection binds the bundled provider and never reads the site setting or saved credential", async () => {
  const create = vi.fn<ObjectStoreProvider<string>["create"]>(() => providerOk({ value: memoryObjectStore() }));
  const registry = createObjectStoreRegistry<string>({}, { seed: [{ id: "example_store", provider: { create } }] });
  const notUsed = async (): Promise<never> => { throw new Error("site binding must not run"); };
  const loadBundledRegistry = vi.fn(async () => ({ registry, refusals: [] }));
  const { blobStore, mediaIsRemoteByEnv, isMediaRemote } = selectMediaBlobStore({
    ...required, env: remoteEnv, ports: () => ({
      host: "kit", loadBundledRegistry, loadSiteRegistry: notUsed, readSetting: notUsed, resolveSharedCredential: notUsed,
    }),
  }, { envDeclarations: [declaration] });
  expect(mediaIsRemoteByEnv).toBe(true);
  expect(await isMediaRemote()).toBe(true);
  expect(create.mock.calls).toEqual([]);
  expect(await blobStore.put({ workspaceId: "west", sha256: digest, bytes: payload })).toEqual({ storageKey });
  expect(await blobStore.get({ storageKey })).toEqual(payload);
  expect(create.mock.calls).toEqual([[{ settings: { bucket: "private-override" }, credential: { fields: { accessKeyId: "key" }, secret: "fixture-secret" }, host: "kit" }]]);
  expect(loadBundledRegistry.mock.calls).toEqual([[]]);
});

it("site selection insists on a private bucket and binds its trimmed name and media prefix", async () => {
  let fields = { bucket: "website-public", mediaBucket: "  ", mediaKeyPrefix: "gallery/" };
  const create = vi.fn<ObjectStoreProvider<null>["create"]>(() => providerOk({ value: memoryObjectStore() }));
  const registry = createObjectStoreRegistry<null>({}, { seed: [{ id: "example_store", provider: { create } }] });
  const creds = vi.fn<MediaObjectStorePorts<null>["resolveSharedCredential"]>(async () => ({ fields, secret: "fixture-secret" }));
  const { blobStore, isMediaRemote } = selectMediaBlobStore({
    ...required, env: {}, ports: () => ({
      host: null, loadBundledRegistry: async () => { throw new Error("wrong registry"); },
      loadSiteRegistry: async () => ({ registry, refusals: [] }), readSetting: async () => "example_store", resolveSharedCredential: creds,
    }),
  });
  expect(await isMediaRemote()).toBe(true);
  await expect(blobStore.get({ storageKey })).rejects.toThrow("needs the connection's 'mediaBucket' field (a private bucket)");
  expect(create.mock.calls).toEqual([]);
  fields = { ...fields, mediaBucket: "  asset-vault  " };
  await blobStore.put({ workspaceId: "west", sha256: digest, bytes: payload });
  expect(await blobStore.get({ storageKey })).toEqual(payload);
  expect(creds.mock.calls).toEqual([[{ providerId: "example_store" }], [{ providerId: "example_store" }]]);
  expect(create.mock.calls).toEqual([[{ settings: { bucket: "asset-vault", keyPrefix: "gallery/" }, credential: { fields, secret: "fixture-secret" }, host: null }]]);
});

it("unavailable and refusing providers never fall back to local storage", async () => {
  const registry = createObjectStoreRegistry<null>();
  let refusals: string[] = [];
  const { blobStore } = selectMediaBlobStore({ ...required, env: remoteEnv, ports: () => ({
    ...ports("should not be used")(), loadBundledRegistry: async () => ({ registry, refusals }),
  }) }, { envDeclarations: [declaration] });
  await expect(blobStore.get({ storageKey })).rejects.toThrow("Media storage provider 'example_store' is not available.");
  refusals = ["manifest refused", "connection disabled"];
  await expect(blobStore.get({ storageKey })).rejects.toThrow("Media storage provider 'example_store' is not available (manifest refused; connection disabled).");
  registry.register({ definition: { id: "example_store", provider: { create: () => providerRejected({ code: "invalid_request", message: "private bucket not reachable" }) } } });
  await expect(blobStore.get({ storageKey })).rejects.toThrow("Media storage provider 'example_store' refused its configuration: private bucket not reachable");
});

it("an unknown backend with no declarations lists only 'local' as the accepted value", () => {
  expect(() => readMediaStoreEnvChoice({ env: { MEDIA_STORE: "example" }, envName: "MEDIA_STORE" })).toThrow("Unknown MEDIA_STORE 'example' — expected 'local'.");
});

it("an unset env with a blank site setting stays on the injected local store and reports media as not remote", async () => {
  const local = memoryObjectStore();
  let localCalls = 0;
  const credentialReads: unknown[] = [];
  const { blobStore, mediaIsRemoteByEnv, isMediaRemote } = selectMediaBlobStore({
    ...required, env: {}, local: () => { localCalls += 1; return local; }, ports: () => ({
      ...ports("")(), resolveSharedCredential: async (input) => { credentialReads.push(input); return undefined; },
    }),
  });
  expect(mediaIsRemoteByEnv).toBe(false);
  expect(await isMediaRemote()).toBe(false);
  expect(localCalls).toBe(0);
  expect(await blobStore.put({ workspaceId: "west", sha256: digest, bytes: payload })).toEqual({ storageKey });
  expect(await local.get({ key: storageKey })).toEqual(payload);
  expect(localCalls).toBe(1);
  expect(credentialReads).toEqual([]);
});

it("a site connection with a private media bucket and no public bucket binds the media bucket", async () => {
  const create = vi.fn<ObjectStoreProvider<null>["create"]>(() => providerOk({ value: memoryObjectStore() }));
  const registry = createObjectStoreRegistry<null>({}, { seed: [{ id: "example_store", provider: { create } }] });
  const fields = { mediaBucket: "media-only" };
  const { blobStore } = selectMediaBlobStore({
    ...required, env: {}, ports: () => ({
      ...ports("example_store", { fields, secret: "fixture-secret" })(), loadSiteRegistry: async () => ({ registry, refusals: [] }),
    }),
  });
  await expect(blobStore.get({ storageKey })).rejects.toThrow(`blob '${storageKey}' was not found`);
  expect(create.mock.calls).toEqual([[{ settings: { bucket: "media-only", keyPrefix: undefined }, credential: { fields, secret: "fixture-secret" }, host: null }]]);
});
