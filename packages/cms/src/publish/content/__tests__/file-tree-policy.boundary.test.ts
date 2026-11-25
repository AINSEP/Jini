/**
 * @file `publish-files-plan-2026-09-24.md` §2's static test, items (a)-(e), plus direct coverage of
 * every exported function in `../file-tree-policy.ts`.
 */
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  checkMcpJsonSecretPlaceholders,
  checkTreeFiles,
  checkTreePath,
  FILE_TREE_KINDS,
  FILE_TREE_LIMITS,
  isIgnoredTreeFileName,
  normalizeMode,
  resolveTreeRelativePath,
  THEME_FILE_TREE_ALLOWED_EXTENSIONS,
  wrapTreePolicyReason,
  type FileTreeFileInput,
} from "../file-tree-policy.js";
import { fakeScanTextForSecrets } from "./file-tree-policy.fixtures.js";

// (a) The kind set is exactly these 4, and never silently gains/loses one.
test("FILE_TREE_KINDS is exactly the 4 kinds from §1's inventory table", () => {
  assert.deepEqual(
    Object.keys(FILE_TREE_KINDS).sort(),
    ["agent-plugin", "agent-skill", "site-plugin", "theme-files"].sort()
  );
});

// (b) No kind's resolved root can ever land on a site-root file, for any valid id segments.
test("no kind's resolved root can ever equal a site-root file name", () => {
  const siteRootFiles = ["config.json", ".site-meta.json", ".fs-custom-root.json", ".mcp.x.json", "content.db", "chat.db"];
  for (const kind of Object.keys(FILE_TREE_KINDS) as (keyof typeof FILE_TREE_KINDS)[]) {
    const spec = FILE_TREE_KINDS[kind];
    // Every spec's baseDir is a fixed, non-empty literal — the structural guarantee itself.
    assert.ok(spec.baseDir.length > 0, `${kind} must have a non-empty baseDir`);
    assert.ok(!spec.baseDir.includes("/"), `${kind}'s baseDir must be one segment`);
    const idSegments = Array.from({ length: spec.idSegmentCount }, (_, i) => `seg${i}`);
    const resolved = resolveTreeRelativePath({ kind, idSegments });
    assert.ok(resolved !== null, `${kind} should resolve valid id segments`);
    assert.ok(resolved!.startsWith(`${spec.baseDir}/`), `${kind}'s resolved path must be nested under its baseDir`);
    for (const siteRootFile of siteRootFiles) {
      assert.notEqual(resolved, siteRootFile);
    }
  }
});

// (c) Each deny name/extension blocks a tree.
test("checkTreePath blocks every deny-listed segment, name and extension", () => {
  const cases: readonly [string, string][] = [
    ["theme.json/.git/x", "contains a '.git' segment, which is never published"],
    ["vendor/node_modules/x.js", "contains a 'node_modules' segment, which is never published"],
    [".publish-staging/x", "contains a '.publish-staging' segment, which is never published"],
    [".publish-previous/x", "contains a '.publish-previous' segment, which is never published"],
    [".env", "looks like an environment file"],
    [".env.production", "looks like an environment file"],
    [".npmrc", "is a package-manager credential file"],
    [".netrc", "is a package-manager credential file"],
    [".mcp.foo.json", "is an MCP server configuration file, which can hold secrets"],
    [".fs-custom-root.json", "holds a local filesystem path, never portable across machines"],
    ["nested/.fs-custom-root.json", "holds a local filesystem path, never portable across machines"],
    ["id_rsa", "looks like a private SSH key"],
    ["id_rsa.bak", "looks like a private SSH key"],
    ["id_ed25519", "looks like a private SSH key"],
    ["secrets.pem", "has a '.pem' extension, which is never published"],
    ["keys/site.key", "has a '.key' extension, which is never published"],
    ["data.db", "has a '.db' extension, which is never published"],
    ["data.sqlite", "has a '.sqlite' extension, which is never published"],
    ["data.db-wal", "has a '.db-wal' extension, which is never published"],
    ["data.db-shm", "has a '.db-shm' extension, which is never published"],
  ];
  for (const [relPath, reason] of cases) {
    assert.equal(checkTreePath({ relPath }), `"${relPath}" ${reason}`);
  }
});

