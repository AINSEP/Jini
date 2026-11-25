/** L044 characterization: preserve first-refusal order and enforce secret scans. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { checkTreePath, checkTreeFiles, checkMcpJsonSecretPlaceholders, FILE_TREE_LIMITS, MAX_SECRET_SCAN_BYTES } from "../file-tree-policy.js";
import { fakeScanTextForSecrets, TEST_MAX_FILE_BYTES } from "./file-tree-policy.fixtures.js";

test("L044 path checks preserve shape, segment, name and extension precedence", () => {
  const cases: readonly [string, string | null][] = [
    ["", '"" is empty'], ["/x\\y", '"/x\\y" must be relative, not start with \'/\''],
    ["x\\y", '"x\\y" contains a backslash, which is never allowed in a tree path'],
    ["x\0", '"x\0" contains a NUL byte'], ["x//.env", '"x//.env" contains an empty path segment'],
    ["./x", '"./x" contains a \'.\' segment, which is never allowed'],
    ["x/../y", '"x/../y" contains a \'..\' segment, which is never allowed'],
    ["node_modules/.env", '"node_modules/.env" contains a \'node_modules\' segment, which is never published'],
    ["id_ed25519.bak", '"id_ed25519.bak" looks like a private SSH key'],
    ["x.storage-secret.json.bak", '"x.storage-secret.json.bak" is a site\'s sealed database connection string'],
    ["a.PFX", '"a.PFX" has a \'.pfx\' extension, which is never published'],
    ["nested/config.json", null], ["ok.html", null],
  ];
  for (const [value, expected] of cases) assert.equal(checkTreePath({ relPath: value }), expected);
  assert.match(checkTreePath({ relPath: "x".repeat(513) })!, /512-character/);
  assert.match(checkTreePath({ relPath: Array(17).fill("x").join("/") })!, /16-level/);
});

test("L044 tree checks preserve aggregate caps, collision ordering, extension and scan boundaries", () => {
  const file = { path: "ok.html", size: 1, mode: 0o644, textSample: "ok" };
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: Array(FILE_TREE_LIMITS.maxTreeFiles + 1).fill(file) })!, /file limit/);
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [{ ...file, size: FILE_TREE_LIMITS.maxTreeBytes + 1 }] })!, /byte limit/);
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [{ ...file, path: ".DS_Store" }] })!, /system file/);
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [file, { ...file, path: "OK.html", size: TEST_MAX_FILE_BYTES + 1 }] })!, /letter case/);
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [{ ...file, size: TEST_MAX_FILE_BYTES + 1 }] })!, /per-file/);
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [{ ...file, path: "clip.mp4" }] }), "Can't publish: contains a video file (clip.mp4)");
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [{ ...file, path: "app.exe" }] }), "Can't publish: contains a file type that isn't allowed (app.exe)");
  const secret = ["gh", "p_"].join("") + "A".repeat(36);
  assert.match(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [{ ...file, size: MAX_SECRET_SCAN_BYTES, textSample: secret }] })!, /holds a key/);
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [{ ...file, size: MAX_SECRET_SCAN_BYTES + 1, textSample: secret }] }), null);
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [{ ...file, path: "x.png", textSample: secret }] }), null);
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "agent-plugin", files: [{ ...file, path: "app.exe" }] }), null);
  assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind: "theme-files", files: [file] }), null);
});

test("L044 MCP scan checks nested literals while preserving malformed JSON handling", () => {
  for (const value of ["{", "null", "3", '{"env":null}']) {
    assert.equal(checkMcpJsonSecretPlaceholders({ jsonText: value }), null);
  }
  assert.equal(checkMcpJsonSecretPlaceholders({ jsonText: '{"env":{"empty":"","placeholder":"${TOKEN}","number":1}}' }), null);
  assert.match(checkMcpJsonSecretPlaceholders({ jsonText: '{"env":{"first":"literal"},"headers":{"second":"literal"}}' })!, /env.first/);
  assert.match(checkMcpJsonSecretPlaceholders({ jsonText: '{"headers":{"second":"literal"}}' })!, /headers.second/);
  for (const section of ["env", "headers"]) {
    const nested = { [section]: { nested: [{ key: "literal" }] } };
    assert.match(checkMcpJsonSecretPlaceholders({ jsonText: JSON.stringify(nested) })!, new RegExp(`${section}\\.nested\\.0\\.key`));
    assert.match(checkMcpJsonSecretPlaceholders({ jsonText: JSON.stringify({ mcpServers: { helper: nested } }) })!, /mcpServers.helper/);
    const safe = { [section]: { nested: [{ key: "${TOKEN}", empty: "", number: 1 }] } };
    assert.equal(checkMcpJsonSecretPlaceholders({ jsonText: JSON.stringify({ mcpServers: { helper: safe } }) }), null);
  }
});

test("L044 SSH basenames require an exact name or a literal dot suffix", () => {
  for (const name of ["id_rsa", "id_rsa.bak", "id_ed25519", "id_ed25519.bak"]) assert.match(checkTreePath({ relPath: name })!, /private SSH key/);
  for (const name of ["id_rsax", "id_ed25519x", "id_rsa\n", "id_ed25519\n"]) assert.equal(checkTreePath({ relPath: name }), null);
});

test("L044 absent text samples block qualifying files instead of bypassing the secret scan", () => {
  for (const kind of ["theme-files", "agent-plugin"] as const) {
    const file = { path: "secret.txt", size: 5, mode: 0o644 };
    assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind, files: [file] }), '"secret.txt" is missing the text required for its secret scan');
    assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind, files: [{ ...file, textSample: "safe" }] }), null);
    assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind, files: [{ ...file, size: MAX_SECRET_SCAN_BYTES + 1 }] }), null);
    assert.equal(checkTreeFiles({ scanTextForSecrets: fakeScanTextForSecrets, maxFileBytes: TEST_MAX_FILE_BYTES, kind, files: [{ ...file, path: "safe.png" }] }), null);
  }
});

test("security cleanup pins MCP traversal order, primitive leaves and section boundaries", () => {
  const cases: readonly [unknown, string | null][] = [
    [{ child: { env: { token: "nested" } }, headers: { token: "header" }, env: { token: "root" } }, "env.token"],
    [{ child: { env: { token: "nested" } }, headers: { token: "header" }, env: { token: "${TOKEN}" } }, "headers.token"],
    [{ first: null, second: 7, third: [{ env: { token: "${TOKEN}" } }, { headers: { token: "literal" } }] }, "third.1.headers.token"],
    [[{ env: { token: "literal" } }], "0.env.token"],
    [{ child: { env: { token: "literal" } }, later: { headers: { token: "literal" } } }, "child.env.token"],
    [{ env: { headers: "${TOKEN}", empty: "", number: 0, absent: null, flag: false }, headers: [], child: { safe: "literal outside a section" } }, null],
    [{ child: { env: { token: "${TOKEN}" } }, other: [{ headers: { token: "" } }] }, null],
    [{ env: { token: "prefix${TOKEN}" } }, "env.token"],
    [{ headers: { token: "${}" } }, "headers.token"],
    [null, null], [7, null], ["literal", null], [{}, null],
  ];
  for (const [value, section] of cases) {
    assert.equal(checkMcpJsonSecretPlaceholders({ jsonText: JSON.stringify(value) }), section === null ? null
      : `has a key written into mcp.json (${section}); move it to live's settings`);
  }
});
