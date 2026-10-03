import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import { createStderrTail, describeChildExit, keepStderrTail, resolveStdioChildCwd, spawnMcpStdioChannel } from "../stdio/adapter.stdio.js";
import { createBundledNodeLaunchResolver } from "../stdio/stdio-launch-resolver.js";

/**
 * @file A stdio MCP server that dies at startup must say WHY in its close reason.
 *
 * 2026-09-29: the dev roster's `namecom` row (`npx -y namecom-mcp@latest`) exited with code 1 on
 * every daemon boot. npm printed the cause (`EUNSUPPORTEDPROTOCOL` — see the cwd tests below) to
 * stderr; the adapter discarded stderr, so the admissions report carried only "child process exited
 * (code=1, signal=null)" and the admin told the owner to restart — which re-ran the same failure. The reason
 * reaches the admin UI, so the child's own env values (the row's unsealed credentials) must never
 * appear in it.
 */

test("describeChildExit: appends what the child last printed, whitespace-collapsed", () => {
  assert.equal(
    describeChildExit({ code: 1, signal: null, stderrTail: "\nError: Invalid NAME_API_URL provided: https://api.dev.name.com\n\n  Please use one of the supported endpoints\n", secretValues: [] }),
    "child process exited (code=1, signal=null): Error: Invalid NAME_API_URL provided: https://api.dev.name.com Please use one of the supported endpoints",
  );
});

test("describeChildExit: a silent child keeps the exact pre-existing reason", () => {
  assert.equal(describeChildExit({ code: 1, signal: null, stderrTail: "  \n", secretValues: [] }), "child process exited (code=1, signal=null)");
  assert.equal(describeChildExit({ code: null, signal: "SIGTERM", stderrTail: "", secretValues: ["secret-value"] }), "child process exited (code=null, signal=SIGTERM)");
});

test("describeChildExit: redacts every env value the child was spawned with, wherever it appears", () => {
  const reason = describeChildExit({ code: 1, signal: null, stderrTail: "auth failed for user leona with token tok_live_abc123 (tok_live_abc123)", secretValues: [
    "leona",
    "tok_live_abc123",
  ] });
  assert.equal(reason, "child process exited (code=1, signal=null): auth failed for user [redacted] with token [redacted] ([redacted])");
});

test("describeChildExit: does not shred the message over a value too short to be a credential", () => {
  assert.equal(describeChildExit({ code: 1, signal: null, stderrTail: "port 1 is in use", secretValues: ["1"] }), "child process exited (code=1, signal=null): port 1 is in use");
});

test("keepStderrTail: keeps only the most recent output, so a chatty server cannot grow the reason unbounded", () => {
  let tail = "";
  for (let index = 0; index < 1_000; index += 1) tail = keepStderrTail({ tail: tail, chunk: `line ${index}\n` });
  assert.equal(tail.length, 600);
  assert.ok(tail.endsWith("line 999\n"));
});

test("spawnMcpStdioChannel: a real child that dies at startup closes with its stderr, secrets redacted", async () => {
  const channel = spawnMcpStdioChannel({ messages: federationMessages, command: process.execPath, args: [
      "-e",
      "console.error('Error: Invalid NAME_API_URL provided: ' + process.env.NAME_API_URL + ' token=' + process.env.NAME_TOKEN); process.exit(1);",
    ], env: { NAME_API_URL: "https://api.dev.name.com", NAME_TOKEN: "abcd-secret-token-9999" }, launchEnv: {} });

  const reason = await new Promise<string>((resolve) => channel.onClose({ listener: ({ reason }) => (resolve)(reason) }));

  assert.match(reason, /^child process exited \(code=1, signal=null\): Error: Invalid NAME_API_URL provided: \[redacted\] token=\[redacted\]$/);
  assert.ok(!reason.includes("abcd-secret-token-9999"));
});

test("spawnMcpStdioChannel: send after the child exited throws instead of writing into a dead pipe", async () => {
  const channel = spawnMcpStdioChannel({ messages: federationMessages, command: process.execPath, args: ["-e", "process.exit(3)"], env: {}, launchEnv: {} });

  await new Promise<string>((resolve) => channel.onClose({ listener: ({ reason }) => (resolve)(reason) }));

  assert.throws(() => channel.send({ message: "{}" }), /cannot write to a closed stdio channel/);
});

// The failure the stderr tail above uncovered: `npx` run in the daemon's cwd (this repo's root) read
// the local project tree and died with EUNSUPPORTEDPROTOCOL on a linked package's `workspace:*`.
test("resolveStdioChildCwd: a package runner with no configured cwd runs in the neutral directory, not the daemon's", () => {
  const launch = { command: "npx", args: ["-y", "namecom-mcp@latest"], env: {}, launchEnv: {} };
  assert.equal(resolveStdioChildCwd({ resolved: launch }, { neutralDir: "/neutral" }), "/neutral");
  assert.equal(resolveStdioChildCwd({ resolved: { ...launch, command: "/usr/local/bin/npx" } }, { neutralDir: "/neutral" }), "/neutral");
  assert.equal(resolveStdioChildCwd({ resolved: { ...launch, command: "C:/Program Files/nodejs/npx.cmd" } }, { neutralDir: "/neutral" }), "/neutral");
});

