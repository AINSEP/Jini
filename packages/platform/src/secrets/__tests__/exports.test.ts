import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
test("0.5.0 retains published secret subpaths and adds generic platform subpaths while retaining existing exports", () => {
    const root = new URL("../../../", import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    expect(manifest.version).toBe("0.5.0");
    expect(Object.keys(manifest.exports)).toEqual([".", "./fetch-with-timeout", "./secrets", "./secrets/credential-sets", "./secrets/testing", "./http/guarded", "./mail", "./mail/smtp", "./fs/guarded-reader", "./fs/durable-json", "./fs", "./net", "./fs/file-lock"]);
    for (const [subpath, source] of [["./net", "net/index"], ["./fs/file-lock", "fs/file-lock"], ["./secrets", "secrets/index"], ["./secrets/credential-sets", "secrets/credential-sets/index"], ["./secrets/testing", "secrets/testing"], ["./http/guarded", "http/guarded/index"], ["./mail", "mail/index"], ["./mail/smtp", "mail/smtp"], ["./fs/guarded-reader", "fs/guarded-reader"], ["./fs/durable-json", "fs/durable-json"], ["./fs", "fs/index"]]) {
        expect(manifest.exports[subpath!]).toEqual({ types: `./dist/${source}.d.ts`, import: `./dist/${source}.js`, default: `./dist/${source}.js` });
        expect(existsSync(fileURLToPath(new URL(`src/${source}.ts`, root)))).toBe(true);
    }
    expect(manifest.dependencies).toEqual({ undici: "^7.25.0", "@jini-ai/core": "^0.4.0" });
});
