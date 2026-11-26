import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOrderedSiteKeyring } from "../ordered-keyring.js";
import { UnusableSiteKeyError } from "../../index.js";
import { inspectSiteKeyMaterial } from "../material.js";

const HOST_SALT = ["to", "vu", "-integrations-root-key-hkdf-v1"].join("");

describe("live ordered keyring", () => {
  it("matches the frozen signing fixture and rereads an on-disk change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ordered-keyring-"));
    const file = join(dir, "key.hex");
    try {
      writeFileSync(file, "aa".repeat(32));
      const keyring = createOrderedSiteKeyring({ sources: [{ kind: "per-site-file", path: file }], keyId: "v1", hkdfSalt: HOST_SALT, env: () => ({}),
        readSourceMaterial: ({ source }) => ({ raw: readFileSync(source.path!, "utf8") }), describeSource: source => source.path!,
        unusableSiteKeyError: ({ source, rejection }) => new UnusableSiteKeyError({ source: source.kind === "env" ? "env" : "file", reason: rejection.reason, message: "invalid key" }) });
      const input = { workspaceId: "ws-1", subscriptionId: "sub-1", version: 1 };
      expect(Buffer.from(await keyring.deriveSigningSecret(input)).toString("hex")).toBe("8f60aeee05219cf2d5d3f6126a4118c165d5be0d584e0701777ee1abf17ab88d");
      writeFileSync(file, "bb".repeat(32));
      expect(Buffer.from(await keyring.deriveSigningSecret(input)).toString("hex")).not.toBe("8f60aeee05219cf2d5d3f6126a4118c165d5be0d584e0701777ee1abf17ab88d");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("refuses an invalid first source without opening the valid second source", async () => {
    const reads: string[] = [];
    const required = { sources: [{ kind: "per-site-file", path: "/bad" }, { kind: "volume-file", path: "/good" }], keyId: "v1", hkdfSalt: HOST_SALT, env: () => ({}),
      readSourceMaterial: ({ source }: { source: { kind: string; path?: string } }) => { reads.push(source.path!); return { raw: source.path === "/bad" ? "private-invalid-material" : "aa".repeat(32) }; },
      describeSource: (source: { path?: string }) => source.path!,
      unusableSiteKeyError: ({ source, rejection }: { source: { kind: string }; rejection: { reason: "empty" | "not-hex" | "odd-length" | "too-short" } }) => new UnusableSiteKeyError({ source: source.kind === "env" ? "env" : "file", reason: rejection.reason, message: "invalid key" }),
    };
    await expect(createOrderedSiteKeyring(required).derive({ workspaceId: "ws", purpose: "sealer", info: "v1" })).rejects.toMatchObject({ source: "file", reason: "not-hex", message: "invalid key" });
    expect(reads).toEqual(["/bad"]);
    const status = inspectSiteKeyMaterial({ sources: required.sources, env: required.env, readSiteKeySourceMaterial: required.readSourceMaterial, siteKeyFilePathFrom: () => "/bad" });
    expect(JSON.stringify(status)).not.toContain("private-invalid-material");
    expect(status).toEqual({ active: false, source: "file", invalid: true, reason: "not-hex", keyFilePath: "/bad" });
  });
});

it('keeps active-key lookup free of source reads', async () => {
  let reads = 0;
  const keyring = createOrderedSiteKeyring({ sources: [{ kind: 'env' }], keyId: 'id', hkdfSalt: 'salt', env: () => ({}),
    readSourceMaterial: () => { reads++; return { raw: 'invalid' }; }, describeSource: source => source.kind,
    unusableSiteKeyError: () => new Error('invalid'),
  });
  expect(await keyring.activeKey()).toEqual({ keyId: 'id' }); expect(reads).toBe(0);
});
