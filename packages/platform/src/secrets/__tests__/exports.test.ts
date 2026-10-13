import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import * as contracts from "../credential-sets/contracts.js";
import * as existingContracts from "../credential-sets/vault.types.js";
import { VaultError } from "../credential-sets/index.js";
test("retains published subpaths and declares adapter dependencies as optional peers", () => {
    const root = new URL("../../../", import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    expect(Object.keys(manifest.exports)).toEqual([".", "./fetch-with-timeout", "./asset-cache", "./secrets", "./secrets/credential-sets", "./secrets/credential-sets/contracts", "./secrets/testing", "./http/guarded", "./mail", "./mail/smtp", "./fs/guarded-reader", "./fs/durable-json", "./fs", "./net", "./net/endpoint-policy", "./fs/file-lock", "./secrets/credential-token", "./web", "./command", "./process", "./toolchain", "./proxy-env", "./shell", "./child-environment"]);
    for (const [subpath, source] of [["./asset-cache", "asset-cache"], ["./net/endpoint-policy", "net/endpoint-policy"], ["./secrets/credential-token", "secrets/credential-token"], ["./net", "net/index"], ["./fs/file-lock", "fs/file-lock"], ["./secrets", "secrets/index"], ["./secrets/credential-sets", "secrets/credential-sets/index"], ["./secrets/testing", "secrets/testing"], ["./http/guarded", "http/guarded/index"], ["./mail", "mail/index"], ["./mail/smtp", "mail/smtp"], ["./fs/guarded-reader", "fs/guarded-reader"], ["./fs/durable-json", "fs/durable-json"], ["./fs", "fs/index"], ["./web", "web/index"], ["./command", "command"], ["./process", "process"], ["./toolchain", "toolchain"], ["./proxy-env", "proxy-env"], ["./shell", "shell"], ["./child-environment", "child-environment"]]) {
        expect(manifest.exports[subpath!]).toEqual({ types: `./dist/${source}.d.ts`, import: `./dist/${source}.js`, default: `./dist/${source}.js` });
        expect(existsSync(fileURLToPath(new URL(`src/${source}.ts`, root)))).toBe(true);
        expect(manifest.jini.entries[subpath!]).toBe(subpath === "./net/endpoint-policy" || subpath === "./secrets/credential-token" ? "universal" : "node");
    }
    expect(manifest.dependencies).toEqual({ "@jini-ai/core": "^0.4.0" });
    const adapterPeers = { undici: "^7.25.0", parse5: "7.3.0", "hast-util-from-parse5": "8.0.3", "hast-util-to-mdast": "10.1.2", "mdast-util-to-markdown": "2.1.2", "mdast-util-gfm-table": "2.0.0" };
    expect(manifest.peerDependencies).toEqual(adapterPeers);
    expect(manifest.peerDependenciesMeta).toEqual(Object.fromEntries(Object.keys(adapterPeers).map(name => [name, { optional: true }])));
    for (const [name, version] of Object.entries(adapterPeers)) expect(manifest.devDependencies[name]).toBe(version);
});

test("vault contracts leaf is universal and preserves the existing runtime bindings", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(manifest.exports["./secrets/credential-sets/contracts"]).toEqual({
        types: "./dist/secrets/credential-sets/contracts.d.ts",
        import: "./dist/secrets/credential-sets/contracts.js",
        default: "./dist/secrets/credential-sets/contracts.js",
    });
    expect(manifest.jini.entries["./secrets/credential-sets/contracts"]).toBe("universal");
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(existingContracts).sort());
    expect(contracts.VAULT_KINDS).toBe(existingContracts.VAULT_KINDS);
    expect(contracts.vaultGroupKey).toBe(existingContracts.vaultGroupKey);
    expect(contracts.assertVaultReplacement).toBe(existingContracts.assertVaultReplacement);
    expect(contracts.VaultError).toBe(VaultError);
    const error = new contracts.VaultError({ code: "conflict" });
    expect(error).toBeInstanceOf(VaultError);
    expect(error.code).toBe("conflict");
    expect(error.message).toBe("Secrets vault: conflict");
});
