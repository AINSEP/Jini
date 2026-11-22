import { describe, expect, it } from "vitest";
import type { ObjectStore } from "@jini-ai/core/object-store";
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
