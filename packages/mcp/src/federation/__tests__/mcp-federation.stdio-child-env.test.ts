import { messages as federationMessages, clientInfo, testPermissionGate } from "./fixtures.js";
import assert from "node:assert/strict";
import { test, onTestFinished, vi } from "vitest";

import { buildMcpChildEnv } from "../stdio/adapter.stdio.js";

/**
 * @file Tests for `buildMcpChildEnv`, the pure half of `spawnMcpStdioChannel`: exactly which
 * environment a federated MCP child process receives.
 *
 * The contract has one fixed part and two win32-only additions. On every platform the child gets
 * the explicit allowlist plus its connection's own `env`, and nothing else from the parent — most of
 * all never `EXAMPLE_AGENT_DAEMON_TOKEN`. On win32 only, the child also gets the handful of
 * non-secret variables Windows programs need to start at all, and — when the child is this very
 * process's own executable — the `ELECTRON_RUN_AS_NODE` mode this process itself runs in.
 *
 * Since the desktop-npx plan (S2), a third input layers in between: `launchEnv`, the resolver's own
 * additions (`ELECTRON_RUN_AS_NODE`, `PATH`, `npm_config_*`) from `stdio-launch-resolver.ts`. It sits
 * BETWEEN the inherited allowlist and the connection's own `specEnv` — `inherited < launchEnv <
 * specEnv` — so an operator's own `env` on a connection always has the last word, including an
 * explicit `PATH` that deliberately drops the toolchain shims. Omitting `launchEnv` entirely must
 * keep every non-desktop deployment byte-identical to before this parameter existed.
 */

const ELECTRON_EXE = "C:\\Program Files\\Example\\Example.exe";

/** A parent environment carrying every variable any branch reads, plus the ones that must never
 *  leak — `EXAMPLE_AGENT_DAEMON_TOKEN` from before this file existed, and (S2) the two desktop-only
 *  resolver-selection variables, which are read by `stdio-launch-resolver.ts` but must never
 *  themselves reach a federated child. */
function parentEnv(): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin",
    HOME: "/home/op",
    TMPDIR: "/tmp",
    EXAMPLE_AGENT_DAEMON_TOKEN: "daemon-secret",
    HTTPS_PROXY: "http://user:pass@proxy",
    ELECTRON_RUN_AS_NODE: "1",
    EXAMPLE_NODE_TOOLCHAIN_DIR: "/toolchain",
    EXAMPLE_BUNDLED_NPM_ROOT: "/npm-root",
    SystemRoot: "C:\\Windows",
    windir: "C:\\Windows",
    ComSpec: "C:\\Windows\\system32\\cmd.exe",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    USERPROFILE: "C:\\Users\\Op",
    APPDATA: "C:\\Users\\Op\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\Op\\AppData\\Local",
    TEMP: "C:\\Users\\Op\\AppData\\Local\\Temp",
    TMP: "C:\\Users\\Op\\AppData\\Local\\Temp",
  };
}

test("on POSIX the child env is exactly PATH/HOME/TMPDIR plus the connection env, nothing else", () => {
  for (const platform of ["darwin", "linux"] as const) {
    const env = buildMcpChildEnv({ command: ELECTRON_EXE, specEnv: { API_KEY: "k" } }, { platform, parentEnv: parentEnv(), execPath: ELECTRON_EXE });
    assert.deepEqual(env, { PATH: "/usr/bin", HOME: "/home/op", TMPDIR: "/tmp", API_KEY: "k" }, platform);
    // The two desktop-only resolver-selection variables must never reach the child, same as
    // `EXAMPLE_AGENT_DAEMON_TOKEN` — they select WHICH resolver runs, they are not something a
    // federated server should ever see.
    assert.equal(Object.hasOwn(env, "EXAMPLE_NODE_TOOLCHAIN_DIR"), false, platform);
    assert.equal(Object.hasOwn(env, "EXAMPLE_BUNDLED_NPM_ROOT"), false, platform);
  }
});

test("omitting launchEnv keeps the child env byte-identical to before launchEnv existed", () => {
  const withoutLaunchEnv = buildMcpChildEnv({ command: ELECTRON_EXE, specEnv: { API_KEY: "k" } }, { platform: "darwin", parentEnv: parentEnv(), execPath: ELECTRON_EXE });
  const withEmptyLaunchEnv = buildMcpChildEnv({ command: ELECTRON_EXE, specEnv: { API_KEY: "k" } }, { launchEnv: {}, platform: "darwin", parentEnv: parentEnv(), execPath: ELECTRON_EXE });
  assert.deepEqual(withoutLaunchEnv, { PATH: "/usr/bin", HOME: "/home/op", TMPDIR: "/tmp", API_KEY: "k" });
  assert.deepEqual(withEmptyLaunchEnv, withoutLaunchEnv);
});

