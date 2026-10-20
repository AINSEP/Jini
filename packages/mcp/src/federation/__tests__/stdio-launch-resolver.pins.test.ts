import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { defaultFederationMessages } from "../messages.js";
import type { FederationMessages } from "../messages.js";
import type { McpStdioLaunchSpec } from "../ports.js";
import { createBundledNodeLaunchResolver, McpLaunchUnavailableError, stdioLaunchResolverFromEnv } from "../stdio/stdio-launch-resolver.js";

// Characterization pins for stdio-launch-resolver.ts (SEC: decides WHAT a stdio connection spawns).
const spec = (command: string, overrides: Partial<McpStdioLaunchSpec> = {}): McpStdioLaunchSpec => ({ command, args: ["--a"], env: { K: "v" }, ...overrides });
const config = { messages: defaultFederationMessages, toolchainDir: "/tc", npmRoot: "/npm" };

/** Records what the resolver checked and answers from a fixed set of executable paths. */
function executables(paths: readonly string[], checked: string[] = []) {
  return ({ candidatePath }: { candidatePath: string }) => { checked.push(candidatePath); return paths.includes(candidatePath); };
}

const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("search path", () => {
  test("an unset parent PATH leaves only the toolchain bin on the child's PATH", () => {
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: {}, isExecutable: executables(["/tc/bin/uvx"]) });
    const resolved = resolver.resolve({ spec: spec("uvx") });
    expect([resolved.command, resolved.launchEnv.PATH]).toEqual(["/tc/bin/uvx", "/tc/bin"]);
  });

  test("empty PATH entries are dropped and the search runs in order", () => {
    const checked: string[] = [];
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: { PATH: "::/a::/b:" }, isExecutable: executables([], checked) });
    expect(() => resolver.resolve({ spec: spec("tool") })).toThrow(McpLaunchUnavailableError);
    expect(checked).toEqual(["/tc/bin/tool", "/a/tool", "/b/tool"]);
  });
});

describe("relative parent PATH entries", () => {
  test("a '.' PATH entry resolves a bare command to a bare name checked against the daemon cwd (reported, not fixed)", () => {
    // The executable check ran on "./tool" relative to the daemon's cwd, but spawn receives the bare
    // name "tool" and searches the child's PATH itself, so what runs may not be what was checked.
    const checked: string[] = [];
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: { PATH: ".:/usr/bin" }, isExecutable: executables(["tool"], checked) });
    expect(resolver.resolve({ spec: spec("tool") }).command).toBe("tool");
    expect(checked).toEqual(["/tc/bin/tool", "tool"]);
  });
});

describe("node toolchain commands", () => {
  test("npx.cmd is not a toolchain alias off win32; it is searched as a bare command", () => {
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: { PATH: "/usr/bin" }, execPath: "/electron", isExecutable: executables(["/usr/bin/npx.cmd"]) });
    const resolved = resolver.resolve({ spec: spec("npx.cmd") });
    expect(resolved).toEqual({ command: "/usr/bin/npx.cmd", args: ["--a"], cwd: undefined, env: { K: "v" }, launchEnv: expect.not.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }) });
  });

  test("node keeps its args and gets ELECTRON_RUN_AS_NODE plus the requested command", () => {
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: { PATH: "/usr/bin" }, execPath: "/electron", isExecutable: executables([]) });
    const resolved = resolver.resolve({ spec: spec("node", { cwd: "/w" }) });
    expect(resolved).toMatchObject({ command: "/electron", args: ["--a"], cwd: "/w", requestedCommand: "node", launchEnv: { ELECTRON_RUN_AS_NODE: "1", PATH: "/tc/bin:/usr/bin" } });
  });

  test("a toolchain command is rewritten without any executable check", () => {
    const checked: string[] = [];
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: {}, execPath: "/electron", isExecutable: executables([], checked) });
    expect(resolver.resolve({ spec: spec("npm") }).args).toEqual(["/npm/bin/npm-cli.js", "--a"]);
    expect(checked).toEqual([]);
  });
});

describe("path commands", () => {
  test("a relative path command without a cwd is checked against the process cwd", () => {
    const checked: string[] = [];
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: {}, isExecutable: executables([], checked) });
    expect(() => resolver.resolve({ spec: spec("./bin/server") })).toThrow(`This server's command "./bin/server" is unavailable.`);
    expect(checked).toEqual([path.posix.resolve(process.cwd(), "./bin/server")]);
  });

  test("a path command never falls back to the search path", () => {
    const checked: string[] = [];
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: { PATH: "/usr/bin" }, isExecutable: executables(["/usr/bin/server"], checked) });
    expect(() => resolver.resolve({ spec: spec("/missing/server") })).toThrow(McpLaunchUnavailableError);
    expect(checked).toEqual(["/missing/server"]);
  });

  test("on win32 a backslash command is a path command checked against its cwd", () => {
    const resolver = createBundledNodeLaunchResolver(config, { platform: "win32", parentEnv: {}, isExecutable: executables(["C:\\w\\bin\\server.exe"]) });
    const resolved = resolver.resolve({ spec: spec("bin\\server.exe", { cwd: "C:\\w" }) });
    expect([resolved.command, resolved.launchEnv.PATH]).toEqual(["bin\\server.exe", "\\tc\\bin"]);
  });

  test("off win32 a backslash is part of a bare name and is searched", () => {
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: {}, isExecutable: executables(["/tc/bin/a\\b"]) });
    expect(resolver.resolve({ spec: spec("a\\b") }).command).toBe("/tc/bin/a\\b");
  });

  test("the unavailable message is built from the command and the searched dirs", () => {
    const seen: unknown[] = [];
    const messages: FederationMessages = { ...defaultFederationMessages, launchUnavailable: input => { seen.push(input); return "no launch"; } };
    const resolver = createBundledNodeLaunchResolver({ ...config, messages }, { platform: "linux", parentEnv: { PATH: "/a" }, isExecutable: executables([]) });
    expect(() => resolver.resolve({ spec: spec("/x") })).toThrow(new McpLaunchUnavailableError({ message: "no launch" }));
    expect(() => resolver.resolve({ spec: spec("y") })).toThrow("no launch");
    expect(seen).toEqual([{ command: "/x", searchedDirs: ["/tc/bin", "/a"] }, { command: "y", searchedDirs: ["/tc/bin", "/a"] }]);
  });
});

