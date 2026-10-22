import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, vi, afterEach } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { createGuardedFileReader, createNodeGuardedReaderFilesystem, FsFilePathError } from "../guarded-reader.js";
const MAX_FS_FILE_BYTES = 1000000;
const denyRules = { segments: new Set(["secrets", ".aws", ".docker", ".kube", "gcloud", "gh", ".hostvault"]), filenamePatterns: [
        /^\.env(?:\..*)?$/i,
        /\.pem$/i,
        /\.key$/i,
        /\.p12$/i,
        /\.db$/i,
        /\.db-wal$/i,
        /\.db-shm$/i,
        /^\.mcp(?:\..*)?\.json$/i,
        /\.(?:crt|cer|cert|pfx|jks|keystore|jwk|jwks)$/i,
        /^\.(?:npmrc|netrc)$/i,
        /^id_(?:rsa|dsa|ecdsa|ed25519).*(?<!\.pub)$/i,
        /^credentials\.json$/i,
        /^credentials$/i,
        /^client_secret.*\.json$/i,
        /^\.git-credentials$/i,
        /root-key.*\.hex$/i,
        /^\.credentials\.json$/i,
        /^\.(?:bash_profile|bashrc|bash_login|zshrc|zprofile|zshenv|zlogin|profile)$/i,
        /^\.?\.storage-secret\.json(?:\..*)?$/i,
    ] as readonly RegExp[], };
const limits = { maxFileBytes: MAX_FS_FILE_BYTES, binarySniffBytes: 8000, maxListedFiles: 2000, maxWalkDepth: 12, maxWalkEntries: 20000 };
function reader(rootPath: string) { return createGuardedFileReader({ rootPath, denyRules, limits, filesystem: createNodeGuardedReaderFilesystem({}) }); }
function resolveFsFilePath(input: {
    rootPath: string;
    relativePath: string;
}) { return reader(input.rootPath).resolve({ relativePath: input.relativePath }); }
function readFsFile(input: {
    rootPath: string;
    relativePath: string;
}) { return reader(input.rootPath).read({ relativePath: input.relativePath }); }
function listFsFiles(input: {
    rootPath: string;
    relativePath?: string;
}) { return reader(input.rootPath).list({}, input.relativePath === undefined ? {} : { relativePath: input.relativePath }); }
function isDeniedFsFileName(fileName: string) { return reader("/unused").isDeniedFileName({ fileName }); }
function isDeniedFsPathSegment(segmentName: string) { return reader("/unused").isDeniedPathSegment({ segmentName }); }
/**
 * @file Certifies the path containment `fs_list_files`/`fs_read_file`'s whole safety argument rests
 * on: an allowlisted "read/list anything under ONE named root" capability is only sound while
 * "under that root" is actually enforced. Mirrors `features/theme/__tests__/theme-files.test.ts`'s
 * own structure (same escape attempts, same fix) — see `fs-files.ts`'s own header for why the two
 * modules share this shape.
 */