test("checkTreePath blocks config.json/.site-meta.json only at tree root, not nested", () => {
  assert.ok(checkTreePath({ relPath: "config.json" }) !== null);
  assert.ok(checkTreePath({ relPath: ".site-meta.json" }) !== null);
  assert.equal(checkTreePath({ relPath: "fixtures/config.json" }), null);
  assert.equal(checkTreePath({ relPath: "fixtures/.site-meta.json" }), null);
});

test("checkTreePath blocks path-shape violations (.., leading /, backslash, depth, length, empty segment)", () => {
  assert.ok(checkTreePath({ relPath: "../x" }) !== null);
  assert.ok(checkTreePath({ relPath: "a/../b" }) !== null);
  assert.ok(checkTreePath({ relPath: "./a" }) !== null);
  assert.ok(checkTreePath({ relPath: "/abs/path" }) !== null);
  assert.ok(checkTreePath({ relPath: "a\\b" }) !== null);
  assert.ok(checkTreePath({ relPath: "a//b" }) !== null); // empty segment
  assert.ok(checkTreePath({ relPath: "" }) !== null);
  assert.ok(checkTreePath({ relPath: "a".repeat(600) }) !== null);
  assert.ok(checkTreePath({ relPath: Array.from({ length: 17 }, (_, i) => `d${i}`).join("/") }) !== null);
});

test("checkTreePath accepts an ordinary theme source path", () => {
  assert.equal(checkTreePath({ relPath: "render/pages/index.html" }), null);
  assert.equal(checkTreePath({ relPath: "theme.json" }), null);
  assert.equal(checkTreePath({ relPath: "preview/screenshot.png" }), null);
});

// OS junk files are IGNORED (silently excluded before packing), never a whole-tree DENY reason —
// `render/.DS_Store` recreated by Finder must not make `checkTreePath` refuse the path either, since
// a walker (`walkThemeTree`) is what keeps it out of a tree at all; `checkTreePath` on its own is a
// per-path shape check a caller could still run directly.
test("isIgnoredTreeFileName recognizes every documented OS junk name", () => {
  assert.ok(isIgnoredTreeFileName({ name: ".DS_Store" }));
  assert.ok(isIgnoredTreeFileName({ name: "Thumbs.db" }));
  assert.ok(isIgnoredTreeFileName({ name: "desktop.ini" }));
  assert.ok(isIgnoredTreeFileName({ name: "._resource-fork" }));
  assert.ok(isIgnoredTreeFileName({ name: ".Spotlight-V100" }));
  assert.ok(isIgnoredTreeFileName({ name: ".Trashes" }));
  assert.equal(isIgnoredTreeFileName({ name: "theme.json" }), false);
  assert.equal(isIgnoredTreeFileName({ name: ".env" }), false);
});

test("checkTreePath no longer blocks a .DS_Store path — it is ignored upstream, not denied here", () => {
  assert.equal(checkTreePath({ relPath: ".DS_Store" }), null);
  assert.equal(checkTreePath({ relPath: "render/.DS_Store" }), null);
});

// The walker is the ONE place junk is ignored. `checkTreeFiles` also runs on the destination over a
// file list the source sent, and every file in that list gets written — so a junk name reaching it
// is refused, never waved through past the '..', cap, extension and scan checks.
test("checkTreeFiles refuses an OS junk file that reached it, with a plain reason", () => {
  const files: FileTreeFileInput[] = [
    { path: "theme.json", size: 10, mode: 0o644, textSample: '{"id":"basic"}' },
    { path: "render/.DS_Store", size: 6148, mode: 0o644 },
  ];
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files }), `"render/.DS_Store" is a system file that is never published`);
  assert.equal(
    checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files: [{ path: "._id_rsa.png", size: 1, mode: 0o644 }] }),
    `"._id_rsa.png" is a system file that is never published`
  );
});

test("checkTreeFiles still runs the '..' and size checks on a junk-looking name", () => {
  assert.equal(
    checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files: [{ path: "../outside/._x.png", size: 1, mode: 0o644 }] }),
    `"../outside/._x.png" contains a '..' segment, which is never allowed`
  );
  assert.notEqual(
    checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files: [{ path: "Thumbs.db", size: FILE_TREE_LIMITS.maxTreeBytes + 1, mode: 0o644 }] }),
    null
  );
});

