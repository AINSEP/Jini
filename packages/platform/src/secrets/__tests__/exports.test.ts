import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
test("0.5.4 retains published secret subpaths and adds generic platform subpaths while retaining existing exports", () => {
    const root = new URL("../../../", import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
    expect(manifest.version).toBe("0.5.4");
    expect(Object.keys(manifest.exports)).toEqual([".", "./fetch-with-timeout", "./secrets", "./secrets/credential-sets", "./secrets/testing", "./http/guarded", "./mail", "./mail/smtp", "./fs/guarded-reader", "./fs/durable-json", "./fs", "./net", "./net/endpoint-policy", "./fs/file-lock", "./secrets/credential-token", "./web"]);
    for (const [subpath, source] of [["./net/endpoint-policy", "net/endpoint-policy"], ["./secrets/credential-token", "secrets/credential-token"], ["./net", "net/index"], ["./fs/file-lock", "fs/file-lock"], ["./secrets", "secrets/index"], ["./secrets/credential-sets", "secrets/credential-sets/index"], ["./secrets/testing", "secrets/testing"], ["./http/guarded", "http/guarded/index"], ["./mail", "mail/index"], ["./mail/smtp", "mail/smtp"], ["./fs/guarded-reader", "fs/guarded-reader"], ["./fs/durable-json", "fs/durable-json"], ["./fs", "fs/index"], ["./web", "web/index"]]) {
        expect(manifest.exports[subpath!]).toEqual({ types: `./dist/${source}.d.ts`, import: `./dist/${source}.js`, default: `./dist/${source}.js` });
        expect(existsSync(fileURLToPath(new URL(`src/${source}.ts`, root)))).toBe(true);
    }
    expect(manifest.dependencies).toEqual({ undici: "^7.25.0", "@jini-ai/core": "^0.4.0", parse5: "7.3.0", "hast-util-from-parse5": "8.0.3", "hast-util-to-mdast": "10.1.2", "mdast-util-to-markdown": "2.1.2", "mdast-util-gfm-table": "2.0.0" });
});