function makeAllowedRoot(): {
    root: string;
} {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hostvault-fsfiles-root-"));
    fs.mkdirSync(path.join(root, "references"), { recursive: true });
    fs.writeFileSync(path.join(root, "manifest.json"), "{}", "utf8");
    fs.writeFileSync(path.join(root, "references", "checklist.template.md"), "# Checklist", "utf8");
    return { root };
}
// ---------------------------------------------------------------------------
// 1. Traversal.
// ---------------------------------------------------------------------------
test("an ordinary relative path inside the root resolves", () => {
    const { root } = makeAllowedRoot();
    const resolved = resolveFsFilePath({ rootPath: root, relativePath: "references/checklist.template.md" });
    assert.equal(resolved, path.join(fs.realpathSync(root), "references", "checklist.template.md"));
});
test("a ../ traversal out of the root is refused", () => {
    const { root } = makeAllowedRoot();
    for (const attempt of ["../evil.txt", "../../etc/passwd", "references/../../escaped.txt", "./../../x"]) {
        assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: attempt }), FsFilePathError, `expected '${attempt}' to be refused`);
    }
});
test("a SIBLING folder whose name merely extends the root's is refused (the classic startsWith defect)", () => {
    const { root } = makeAllowedRoot();
    // `<root>-evil` starts with `<root>` as a string, but is not inside it.
    const evilSibling = `${root}-evil`;
    fs.mkdirSync(evilSibling, { recursive: true });
    fs.writeFileSync(path.join(evilSibling, "x.txt"), "nope", "utf8");
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: `../${path.basename(evilSibling)}/x.txt` }), /resolves outside the allowed root/);
});
test("an absolute path is refused even when it points inside the root", () => {
    const { root } = makeAllowedRoot();
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: path.join(root, "manifest.json") }), /must be relative to the root/);
});
test("an empty path and a NUL byte are both refused", () => {
    const { root } = makeAllowedRoot();
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: "" }), /path is required/);
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: "a\0b" }), /NUL byte/);
});
// ---------------------------------------------------------------------------
// 2. Symlink escape — actually created on disk, not merely asserted in theory.
// ---------------------------------------------------------------------------
test("a symlinked DIRECTORY inside the root cannot be read through", () => {
    const { root } = makeAllowedRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hostvault-fsfiles-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET", "utf8");
    fs.symlinkSync(outside, path.join(root, "escape"));
    // `escape/secret.txt` is lexically inside the root — every prefix/relative check passes — but
    // realpath lands in `outside`.
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: "escape/secret.txt" }), /through a symbolic link/);
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "escape/secret.txt" }), /through a symbolic link/);
});
test("a symlinked FILE inside the root cannot be read through", () => {
    const { root } = makeAllowedRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hostvault-fsfiles-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET", "utf8");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "innocent.txt"));
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "innocent.txt" }), /through a symbolic link/);
});
test("a same-directory symlink alias cannot smuggle a denied filename or segment past the denylist", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1", "utf8");
    fs.mkdirSync(path.join(root, "secrets"), { recursive: true });
    fs.writeFileSync(path.join(root, "secrets", "token.txt"), "shh", "utf8");
    fs.symlinkSync(path.join(root, ".env"), path.join(root, "public.txt"));
    fs.symlinkSync(path.join(root, "secrets"), path.join(root, "reference"));
    // `public.txt` is a harmless name and its realpath is still inside the root, so only a denylist
    // re-applied to the EFFECTIVE name catches it.
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: "public.txt" }), /denied filename pattern/);
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "public.txt" }), /denied filename pattern/);
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: "reference/token.txt" }), /denied path segment/);
});
test("listFsFiles does not follow or report symlinks out of the root", () => {
    const { root } = makeAllowedRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hostvault-fsfiles-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET", "utf8");
    fs.symlinkSync(outside, path.join(root, "escape"));
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.some((f) => f.startsWith("escape")), false, "a symlinked directory must be neither descended nor reported");
});
test("listFsFiles returns cleanly (never throws ELOOP) when the root contains a CIRCULAR symlink (a -> b -> a)", () => {
    const { root } = makeAllowedRoot();
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    fs.symlinkSync(b, a);
    fs.symlinkSync(a, b);
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.some((f) => f === "a" || f === "b"), false, "a circular symlink must be neither descended nor reported as a file");
});
// ---------------------------------------------------------------------------
// 3. Pattern deny — defense in depth WITHIN an allowed root.
// ---------------------------------------------------------------------------
test("isDeniedFsFileName matches every documented pattern", () => {
    for (const name of ["content.db", "chat.db-wal", "content.db-shm", ".env", ".env.local", "server.pem", "id_rsa.key", "cert.p12"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    for (const name of ["manifest.json", "checklist.template.md", "styles.css", "readme.md"]) {
        assert.equal(isDeniedFsFileName(name), false, `expected '${name}' to be allowed`);
    }
});
test("isDeniedFsFileName matches every .env variant, not just the literal '.env'", () => {
    // `.env.bak-before-forbid-bash` is a real file in this repo today — the pattern must match the
    // FAMILY, not one hardcoded name.
    for (const name of [".env", ".env.local", ".env.example", ".env.bak-before-forbid-bash", ".env.production"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    assert.equal(isDeniedFsFileName("environment.ts"), false, "a name merely containing 'env' must not match");
});
test("isDeniedFsFileName matches .mcp.json and every .mcp.*.json variant — these carry a live JINI_DAEMON_TOKEN", () => {
    for (const name of [".mcp.json", ".mcp.jini-0d069eb1-604e-4c77-a154-a2ae09991f4b.json", ".mcp.jini-abc123.json"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    for (const name of ["mcp.json", "package.json", ".mcpjson"]) {
        assert.equal(isDeniedFsFileName(name), false, `expected '${name}' to be allowed`);
    }
});
test("a .mcp.jini-*.json file is refused on read and excluded from listFsFiles", () => {
    const { root } = makeAllowedRoot();
    const mcpFile = ".mcp.jini-0d069eb1-604e-4c77-a154-a2ae09991f4b.json";
    fs.writeFileSync(path.join(root, mcpFile), JSON.stringify({ mcpServers: { jini: { env: { JINI_DAEMON_TOKEN: "secret" } } } }), "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: mcpFile }), /denied filename pattern/);
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.includes(mcpFile), false, "a .mcp.jini-*.json file must not appear in the listing");
});
// ---------------------------------------------------------------------------
// 3c. Proactive defense-in-depth families — none of these exist in this repo today; added ahead of
//     a real incident per the owner's standing "secrets/.env and that type of stuff" instruction.
// ---------------------------------------------------------------------------
test("isDeniedFsFileName matches the certificate/keystore family", () => {
    for (const name of ["server.crt", "ca.cer", "site.cert", "app.pfx", "release.jks", "release.keystore", "key.jwk", "keys.jwks"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    assert.equal(isDeniedFsFileName("notes.crtx"), false, "a name merely containing the extension as a substring must not match");
});
test("a certificate-family file is refused on read and excluded from listFsFiles", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, "release.keystore"), "binary-ish", "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "release.keystore" }), /denied filename pattern/);
    assert.equal(listFsFiles({ rootPath: root }).files.includes("release.keystore"), false);
});
test("isDeniedFsFileName matches .npmrc/.netrc but not an unrelated file merely containing the name", () => {
    for (const name of [".npmrc", ".netrc"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    assert.equal(isDeniedFsFileName("npmrc.txt"), false);
});
test(".npmrc is refused on read and excluded from listFsFiles", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, ".npmrc"), "//registry.npmjs.org/:_authToken=secret", "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: ".npmrc" }), /denied filename pattern/);
    assert.equal(listFsFiles({ rootPath: root }).files.includes(".npmrc"), false);
});
test("isDeniedFsFileName matches the id_rsa/id_dsa/id_ecdsa/id_ed25519 family and its variants, but NEVER the .pub public half", () => {
    for (const name of ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "id_rsa_backup", "id_rsa2", "ID_RSA"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    // The over-denying trap: a public key is not a secret and must stay readable.
    for (const name of ["id_rsa.pub", "id_dsa.pub", "id_ecdsa.pub", "id_ed25519.pub", "ID_RSA.PUB"]) {
        assert.equal(isDeniedFsFileName(name), false, `expected '${name}' (a PUBLIC key) to be allowed`);
    }
});
test("id_rsa is refused on read while id_rsa.pub reads cleanly", () => {
    const { root } = makeAllowedRoot();
    // Built at runtime, not as a literal, so this fixture never matches the repo's own
    // credential-shape scanner (`npm run check:secret-scan`) despite looking like key content.
    fs.writeFileSync(path.join(root, "id_rsa"), ["-----BEGIN", "OPENSSH", "PRIVATE", "KEY-----"].join(" "), "utf8");
    fs.writeFileSync(path.join(root, "id_rsa.pub"), "ssh-ed25519 AAAA...", "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "id_rsa" }), /denied filename pattern/);
    const result = readFsFile({ rootPath: root, relativePath: "id_rsa.pub" });
    assert.equal(result.content, "ssh-ed25519 AAAA...");
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.includes("id_rsa"), false, "the private half must not appear in the listing");
    assert.equal(files.includes("id_rsa.pub"), true, "the public half must still appear in the listing");
});
test("isDeniedFsFileName matches credentials.json and the client_secret*.json family", () => {
    for (const name of ["credentials.json", "Credentials.JSON", "client_secret.json", "client_secret_123.apps.googleusercontent.com.json"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    assert.equal(isDeniedFsFileName("client.json"), false);
});
test("credentials.json is refused on read and excluded from listFsFiles", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, "credentials.json"), '{"type":"service_account"}', "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "credentials.json" }), /denied filename pattern/);
    assert.equal(listFsFiles({ rootPath: root }).files.includes("credentials.json"), false);
});
test("common home-directory credential stores are refused on read and excluded from listFsFiles", () => {
    const { root } = makeAllowedRoot();
    const deniedPaths = [
        ".aws/credentials",
        ".docker/config.json",
        ".kube/config",
        ".git-credentials",
        ".config/gcloud/application_default_credentials.json",
        ".config/gh/hosts.yml",
    ];
    for (const relativePath of deniedPaths) {
        const full = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, "SECRET", "utf8");
    }
    for (const relativePath of deniedPaths) {
        assert.throws(() => readFsFile({ rootPath: root, relativePath }), FsFilePathError, `expected '${relativePath}' to be refused`);
    }
    const files = listFsFiles({ rootPath: root }).files;
    for (const relativePath of deniedPaths) {
        assert.equal(files.includes(relativePath), false, `expected '${relativePath}' to be absent from the listing`);
    }
});
test("reading a denied-pattern filename is refused even though it lives inside an allowed root", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1", "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: ".env" }), /denied filename pattern/);
});
test("a denied-pattern file is silently excluded from listFsFiles, not merely refused on read", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, "content.db"), "binary-ish", "utf8");
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.includes("content.db"), false);
});
// ---------------------------------------------------------------------------
// 3d. Root key and home-directory secrets (2026-09-24 fix) — the agent must never be able to read
//     FIXTURE_INTEGRATIONS_ROOT_KEY off disk (owner rule, "Site Token" = the root key = the one secret),
//     nor the shell rc files that export notarization/API creds, nor Claude's own OAuth store.
// ---------------------------------------------------------------------------
test("isDeniedFsFileName matches any '*root-key*.hex' basename, not just the literal generated filename", () => {
    for (const name of ["integrations-root-key.hex", "root-key.hex", "old-root-key-backup.hex", "INTEGRATIONS-ROOT-KEY.HEX"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    assert.equal(isDeniedFsFileName("root-key.txt"), false, "a name merely containing 'root-key' without the .hex extension must not match");
});
test("a '*root-key*.hex' file is refused on read and excluded from listFsFiles even outside a .hostvault directory", () => {
    const { root } = makeAllowedRoot();
    fs.mkdirSync(path.join(root, "backups"), { recursive: true });
    fs.writeFileSync(path.join(root, "backups", "old-root-key.hex"), "deadbeef", "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "backups/old-root-key.hex" }), /denied filename pattern/);
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.includes("backups/old-root-key.hex"), false);
});
test("the production root-key layout (sites/.hostvault/integrations-root-key.hex) is refused via the denied '.hostvault' segment", () => {
    const { root } = makeAllowedRoot();
    fs.mkdirSync(path.join(root, "sites", ".hostvault"), { recursive: true });
    fs.writeFileSync(path.join(root, "sites", ".hostvault", "integrations-root-key.hex"), "deadbeef", "utf8");
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: "sites/.hostvault/integrations-root-key.hex" }), /denied path segment/);
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "sites/.hostvault/integrations-root-key.hex" }), /denied path segment/);
});
test("the local home-dir custom-root layout (.hostvault/integrations-root-key.hex) is refused via the denied '.hostvault' segment", () => {
    const { root } = makeAllowedRoot();
    fs.mkdirSync(path.join(root, ".hostvault"), { recursive: true });
    fs.writeFileSync(path.join(root, ".hostvault", "integrations-root-key.hex"), "deadbeef", "utf8");
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: ".hostvault/integrations-root-key.hex" }), /denied path segment/);
    assert.throws(() => readFsFile({ rootPath: root, relativePath: ".hostvault/integrations-root-key.hex" }), /denied path segment/);
});
test("a '.hostvault' directory is never descended into or reported by listFsFiles", () => {
    const { root } = makeAllowedRoot();
    fs.mkdirSync(path.join(root, ".hostvault"), { recursive: true });
    fs.writeFileSync(path.join(root, ".hostvault", "integrations-root-key.hex"), "deadbeef", "utf8");
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.some((f) => f.startsWith(".hostvault")), false, "a '.hostvault' directory's contents must never be enumerated");
});
test("isDeniedFsFileName matches the shell rc family that carries exported notarization/API creds", () => {
    for (const name of [".bash_profile", ".bashrc", ".bash_login", ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".profile"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    assert.equal(isDeniedFsFileName("profile.ts"), false, "a name merely containing 'profile' must not match");
});
test(".bash_profile, .zshrc, and .profile are refused on read and excluded from listFsFiles", () => {
    const { root } = makeAllowedRoot();
    for (const name of [".bash_profile", ".zshrc", ".profile"]) {
        fs.writeFileSync(path.join(root, name), "export FIXTURE_INTEGRATIONS_ROOT_KEY=deadbeef", "utf8");
    }
    for (const name of [".bash_profile", ".zshrc", ".profile"]) {
        assert.throws(() => readFsFile({ rootPath: root, relativePath: name }), /denied filename pattern/, `expected '${name}' to be refused`);
    }
    const files = listFsFiles({ rootPath: root }).files;
    for (const name of [".bash_profile", ".zshrc", ".profile"]) {
        assert.equal(files.includes(name), false, `expected '${name}' to be absent from the listing`);
    }
});
test("isDeniedFsFileName matches '.credentials.json' (Claude's own OAuth store) without over-matching 'credentials.json'", () => {
    assert.equal(isDeniedFsFileName(".credentials.json"), true, "expected '.credentials.json' to be denied");
    // Already covered by the separate `credentials.json` (no leading dot) pattern above — asserted here
    // too so the two patterns are never accidentally collapsed into one.
    assert.equal(isDeniedFsFileName("credentials.json"), true, "expected 'credentials.json' to remain denied");
});
test(".claude/.credentials.json is refused on read and excluded from listFsFiles", () => {
    const { root } = makeAllowedRoot();
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", ".credentials.json"), '{"access_token":"secret"}', "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: ".claude/.credentials.json" }), /denied filename pattern/);
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.includes(".claude/.credentials.json"), false);
});
// ---------------------------------------------------------------------------
// 3b. Denied path SEGMENTS — the new default-allow model's primary gate.
// ---------------------------------------------------------------------------
test("isDeniedFsPathSegment matches 'secrets' case-insensitively and nothing else", () => {
    for (const name of ["secrets", "Secrets", "SECRETS"]) {
        assert.equal(isDeniedFsPathSegment(name), true, `expected '${name}' to be denied`);
    }
    for (const name of ["not-secrets-actually", "secret", "secrets-archive", "keys"]) {
        assert.equal(isDeniedFsPathSegment(name), false, `expected '${name}' to be allowed`);
    }
});
test("a 'secrets/' segment is refused at any depth, not just at the root", () => {
    const { root } = makeAllowedRoot();
    for (const attempt of ["secrets/token.txt", "a/b/secrets/token.txt", "SECRETS/token.txt"]) {
        assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: attempt }), /denied path segment/, `expected '${attempt}' to be refused`);
    }
});
test("a 'secrets' directory is never descended into or reported by listFsFiles", () => {
    const { root } = makeAllowedRoot();
    fs.mkdirSync(path.join(root, "secrets"), { recursive: true });
    fs.writeFileSync(path.join(root, "secrets", "token.txt"), "shh", "utf8");
    const files = listFsFiles({ rootPath: root }).files;
    assert.equal(files.some((f) => f.startsWith("secrets")), false, "a 'secrets' directory's contents must never be enumerated");
});
// ---------------------------------------------------------------------------
// 4. Size cap and binary sniff.
// ---------------------------------------------------------------------------
test("a file over MAX_FS_FILE_BYTES is refused", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, "big.txt"), "x".repeat(MAX_FS_FILE_BYTES + 1), "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "big.txt" }), /exceeds the .*-byte readable limit/);
});
test("a file at exactly MAX_FS_FILE_BYTES is allowed", () => {
    const { root } = makeAllowedRoot();
    const content = "x".repeat(MAX_FS_FILE_BYTES);
    fs.writeFileSync(path.join(root, "exact.txt"), content, "utf8");
    const result = readFsFile({ rootPath: root, relativePath: "exact.txt" });
    assert.equal(result.bytes, MAX_FS_FILE_BYTES);
});
test("a file containing a NUL byte sniffs as binary and is refused", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, "binary.dat"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]));
    assert.throws(() => readFsFile({ rootPath: root, relativePath: "binary.dat" }), /looks like a binary file/);
});
test("an ordinary text file with no NUL byte reads cleanly", () => {
    const { root } = makeAllowedRoot();
    const result = readFsFile({ rootPath: root, relativePath: "references/checklist.template.md" });
    assert.equal(result.content, "# Checklist");
    assert.equal(result.bytes, Buffer.byteLength("# Checklist", "utf8"));
});
// ---------------------------------------------------------------------------
// 5. Directory listing basics.
// ---------------------------------------------------------------------------
test("listFsFiles lists recursively, relative to the root, sorted", () => {
    const { root } = makeAllowedRoot();
    const files = listFsFiles({ rootPath: root }).files;
    assert.deepEqual(files, ["manifest.json", "references/checklist.template.md"]);
});
test("listFsFiles scoped to a subdirectory returns paths relative to THAT subdirectory", () => {
    const { root } = makeAllowedRoot();
    const files = listFsFiles({ rootPath: root, relativePath: "references" }).files;
    assert.deepEqual(files, ["checklist.template.md"]);
});
test("listFsFiles on a root that does not exist yet returns an empty list, not an error", () => {
    const missingRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hostvault-fsfiles-missing-")), "not-created-yet");
    assert.deepEqual(listFsFiles({ rootPath: missingRoot }).files, []);
});
test("listFsFiles refuses a relativePath that resolves to a file, not a directory", () => {
    const { root } = makeAllowedRoot();
    assert.throws(() => listFsFiles({ rootPath: root, relativePath: "manifest.json" }).files, /is not a directory/);
});
test("the traversal bound never fires before the result cap — a wide directory still yields MAX_LISTED_FILES results, and says it was truncated", () => {
    // The case that tells the two caps apart. In a directory of nothing but files, each file costs
    // exactly one scanned entry and yields exactly one result, so whichever cap is LOWER is the one a
    // caller actually gets. MAX_WALK_ENTRIES exists to bound a wide DENIED/excluded tree that produces
    // no results; set below MAX_LISTED_FILES it would silently halve every listing instead and make the
    // documented result cap unreachable. 2_001 files is one over the result cap and far under the
    // traversal budget, so this asserts the ordering rather than either number in isolation.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hostvault-fsfiles-wide-"));
    for (let i = 0; i < 2001; i += 1) {
        fs.writeFileSync(path.join(root, `f${String(i).padStart(4, "0")}.txt`), "x", "utf8");
    }
    const result = listFsFiles({ rootPath: root });
    assert.equal(result.files.length, 2000, "the result cap is what stops a directory of plain files; the traversal bound must sit above it");
    assert.equal(result.truncated, true, "a caller handed 2_000 paths and nothing else cannot tell a directory of exactly 2_000 files from one that was cut off");
});
test("an ordinary listing is not reported as truncated", () => {
    const { root } = makeAllowedRoot();
    // The other half of the flag: without this, `truncated: true` hardcoded would pass the test above.
    assert.equal(listFsFiles({ rootPath: root }).truncated, false);
});
// ---------------------------------------------------------------------------
// 6. Default-allow: a normal source file reads cleanly, noise directories are excluded from
//    listings only (never from reads) — the shape this domain now needs under the broad `repo`/
//    `site` roots (`layout.ts`), which it never needed under the old five-member allowlist.
// ---------------------------------------------------------------------------
test("an ordinary source file with no special extension reads cleanly under the new default-allow model", () => {
    const { root } = makeAllowedRoot();
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "app.ts"), "export const x = 1;\n", "utf8");
    const result = readFsFile({ rootPath: root, relativePath: "src/app.ts" });
    assert.equal(result.content, "export const x = 1;\n");
});
test("node_modules, .git, and dist are excluded from listFsFiles but not from fs_read_file itself", () => {
    const { root } = makeAllowedRoot();
    for (const dir of ["node_modules", ".git", "dist"]) {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
        fs.writeFileSync(path.join(root, dir, "noise.txt"), "noise", "utf8");
    }
    const files = listFsFiles({ rootPath: root }).files;
    for (const dir of ["node_modules", ".git", "dist"]) {
        assert.equal(files.some((f) => f.startsWith(`${dir}/`)), false, `expected '${dir}' to be excluded from the listing`);
    }
    // Ergonomics only, not security: a caller who already knows the path can still read it directly.
    const result = readFsFile({ rootPath: root, relativePath: "node_modules/noise.txt" });
    assert.equal(result.content, "noise");
});
// ---------------------------------------------------------------------------
// 3e. Spellings the host file system folds onto a denied name (2026-09-24 review of 9060b6c26).
//     macOS's default case-insensitive APFS opens `.baſhrc` (U+017F LONG S) as `.bashrc` and
//     `root-Key.hex` (U+212A KELVIN SIGN) as `root-key.hex` — verified on this machine — yet neither
//     `toLowerCase()` nor a non-`u` `/i` regex folds either character. Windows strips trailing dots
//     and spaces from every path component and reads `name::$DATA` as `name` itself.
// ---------------------------------------------------------------------------
test("a Unicode case-fold spelling of a denied filename is refused before the file system can fold it", () => {
    const { root } = makeAllowedRoot();
    fs.writeFileSync(path.join(root, ".bashrc"), "export FIXTURE_INTEGRATIONS_ROOT_KEY=deadbeef", "utf8");
    assert.throws(() => readFsFile({ rootPath: root, relativePath: ".baſhrc" }), { message: "path '.baſhrc' matches a denied filename pattern and cannot be accessed" });
    assert.equal(isDeniedFsFileName("integrations-root-Key.hex"), true, "KELVIN SIGN spelling of the root key file");
});
test("a Unicode case-fold spelling of a denied path segment is refused", () => {
    const { root } = makeAllowedRoot();
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: "ſecrets/token.txt" }), { message: "path 'ſecrets/token.txt' contains a denied path segment ('ſecrets') and cannot be accessed" });
});
test("Windows trailing-dot, trailing-space, and ::$DATA spellings of denied names are refused", () => {
    const { root } = makeAllowedRoot();
    assert.throws(() => resolveFsFilePath({ rootPath: root, relativePath: ".hostvault./integrations-root-key.hex" }), { message: "path '.hostvault./integrations-root-key.hex' contains a denied path segment ('.hostvault.') and cannot be accessed" });
    for (const name of [".env.", ".env ", ".env::$DATA", "integrations-root-key.hex.", "integrations-root-key.hex::$DATA"]) {
        assert.equal(isDeniedFsFileName(name), true, `expected '${name}' to be denied`);
    }
    assert.equal(isDeniedFsPathSegment(".hostvault. "), true, "trailing dot and space together");
    assert.equal(isDeniedFsFileName("notes.txt"), false, "an ordinary name must still pass");
});
