import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import type { McpStdioLaunchSpec } from "../ports.js";
import {
  createBundledNodeLaunchResolver,
  IDENTITY_STDIO_LAUNCH_RESOLVER,
  McpLaunchUnavailableError,
  stdioLaunchResolverFromEnv,
} from "../stdio/stdio-launch-resolver.js";

/**
 * @file Tests for `stdio-launch-resolver.ts`, the desktop-only rewrite of stdio MCP launch specs
 * (`npx`/`npm`/`node` -> Electron's own Node via the bundled npm package; other bare commands ->
 * found on a widened PATH; an absolute command -> left alone) described in plan
 * `ADS-memory/.local-artifacts/plan-desktop-bundled-npx-2026-09-24.md` §2.
 *
 * Everything under test is pure: `fs` only through the injected `isExecutable`/`exists` seams, no
 * spawn, no logging. `createBundledNodeLaunchResolver` is exercised directly with an explicit
 * config so every branch of plan §2's table is pinned without touching the real filesystem;
 * `stdioLaunchResolverFromEnv` is exercised only for the two decisions that are its own —
 * whether to hand back identity at all.
 */

const NPX_CLI = "npx-cli.js";
const NPM_CLI = "npm-cli.js";

function spec(command: string, args: readonly string[] = [], overrides: Partial<McpStdioLaunchSpec> = {}): McpStdioLaunchSpec {
  return { command, args, env: { CONNECTION_ENV: "1" }, ...overrides };
}

const NPM_CONFIG_ENV = (toolchainDir: string) => ({
  npm_config_cache: `${toolchainDir}/npm-cache`,
  npm_config_prefix: `${toolchainDir}/npm-prefix`,
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
  npm_config_fetch_retries: "1",
  npm_config_fetch_retry_mintimeout: "2000",
  npm_config_fetch_retry_maxtimeout: "5000",
});

test("stdioLaunchResolverFromEnv: env missing both vars returns the identity resolver", () => {
  const s = spec("npx", ["-y", "pkg"]);
  for (const env of [{}]) {
    const resolver = stdioLaunchResolverFromEnv({ env: env, toolchainDirEnvVar: "EXAMPLE_NODE_TOOLCHAIN_DIR", npmRootEnvVar: "EXAMPLE_BUNDLED_NPM_ROOT", messages: federationMessages });
    assert.equal(resolver, IDENTITY_STDIO_LAUNCH_RESOLVER);
    assert.deepEqual(resolver.resolve({ spec: s }), { command: "npx", args: ["-y", "pkg"], cwd: undefined, env: s.env, launchEnv: {} });
  }
});

test("stdioLaunchResolverFromEnv: explicitly permitted missing npx-cli.js falls back to identity plus a warning", () => {
  const resolver = stdioLaunchResolverFromEnv({ env: { EXAMPLE_NODE_TOOLCHAIN_DIR: "/toolchain", EXAMPLE_BUNDLED_NPM_ROOT: "/npm" }, toolchainDirEnvVar: "EXAMPLE_NODE_TOOLCHAIN_DIR", npmRootEnvVar: "EXAMPLE_BUNDLED_NPM_ROOT", messages: federationMessages }, { exists: () => false, allowIdentityFallback: true });
  const s = spec("npx", ["-y", "pkg"]);
  const resolved = resolver.resolve({ spec: s });
  assert.equal(resolved.command, "npx");
  assert.deepEqual(resolved.args, ["-y", "pkg"]);
  assert.deepEqual(resolved.launchEnv, {});
  assert.equal(typeof resolved.warning, "string");
  assert.match(resolved.warning ?? "", /npx-cli\.js is missing/);
});

test("stdioLaunchResolverFromEnv: both vars set and npx-cli.js present delegates to the bundled resolver", () => {
  const resolver = stdioLaunchResolverFromEnv({ env: { EXAMPLE_NODE_TOOLCHAIN_DIR: "/toolchain", EXAMPLE_BUNDLED_NPM_ROOT: "/npm", PATH: "/usr/bin" }, toolchainDirEnvVar: "EXAMPLE_NODE_TOOLCHAIN_DIR", npmRootEnvVar: "EXAMPLE_BUNDLED_NPM_ROOT", messages: federationMessages }, { exists: () => true });
  const resolved = resolver.resolve({ spec: spec("npx", ["-y", "pkg"]) });
  assert.equal(resolved.command, process.execPath);
  assert.deepEqual(resolved.args, ["/npm/bin/npx-cli.js", "-y", "pkg"]);
  assert.equal(resolved.warning, undefined);
});