// (d) A planted credential in theme.css blocks the tree with the exact reason.
test("checkTreeFiles blocks a tree holding a planted Anthropic key, exact reason", () => {
  const planted = "sk-ant-" + "a".repeat(95);
  const files: FileTreeFileInput[] = [
    { path: "theme.json", size: 10, mode: 0o644, textSample: '{"id":"basic"}' },
    { path: "css/theme.css", size: 200, mode: 0o644, textSample: `body{}\n/* ${planted} */` },
  ];
  const reason = checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files });
  assert.equal(reason, `"css/theme.css" looks like it holds a key (Anthropic API key (sk-ant-))`);
});

test("checkTreeFiles blocks a tree holding a planted GitHub PAT", () => {
  const planted = "ghp_" + "a".repeat(36);
  const files: FileTreeFileInput[] = [{ path: "readme-notes.md", size: 50, mode: 0o644, textSample: planted }];
  const reason = checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files });
  assert.match(reason ?? "", /looks like it holds a key/);
});

test("checkTreeFiles blocks a tree holding a planted PEM private key block", () => {
  const pemHeader = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");
  const files: FileTreeFileInput[] = [{ path: "static/blob.txt", size: 50, mode: 0o644, textSample: pemHeader }];
  const reason = checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files });
  assert.match(reason ?? "", /looks like it holds a key/);
});

test("checkTreeFiles does not scan a binary-extension file even if its sample matches a pattern", () => {
  const planted = "sk-ant-" + "a".repeat(95);
  const files: FileTreeFileInput[] = [{ path: "preview/shot.png", size: 50, mode: 0o644, textSample: planted }];
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files }), null);
});

test("checkTreeFiles blocks a qualifying file when textSample is omitted", () => {
  const files: FileTreeFileInput[] = [{ path: "theme.json", size: 50, mode: 0o644 }];
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files }), '"theme.json" is missing the text required for its secret scan');
});

test("checkTreeFiles blocks case-insensitively duplicate paths", () => {
  const files: FileTreeFileInput[] = [
    { path: "render/Index.html", size: 10, mode: 0o644, textSample: "<html></html>" },
    { path: "render/index.html", size: 10, mode: 0o644, textSample: "<html></html>" },
  ];
  const reason = checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files });
  assert.match(reason ?? "", /differ only by letter case/);
});

test("checkTreeFiles blocks a disallowed extension for theme-files, terse and preformatted", () => {
  const files: FileTreeFileInput[] = [{ path: "server.php", size: 10, mode: 0o644, textSample: "<?php ?>" }];
  const reason = checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files });
  assert.equal(reason, "Can't publish: contains a file type that isn't allowed (server.php)");
});

test("checkTreeFiles names a video extension specifically", () => {
  const files: FileTreeFileInput[] = [{ path: "assets/hero/x.mp4", size: 10, mode: 0o644 }];
  const reason = checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files });
  assert.equal(reason, "Can't publish: contains a video file (x.mp4)");
});

test("checkTreeFiles allows every extension for a code-class kind (agent-skill)", () => {
  const files: FileTreeFileInput[] = [{ path: "scripts/run.py", size: 10, mode: 0o644, textSample: "print(1)" }];
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "agent-skill", files }), null);
});

test("checkTreeFiles blocks a tree over the per-file byte cap", () => {
  const files: FileTreeFileInput[] = [{ path: "big.png", size: FILE_TREE_LIMITS.maxFileBytes + 1, mode: 0o644 }];
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files }) ?? "", /per-file limit/);
});

test("checkTreeFiles blocks a tree over the total byte cap", () => {
  const files: FileTreeFileInput[] = [
    { path: "a.png", size: FILE_TREE_LIMITS.maxTreeBytes, mode: 0o644 },
    { path: "b.png", size: 1, mode: 0o644 },
  ];
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files }) ?? "", /byte limit/);
});

test("checkTreeFiles blocks a tree over the file-count cap", () => {
  const files: FileTreeFileInput[] = Array.from({ length: FILE_TREE_LIMITS.maxTreeFiles + 1 }, (_, i) => ({
    path: `f${i}.txt`,
    size: 1,
    mode: 0o644,
  }));
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files }) ?? "", /file limit/);
});