test("resolveStdioChildCwd: an explicit cwd always wins, even for a package runner", () => {
  assert.equal(resolveStdioChildCwd({ resolved: { command: "npx", args: [], cwd: "/srv/project", env: {}, launchEnv: {} } }, { neutralDir: "/neutral" }), "/srv/project");
});

test("resolveStdioChildCwd: every other command keeps inheriting the daemon's cwd, exactly as before", () => {
  assert.equal(resolveStdioChildCwd({ resolved: { command: "./bin/server", args: [], env: {}, launchEnv: {} } }, { neutralDir: "/neutral" }), undefined);
  assert.equal(resolveStdioChildCwd({ resolved: { command: process.execPath, args: ["server.js"], env: {}, launchEnv: {} } }, { neutralDir: "/neutral" }), undefined);
  assert.equal(resolveStdioChildCwd({ resolved: { command: "uvx", args: ["some-server"], env: {}, launchEnv: {} } }, { neutralDir: "/neutral" }), undefined);
});

// Codex review 2026-09-29 run1 #2: the tail was cut to its last 600 characters BEFORE redaction, so
// a child printing a token followed by ~600 characters of diagnostics left the tail starting midway
// through the token — a fragment no exact-value replacement can match, served to the admin UI.
test("spawnMcpStdioChannel: a token cut by the tail limit is still redacted, not left as a fragment", async () => {
  const token = "tok_0123456789abcdef";
  const channel = spawnMcpStdioChannel({ messages: federationMessages, command: process.execPath, args: ["-e", "process.stderr.write('token=' + process.env.TOKEN + ' ' + 'x'.repeat(595)); process.exit(1);"], env: { TOKEN: token }, launchEnv: {} });

  const reason = await new Promise<string>((resolve) => channel.onClose({ listener: ({ reason }) => (resolve)(reason) }));

  for (let start = 0; start + 4 <= token.length; start += 1) {
    assert.ok(!reason.includes(token.slice(start)), `reason leaks "${token.slice(start)}": ${reason}`);
  }
});

test("createStderrTail: a token split across chunks and cut by the limit leaves no fragment behind", () => {
  const token = "tok_0123456789abcdef";
  const tail = createStderrTail({ secretValues: [token] });
  tail.append({ chunk: "token=tok_01234" });
  tail.append({ chunk: `56789abcdef ${"x".repeat(595)}` });
  const text = tail.text();
  assert.equal(text.length, 600);
  for (let start = 0; start + 4 <= token.length; start += 1) assert.ok(!text.includes(token.slice(start)), text);
});

test("createStderrTail: a token still arriving when the child exits is redacted too", () => {
  const tail = createStderrTail({ secretValues: ["tok_0123456789abcdef"] });
  tail.append({ chunk: "auth failed: tok_0123456789abcdef" });
  assert.equal(tail.text(), "auth failed: [redacted]");
  const partial = createStderrTail({ secretValues: ["tok_0123456789abcdef"] });
  partial.append({ chunk: "auth failed: tok_0123456789" });
  assert.equal(partial.text(), "auth failed: tok_0123456789");
});

// Codex review 2026-09-29 run1 #4: on desktop the resolver rewrites `npx` to Electron running
// `npx-cli.js` before the cwd is chosen, so a basename check on the rewritten command saw Electron
// and kept the project cwd — the exact npm EUNSUPPORTEDPROTOCOL failure the neutral cwd exists for.
test("resolveStdioChildCwd: desktop's rewritten npx (Electron + npx-cli.js) still runs in the neutral directory", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { execPath: "/Applications/Example.app/Contents/MacOS/Example", platform: "darwin", parentEnv: { PATH: "/usr/bin" } });
  const resolved = resolver.resolve({ spec: { command: "npx", args: ["-y", "namecom-mcp@latest"], env: {} } });
  assert.equal(resolved.command, "/Applications/Example.app/Contents/MacOS/Example");
  assert.equal(resolveStdioChildCwd({ resolved: resolved }, { neutralDir: "/neutral" }), "/neutral");
});

// Codex review 2026-09-29 run1 #5: a relative runner path resolves against the child's cwd, so
// moving `./node_modules/.bin/npx` to the neutral directory made it ENOENT.
test("resolveStdioChildCwd: a relative package-runner path keeps the daemon's cwd it is relative to", () => {
  assert.equal(resolveStdioChildCwd({ resolved: { command: "./node_modules/.bin/npx", args: [], env: {}, launchEnv: {} } }, { neutralDir: "/neutral" }), undefined);
  assert.equal(resolveStdioChildCwd({ resolved: { command: "node_modules/.bin/npx", args: [], env: {}, launchEnv: {} } }, { neutralDir: "/neutral" }), undefined);
});
