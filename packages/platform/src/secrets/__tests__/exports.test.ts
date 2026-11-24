import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import * as contracts from "../credential-sets/contracts.js";
import { suggestCredentialWorksFor } from "../credential-sets/provider-matches.js";
import { VaultError } from "@jini-ai/core/contracts/vault";
test("retains published subpaths and declares adapter dependencies as optional peers", () => {
    const root = new URL("../../../", import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    expect(Object.keys(manifest.exports)).toEqual([".", "./fetch-with-timeout", "./asset-cache", "./secrets", "./secrets/credential-sets", "./secrets/root-key", "./secrets/credential-sets/contracts", "./secrets/testing", "./http/multipart", "./http/guarded", "./mail", "./system", "./mail/senders", "./mail/email-template", "./mail/email-template-operations", "./mail/email-template-agent-tools", "./mail/smtp", "./mail/test-send", "./mail/feedback-setup", "./mail/use-readiness", "./mail/sql", "./fs/guarded-reader", "./fs/durable-json", "./fs", "./object-store", "./net", "./fs/file-lock", "./secrets/credential-token", "./secrets/legacy-owner", "./web", "./command", "./process", "./toolchain", "./proxy-env", "./shell", "./child-environment", "./retention", "./object-store/site/setting", "./object-store/site/registry"]);
    for (const [subpath, source] of [["./asset-cache", "asset-cache"], ["./secrets", "secrets/index"], ["./secrets/credential-sets", "secrets/credential-sets/index"], ["./secrets/root-key", "secrets/root-key/decide"], ["./secrets/testing", "secrets/testing"], ["./http/multipart", "http/multipart.adapter"], ["./http/guarded", "http/guarded/index"], ["./mail", "mail/index"], ["./system", "system"], ["./mail/email-template", "mail/email-template"], ["./mail/email-template-operations", "mail/email-template-operations"], ["./mail/email-template-agent-tools", "mail/email-template-agent-tools"], ["./mail/smtp", "mail/smtp"], ["./mail/test-send", "mail/test-send"], ["./mail/feedback-setup", "mail/feedback-setup"], ["./mail/use-readiness", "mail/use-readiness"], ["./mail/sql", "mail/sql/index"], ["./fs/guarded-reader", "fs/guarded-reader"], ["./fs/durable-json", "fs/durable-json"], ["./fs", "fs/index"], ["./object-store", "object-store/index"], ["./net", "net/index"], ["./fs/file-lock", "fs/file-lock"], ["./secrets/credential-token", "secrets/credential-token"], ["./secrets/legacy-owner", "secrets/legacy-owner"], ["./web", "web/index"], ["./command", "command"], ["./process", "process"], ["./toolchain", "toolchain"], ["./proxy-env", "proxy-env"], ["./shell", "shell"], ["./child-environment", "child-environment"], ["./retention", "retention/index"], ["./object-store/site/setting", "object-store/site/setting"], ["./object-store/site/registry", "object-store/site/registry"]]) {
        expect(manifest.exports[subpath!]).toEqual({ types: `./dist/${source}.d.ts`, import: `./dist/${source}.js`, default: `./dist/${source}.js` });
        expect(existsSync(fileURLToPath(new URL(`src/${source}.ts`, root)))).toBe(true);
        expect(manifest.jini.entries[subpath!]).toBe(subpath === "./secrets/credential-token" || subpath === "./system" || subpath === "./mail/email-template-agent-tools" ? "universal" : "node");
    }
    // 5e48b4f: undici is a production dependency — the default asset-cache dispatcher constructs it
    // with no optional-peer branch (README, docs/spec/api.spec.md); only the ./web HTML set stays opt-in.
    // kysely is likewise an opt-in peer: only the ./mail/sql repositories need it.
    // Assert the shape (which packages, which major), not an exact patch range that every dependency bump invalidates.
    expect(Object.keys(manifest.dependencies).sort()).toEqual(["@jini-ai/core", "undici"]);
    expect(manifest.dependencies["@jini-ai/core"]).toBe("workspace:^");
    expect(manifest.dependencies.undici).toMatch(/^\^7\./);
    expect(manifest.devDependencies.undici).toBe(manifest.dependencies.undici);
    const adapterPeers = { parse5: "7.3.0", "hast-util-from-parse5": "8.0.3", "hast-util-to-mdast": "10.1.2", "mdast-util-to-markdown": "2.1.2", "mdast-util-gfm-table": "2.0.0", kysely: "^0.29.6" };
    expect(manifest.peerDependencies).toEqual(adapterPeers);
    expect(manifest.peerDependenciesMeta).toEqual(Object.fromEntries(Object.keys(adapterPeers).map(name => [name, { optional: true }])));
    for (const [name, version] of Object.entries(adapterPeers)) expect(manifest.devDependencies[name]).toBe(version);
});

test("vault contracts leaf is universal and leaves the moved runtime bindings to core", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(manifest.exports["./secrets/credential-sets/contracts"]).toEqual({
        types: "./dist/secrets/credential-sets/contracts.d.ts",
        import: "./dist/secrets/credential-sets/contracts.js",
        default: "./dist/secrets/credential-sets/contracts.js",
    });
    expect(manifest.jini.entries["./secrets/credential-sets/contracts"]).toBe("universal");
    // No shells: the vault values moved to core and this leaf no longer re-exports them.
    expect(Object.keys(contracts).sort()).toEqual(["suggestCredentialWorksFor"]);
    expect(contracts.suggestCredentialWorksFor).toBe(suggestCredentialWorksFor);
    for (const moved of ["VAULT_KINDS", "vaultGroupKey", "assertVaultReplacement", "VaultError"]) expect(moved in contracts, moved).toBe(false);
    const error = new VaultError({ code: "conflict" });
    expect(error).toBeInstanceOf(VaultError);
    expect(error.code).toBe("conflict");
    expect(error.message).toBe("Secrets vault: conflict");
});