test("createBundledNodeLaunchResolver: posix npx is rewritten to execPath running npx-cli.js, launchEnv pinned exactly", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { execPath: "/Applications/Example.app/electron", platform: "linux", parentEnv: { PATH: "/usr/bin:/bin" } });
  const resolved = resolver.resolve({ spec: spec("npx", ["-y", "pkg"]) });
  assert.deepEqual(resolved, {
    command: "/Applications/Example.app/electron",
    args: [`/npm/bin/${NPX_CLI}`, "-y", "pkg"],
    cwd: undefined,
    env: { CONNECTION_ENV: "1" },
    launchEnv: {
      ELECTRON_RUN_AS_NODE: "1",
      PATH: "/toolchain/bin:/usr/bin:/bin",
      ...NPM_CONFIG_ENV("/toolchain"),
    },
    requestedCommand: "npx",
  });
});

test("createBundledNodeLaunchResolver: posix npm is rewritten to execPath running npm-cli.js", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { execPath: "/electron", platform: "linux", parentEnv: { PATH: "/usr/bin" } });
  const resolved = resolver.resolve({ spec: spec("npm", ["install"]) });
  assert.equal(resolved.command, "/electron");
  assert.deepEqual(resolved.args, [`/npm/bin/${NPM_CLI}`, "install"]);
  assert.deepEqual(resolved.launchEnv, {
    ELECTRON_RUN_AS_NODE: "1",
    PATH: "/toolchain/bin:/usr/bin",
    ...NPM_CONFIG_ENV("/toolchain"),
  });
});

test("createBundledNodeLaunchResolver: posix node is rewritten to execPath with args unchanged", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { execPath: "/electron", platform: "linux", parentEnv: { PATH: "/usr/bin" } });
  const resolved = resolver.resolve({ spec: spec("node", ["server.js"]) });
  assert.equal(resolved.command, "/electron");
  assert.deepEqual(resolved.args, ["server.js"]);
  assert.deepEqual(resolved.launchEnv, {
    ELECTRON_RUN_AS_NODE: "1",
    PATH: "/toolchain/bin:/usr/bin",
    ...NPM_CONFIG_ENV("/toolchain"),
  });
});

test("createBundledNodeLaunchResolver: win32 npx.cmd/npm.cmd/node.exe are matched too, using ';' and backslashes", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "C:\\toolchain", npmRoot: "C:\\npm" }, { execPath: "C:\\electron.exe", platform: "win32", parentEnv: { PATH: "C:\\Windows" } });

  const npx = resolver.resolve({ spec: spec("npx.cmd", ["-y", "pkg"]) });
  assert.equal(npx.command, "C:\\electron.exe");
  assert.deepEqual(npx.args, [`C:\\npm\\bin\\${NPX_CLI}`, "-y", "pkg"]);
  assert.equal(npx.launchEnv.PATH, "C:\\toolchain\\bin;C:\\Windows");
  assert.equal(npx.launchEnv.ELECTRON_RUN_AS_NODE, "1");

  const npm = resolver.resolve({ spec: spec("npm.cmd", ["install"]) });
  assert.deepEqual(npm.args, [`C:\\npm\\bin\\${NPM_CLI}`, "install"]);

  const node = resolver.resolve({ spec: spec("node.exe", ["server.js"]) });
  assert.equal(node.command, "C:\\electron.exe");
  assert.deepEqual(node.args, ["server.js"]);
});

test("createBundledNodeLaunchResolver: PATH order is toolchain bin, then parent PATH, then darwin well-known dirs, deduped", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { platform: "darwin", parentEnv: { PATH: "/usr/bin:/usr/local/bin", HOME: "/Users/op" } });
  const resolved = resolver.resolve({ spec: spec("node", []) });
  assert.equal(
    resolved.launchEnv.PATH,
    "/toolchain/bin:/usr/bin:/usr/local/bin:/opt/homebrew/bin:/Users/op/.local/bin:/Users/op/.cargo/bin",
  );
});

test("createBundledNodeLaunchResolver: darwin well-known $HOME dirs are skipped when HOME is unset", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { platform: "darwin", parentEnv: { PATH: "/usr/bin" } });
  const resolved = resolver.resolve({ spec: spec("node", []) });
  assert.equal(resolved.launchEnv.PATH, "/toolchain/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin");
});