test("launchEnv layers strictly between the inherited allowlist and the connection's own specEnv", () => {
  const env = buildMcpChildEnv({ command: ELECTRON_EXE, specEnv: { PATH: "/spec/bin", API_KEY: "k" } }, { launchEnv: { PATH: "/launch/bin", ELECTRON_RUN_AS_NODE: "1", npm_config_cache: "/toolchain/npm-cache" }, platform: "darwin", parentEnv: parentEnv(), execPath: ELECTRON_EXE });
  // specEnv's PATH beats launchEnv's PATH, which beats the inherited PATH — the connection's own
  // `env` always has the last word, including dropping the toolchain shims with its own PATH.
  assert.equal(env.PATH, "/spec/bin");
  assert.equal(env.API_KEY, "k");
  // launchEnv additions land when specEnv does not override them.
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.npm_config_cache, "/toolchain/npm-cache");
  // The inherited allowlist is still present underneath.
  assert.equal(env.HOME, "/home/op");
  assert.equal(env.TMPDIR, "/tmp");
});

test("launchEnv alone (no specEnv override) still reaches the child, layered over the inherited allowlist", () => {
  const env = buildMcpChildEnv({ command: ELECTRON_EXE, specEnv: {} }, { launchEnv: { PATH: "/launch/bin", npm_config_prefix: "/toolchain/npm-prefix" }, platform: "darwin", parentEnv: parentEnv(), execPath: ELECTRON_EXE });
  assert.equal(env.PATH, "/launch/bin");
  assert.equal(env.npm_config_prefix, "/toolchain/npm-prefix");
  assert.equal(env.HOME, "/home/op");
});

test("on win32 the child also inherits the non-secret variables Windows programs need to start", () => {
  const env = buildMcpChildEnv({ command: "C:\\tools\\server.exe", specEnv: {} }, { platform: "win32", parentEnv: parentEnv(), execPath: ELECTRON_EXE });
  assert.deepEqual(env, {
    PATH: "/usr/bin",
    HOME: "/home/op",
    TMPDIR: "/tmp",
    SystemRoot: "C:\\Windows",
    windir: "C:\\Windows",
    ComSpec: "C:\\Windows\\system32\\cmd.exe",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    USERPROFILE: "C:\\Users\\Op",
    APPDATA: "C:\\Users\\Op\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\Op\\AppData\\Local",
    TEMP: "C:\\Users\\Op\\AppData\\Local\\Temp",
    TMP: "C:\\Users\\Op\\AppData\\Local\\Temp",
  });
  // A child that is NOT this executable never receives this process's Electron run mode.
  assert.equal(Object.hasOwn(env, "ELECTRON_RUN_AS_NODE"), false);
  assert.equal(Object.hasOwn(env, "EXAMPLE_AGENT_DAEMON_TOKEN"), false);
  assert.equal(Object.hasOwn(env, "HTTPS_PROXY"), false);
});

test("on win32 a child that is this process's own executable runs in the same ELECTRON_RUN_AS_NODE mode", () => {
  const env = buildMcpChildEnv({ command: "c:\\program files\\example\\.\\EXAMPLE.EXE", specEnv: {} }, { platform: "win32", parentEnv: parentEnv(), execPath: ELECTRON_EXE });
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(Object.hasOwn(env, "EXAMPLE_AGENT_DAEMON_TOKEN"), false);
});

test("on win32 the run mode is not invented when this process does not itself run as node", () => {
  const parent = parentEnv();
  delete parent.ELECTRON_RUN_AS_NODE;
  const env = buildMcpChildEnv({ command: ELECTRON_EXE, specEnv: {} }, { platform: "win32", parentEnv: parent, execPath: ELECTRON_EXE });
  assert.equal(Object.hasOwn(env, "ELECTRON_RUN_AS_NODE"), false);
});

test("the connection's own env overrides an inherited variable of the same name", () => {
  const env = buildMcpChildEnv({ command: "C:\\tools\\server.exe", specEnv: { TEMP: "D:\\scratch" } }, { platform: "win32", parentEnv: parentEnv(), execPath: ELECTRON_EXE });
  assert.equal(env.TEMP, "D:\\scratch");
});

test("empty or absent parent values are not inherited", () => {
  const env = buildMcpChildEnv({ command: "C:\\tools\\server.exe", specEnv: {} }, { platform: "win32", parentEnv: { PATH: "", SystemRoot: "C:\\Windows" }, execPath: ELECTRON_EXE });
  assert.deepEqual(env, { SystemRoot: "C:\\Windows" });
});