test("normalizeMode collapses any exec bit to 0o755 and everything else to 0o644", () => {
  assert.equal(normalizeMode({ mode: 0o644 }), 0o644);
  assert.equal(normalizeMode({ mode: 0o600 }), 0o644);
  assert.equal(normalizeMode({ mode: 0o755 }), 0o755);
  assert.equal(normalizeMode({ mode: 0o700 }), 0o755);
  // setuid + world-writable + exec — must still collapse to plain 0o755, never carry setuid through.
  assert.equal(normalizeMode({ mode: 0o4777 }), 0o755);
  // setuid with no exec bit at all — collapses to plain 0o644, never carries setuid through either.
  assert.equal(normalizeMode({ mode: 0o4666 }), 0o644);
});

test("resolveTreeRelativePath rejects a wrong segment count and an invalid segment", () => {
  assert.equal(resolveTreeRelativePath({ kind: "theme-files", idSegments: ["static"] }), null);
  assert.equal(resolveTreeRelativePath({ kind: "theme-files", idSegments: ["static", "Basic Theme"] }), null);
  assert.equal(resolveTreeRelativePath({ kind: "theme-files", idSegments: ["static", ""] }), null);
  assert.equal(resolveTreeRelativePath({ kind: "theme-files", idSegments: ["static", "a".repeat(65)] }), null);
  assert.equal(resolveTreeRelativePath({ kind: "theme-files", idSegments: ["static", "basic"] }), "themes/static/basic");
});

test("checkMcpJsonSecretPlaceholders allows empty/placeholder env values and blocks a literal token", () => {
  assert.equal(checkMcpJsonSecretPlaceholders({ jsonText: JSON.stringify({ env: { API_KEY: "${API_KEY}", OTHER: "" } }) }), null);
  const blocked = checkMcpJsonSecretPlaceholders({ jsonText: JSON.stringify({ env: { API_KEY: "sk-live-abc123" } }) });
  assert.match(blocked ?? "", /move it to live's settings/);
  assert.equal(checkMcpJsonSecretPlaceholders({ jsonText: "not json" }), null);
});

test("MCP headers must be empty or placeholders, never literal credentials", () => {
  assert.equal(checkMcpJsonSecretPlaceholders({ jsonText: JSON.stringify({ headers: { Authorization: "${TOKEN}", Empty: "" } }) }), null);
  assert.equal(
    checkMcpJsonSecretPlaceholders({ jsonText: JSON.stringify({ headers: { Authorization: "Bearer literal-token" } }) }),
    "has a key written into mcp.json (headers.Authorization); move it to live's settings"
  );
});

test("NUL paths and sealed storage-secret filenames are refused", () => {
  assert.equal(checkTreePath({ relPath: "a\0b.json" }), '"a\0b.json" contains a NUL byte');
  for (const name of [".storage-secret.json", "nested/.storage-secret.json", ".storage-secret.json.bak"]) {
    assert.equal(checkTreePath({ relPath: name }), `"${name}" is a site's sealed database connection string`);
  }
});

test("wrapTreePolicyReason prefixes ordinary reasons and preserves final reasons", () => {
  assert.equal(wrapTreePolicyReason({ title: "Theme: static/basic", reason: '".env" looks like an environment file' }),
    'Theme: static/basic was not published: ".env" looks like an environment file');
  const finalReason = "Can't publish: contains a video file (hero.mp4)";
  assert.equal(wrapTreePolicyReason({ title: "Theme: static/basic", reason: finalReason }), finalReason);
});

test("license documents are text: accepted by identity, scanned for secrets, and never a blanket extensionless allowance", () => {
  for (const name of ["LICENSE", "COPYING", "NOTICE", "license"]) {
    const path = `assets/vendor/library/${name}`;
    assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files: [{ path, size: 12, mode: 0o644, textSample: "License text" }] }), null);
    assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files: [{ path, size: 12, mode: 0o644 }] }) ?? "", /missing the text required for its secret scan/);
    const secret = "sk-" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789longpathsegment";
    assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files: [{ path, size: secret.length, mode: 0o644, textSample: secret }] }) ?? "", /looks like it holds a key/);
  }
  for (const path of ["assets/vendor/library/RUN", "assets/vendor/library/LICENSE.sh"]) {
    assert.notEqual(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, kind: "theme-files", files: [{ path, size: 12, mode: 0o644, textSample: "License text" }] }), null);
  }
});