test("createBundledNodeLaunchResolver: a bare non-Node command found on the search path resolves to its absolute path, no ELECTRON_RUN_AS_NODE", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { platform: "darwin", parentEnv: { PATH: "/usr/bin", HOME: "/Users/op" }, isExecutable: ({ candidatePath }) => candidatePath === "/Users/op/.local/bin/uvx" });
  const resolved = resolver.resolve({ spec: spec("uvx", ["mcp-server-thing"]) });
  assert.equal(resolved.command, "/Users/op/.local/bin/uvx");
  assert.deepEqual(resolved.args, ["mcp-server-thing"]);
  assert.equal("ELECTRON_RUN_AS_NODE" in resolved.launchEnv, false);
  assert.equal(resolved.launchEnv.PATH, "/toolchain/bin:/usr/bin:/opt/homebrew/bin:/usr/local/bin:/Users/op/.local/bin:/Users/op/.cargo/bin");
  assert.deepEqual(
    { ...resolved.launchEnv, PATH: undefined },
    { ...NPM_CONFIG_ENV("/toolchain"), PATH: undefined },
  );
});

for (const missing of ["uvx", "docker", "foo"] as const) {
  test(`createBundledNodeLaunchResolver: ${missing} not found on the search path throws McpLaunchUnavailableError with the exact §2 message`, () => {
    const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { platform: "linux", parentEnv: { PATH: "/usr/bin" }, isExecutable: () => false });
    assert.throws(
      () => resolver.resolve({ spec: spec(missing) }),
      (error: unknown) => {
        assert.ok(error instanceof McpLaunchUnavailableError);
        const message = (error as Error).message;
        assert.equal(message, `This server's command "${missing}" is unavailable. Ask the administrator to install or configure the required executable.`);
        return true;
      },
    );
  });
}

test("createBundledNodeLaunchResolver: an existing absolute command is left unchanged but still gets the PATH extras", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { platform: "linux", parentEnv: { PATH: "/usr/bin" }, isExecutable: ({ candidatePath }) => candidatePath === "/opt/vendor/server" });
  const resolved = resolver.resolve({ spec: spec("/opt/vendor/server", ["--flag"]) });
  assert.equal(resolved.command, "/opt/vendor/server");
  assert.deepEqual(resolved.args, ["--flag"]);
  assert.equal("ELECTRON_RUN_AS_NODE" in resolved.launchEnv, false);
  assert.equal(resolved.launchEnv.PATH, "/toolchain/bin:/usr/bin");
});

test("createBundledNodeLaunchResolver: a missing absolute command throws a generic McpLaunchUnavailableError", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { platform: "linux", parentEnv: { PATH: "/usr/bin" }, isExecutable: () => false });
  assert.throws(
    () => resolver.resolve({ spec: spec("/opt/vendor/missing-server", ["--flag"]) }),
    (error: unknown) => {
      assert.ok(error instanceof McpLaunchUnavailableError);
      assert.equal(
        (error as Error).message,
        'This server\'s command "/opt/vendor/missing-server" is unavailable. Ask the administrator to install or configure the required executable.',
      );
      return true;
    },
  );
});

test("createBundledNodeLaunchResolver: a relative command with a path separator is checked against the spec's cwd and left unchanged, not searched on PATH", () => {
  const checked: string[] = [];
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "/toolchain", npmRoot: "/npm" }, { platform: "linux", parentEnv: { PATH: "/usr/bin" }, isExecutable: ({ candidatePath }) => {
      checked.push(candidatePath);
      return candidatePath === "/work/bin/server";
    } });
  const resolved = resolver.resolve({ spec: spec("./bin/server", ["--flag"], { cwd: "/work" }) });
  assert.equal(resolved.command, "./bin/server");
  assert.deepEqual(resolved.args, ["--flag"]);
  assert.equal(resolved.cwd, "/work");
  assert.deepEqual(checked, ["/work/bin/server"]);
  assert.equal(resolved.launchEnv.PATH, "/toolchain/bin:/usr/bin");
});

test("createBundledNodeLaunchResolver: on win32 a bare command is also found as <name>.exe, as spawn itself would", () => {
  const resolver = createBundledNodeLaunchResolver({ messages: federationMessages, toolchainDir: "C:\\toolchain", npmRoot: "C:\\npm" }, { platform: "win32", parentEnv: { PATH: "C:\\tools" }, isExecutable: ({ candidatePath }) => candidatePath === "C:\\tools\\uvx.exe" });
  const resolved = resolver.resolve({ spec: spec("uvx", ["mcp-server-thing"]) });
  assert.equal(resolved.command, "C:\\tools\\uvx.exe");
  assert.equal("ELECTRON_RUN_AS_NODE" in resolved.launchEnv, false);
});