describe("bare commands on win32", () => {
  test("a bare command with an extension is not retried with .exe", () => {
    const checked: string[] = [];
    const resolver = createBundledNodeLaunchResolver(config, { platform: "win32", parentEnv: { PATH: "C:\\t" }, isExecutable: executables([], checked) });
    expect(() => resolver.resolve({ spec: spec("tool.bat") })).toThrow(McpLaunchUnavailableError);
    expect(checked).toEqual(["\\tc\\bin\\tool.bat", "C:\\t\\tool.bat"]);
  });

  test("an extensionless bare command tries the name then name.exe per dir", () => {
    const checked: string[] = [];
    const resolver = createBundledNodeLaunchResolver(config, { platform: "win32", parentEnv: { PATH: "C:\\t" }, isExecutable: executables([], checked) });
    expect(() => resolver.resolve({ spec: spec("uvx") })).toThrow(McpLaunchUnavailableError);
    expect(checked).toEqual(["\\tc\\bin\\uvx", "\\tc\\bin\\uvx.exe", "C:\\t\\uvx", "C:\\t\\uvx.exe"]);
  });
});

describe("default filesystem executable check", () => {
  function tempBin(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "launch-pin-"));
    tempDirs.push(dir);
    return dir;
  }

  test("an executable file on the parent PATH is found through the real filesystem check", () => {
    const dir = tempBin();
    fs.writeFileSync(path.join(dir, "tool"), "#!/bin/sh\n", { mode: 0o755 });
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: { PATH: dir } });
    expect(resolver.resolve({ spec: spec("tool") }).command).toBe(path.join(dir, "tool"));
  });

  test("a non-executable file on the parent PATH is not launched", () => {
    const dir = tempBin();
    fs.writeFileSync(path.join(dir, "tool"), "data", { mode: 0o644 });
    const resolver = createBundledNodeLaunchResolver(config, { platform: "linux", parentEnv: { PATH: dir } });
    expect(() => resolver.resolve({ spec: spec("tool") })).toThrow(`This server's command "tool" is unavailable.`);
  });
});

describe("stdioLaunchResolverFromEnv refusals", () => {
  const vars = { toolchainDirEnvVar: "TC", npmRootEnvVar: "NR", messages: defaultFederationMessages };

  test("one variable set and one unset refuses without explicit fallback", () => {
    expect(() => stdioLaunchResolverFromEnv({ ...vars, env: { TC: "/tc" } })).toThrow(new McpLaunchUnavailableError({ message: "mcp-federation: TC and NR must both be set to non-empty paths." }));
  });

  test("an empty variable refuses even when the other is set", () => {
    expect(() => stdioLaunchResolverFromEnv({ ...vars, env: { TC: "", NR: "/npm" } })).toThrow("mcp-federation: TC and NR must both be set to non-empty paths.");
  });

  test("a missing npx-cli.js refuses without explicit fallback", () => {
    expect(() => stdioLaunchResolverFromEnv({ ...vars, env: { TC: "/tc", NR: "/npm" } }, { exists: () => false }))
      .toThrow("mcp-federation: NR is set (/npm) but /npm/bin/npx-cli.js is missing");
  });

  test("a permitted fallback for an unset variable resolves identity with the warning", () => {
    const resolver = stdioLaunchResolverFromEnv({ ...vars, env: { NR: "/npm" } }, { allowIdentityFallback: true });
    expect(resolver.resolve({ spec: spec("uvx") })).toEqual({
      command: "uvx", args: ["--a"], cwd: undefined, env: { K: "v" }, launchEnv: {},
      warning: "mcp-federation: TC and NR must both be set to non-empty paths.; falling back to identity stdio launch resolution instead of the bundled Node toolchain.",
    });
  });

  test("a present npx-cli.js is probed at <npmRoot>/bin/npx-cli.js and yields the bundled resolver", () => {
    const probed: string[] = [];
    const resolver = stdioLaunchResolverFromEnv({ ...vars, env: { TC: "/tc", NR: "/npm", PATH: "/p" } }, { exists: ({ candidatePath }) => { probed.push(candidatePath); return true; } });
    expect(probed).toEqual(["/npm/bin/npx-cli.js"]);
    expect(resolver.resolve({ spec: spec("npx") }).args).toEqual(["/npm/bin/npx-cli.js", "--a"]);
  });
});
