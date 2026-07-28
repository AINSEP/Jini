import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// `node:fs/promises`'s named exports are frozen ESM module-namespace bindings
// that `vi.spyOn` cannot redefine (`Cannot redefine property`), and this
// package's source files call them as plain destructured imports (`stat(x)`,
// not `fsp.stat(x)`), so a property-mutation spy on an imported namespace
// object never reaches those call sites either — verified empirically this
// session. `vi.mock` is the mechanism that actually works here: it replaces
// the module for every importer (including `../fs.js`/`../download.js`)
// before any of them load, so a per-test `.mockImplementationOnce` on the
// wrapped `vi.fn()` reaches the real call site deterministically, without any
// OS permission enforcement.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: vi.fn(actual.rm),
    stat: vi.fn(actual.stat),
  };
});

import {
  atomicCopyFile,
  collectProcessTreePids,
  createCommandInvocation,
  createPackageManagerInvocation,
  createProcessStampArgs,
  isProcessAlive,
  matchesProcessStamp,
  matchesStampedProcess,
  mergeProxyAwareEnv,
  parseMacosScutilProxyOutput,
  parseWindowsInternetSettingsProxyOutput,
  pathContains,
  readFlagValue,
  readLogTail,
  readProcessStamp,
  readProcessStampFromCommand,
  removePathBestEffort,
  resolveSystemProxyEnv,
  waitForHttpOk,
  wellKnownUserToolchainBins,
  type ProcessStampContract,
} from "../index.js";

// root (CAP_DAC_OVERRIDE) always bypasses a directory's own permission bits, so `chmod(dir,
// 0o000)` cannot actually block root's own read/write/remove access the way a couple of tests
// below rely on — a real POSIX invariant (matches the identical, already-established precedent in
// packages/agent-runtime/src/__tests__/launch.test.ts's `isRoot`-guarded codex test, and this same
// package's own download.test.ts).
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

/**
 * A minimal fake stamp contract, standing in for a real consumer's process
 * stamp shape — proves `process.ts` carries no product-specific assumptions.
 */
type FakeStamp = {
  app: "api" | "ui";
  namespace: string;
};

const fakeStampContract: ProcessStampContract<FakeStamp> = {
  stampFields: ["app", "namespace"],
  stampFlags: { app: "--fake-app", namespace: "--fake-namespace" },
  normalizeStamp(input) {
    const value = input as Partial<FakeStamp>;
    if (value.app !== "api" && value.app !== "ui") throw new Error("invalid app");
    if (typeof value.namespace !== "string" || value.namespace.length === 0) {
      throw new Error("invalid namespace");
    }
    return { app: value.app, namespace: value.namespace };
  },
  normalizeStampCriteria(input = {}) {
    const value = input as Partial<FakeStamp>;
    return {
      ...(value.app == null ? {} : { app: value.app }),
      ...(value.namespace == null ? {} : { namespace: value.namespace }),
    };
  },
};

const tempDirsToClean: string[] = [];

afterEach(async () => {
  while (tempDirsToClean.length > 0) {
    const dir = tempDirsToClean.pop();
    if (dir) await rm(dir, { force: true, recursive: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirsToClean.push(dir);
  return dir;
}

describe("@injini/platform — command", () => {
  it("passes non-Windows-shim commands straight through", () => {
    const invocation = createCommandInvocation({ args: ["--version"], command: "node" });
    expect(invocation).toEqual({ args: ["--version"], command: "node" });
  });

  it("builds a package-manager invocation from npm_execpath when present", () => {
    const invocation = createPackageManagerInvocation(["install"], { npm_execpath: "/usr/lib/pnpm/bin/pnpm.cjs" });
    expect(invocation.args).toEqual(["/usr/lib/pnpm/bin/pnpm.cjs", "install"]);
    expect(invocation.command).toBe(process.execPath);
  });
});

describe("@injini/platform — process stamps", () => {
  const stamp: FakeStamp = { app: "ui", namespace: "alpha" };

  it("round-trips a stamp through args, flag reads, and decode", () => {
    const args = createProcessStampArgs(stamp, fakeStampContract);
    expect(args).toEqual(["--fake-app=ui", "--fake-namespace=alpha"]);

    expect(readFlagValue(args, "--fake-app")).toBe("ui");
    expect(readFlagValue(["--fake-app", "ui"], "--fake-app")).toBe("ui");
    expect(readFlagValue(args, "--missing")).toBeNull();

    expect(readProcessStamp(args, fakeStampContract)).toEqual(stamp);
    expect(readProcessStampFromCommand(`node server.js ${args.join(" ")}`, fakeStampContract)).toEqual(stamp);
  });

  it("matches partial criteria and rejects mismatched criteria", () => {
    expect(matchesProcessStamp(stamp, { app: "ui" }, fakeStampContract)).toBe(true);
    expect(matchesProcessStamp(stamp, { app: "api" }, fakeStampContract)).toBe(false);
    expect(matchesProcessStamp(stamp, undefined, fakeStampContract)).toBe(true);

    const command = `node server.js ${createProcessStampArgs(stamp, fakeStampContract).join(" ")}`;
    expect(matchesStampedProcess({ command }, { namespace: "alpha" }, fakeStampContract)).toBe(true);
    expect(matchesStampedProcess({ command: "node unrelated.js" }, { namespace: "alpha" }, fakeStampContract)).toBe(
      false,
    );
  });

  it("collects a process tree from a snapshot list, roots-and-descendants, deepest first", () => {
    const processes = [
      { command: "root", pid: 1, ppid: 0 },
      { command: "child-a", pid: 2, ppid: 1 },
      { command: "child-b", pid: 3, ppid: 1 },
      { command: "grandchild", pid: 4, ppid: 2 },
      { command: "unrelated", pid: 5, ppid: 0 },
    ];
    const pids = collectProcessTreePids(processes, [1]);
    expect(pids).toEqual([4, 3, 2, 1]);
  });

  it("reports the current process as alive and treats invalid pids as dead", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(null)).toBe(false);
    expect(isProcessAlive(undefined)).toBe(false);
  });
});

describe("@injini/platform — fs", () => {
  it("containment: descendants pass, sibling/parent escapes fail, root itself passes", () => {
    expect(pathContains("/repo/root", "/repo/root/child")).toBe(true);
    expect(pathContains("/repo/root", "/repo/root")).toBe(true);
    expect(pathContains("/repo/root", "/repo/root/../sibling")).toBe(false);
    expect(pathContains("/repo/root", "/repo/other")).toBe(false);
  });

  it("atomically copies a file, refuses to clobber, and allows overwrite", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const source = join(dir, "source.txt");
    const destination = join(dir, "nested", "destination.txt");
    await writeFile(source, "hello world", "utf8");

    const result = await atomicCopyFile(source, destination);
    expect(result).toEqual({ bytesCopied: "hello world".length, replaced: false });
    expect(await readFile(destination, "utf8")).toBe("hello world");

    await expect(atomicCopyFile(source, destination)).rejects.toThrow(/destination already exists/);

    await writeFile(source, "updated content", "utf8");
    const overwritten = await atomicCopyFile(source, destination, { overwrite: true });
    expect(overwritten.replaced).toBe(true);
    expect(await readFile(destination, "utf8")).toBe("updated content");
  });

  it("removes a path best-effort and reports success", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const target = join(dir, "to-remove.txt");
    await writeFile(target, "bye", "utf8");

    const result = await removePathBestEffort(target);
    expect(result).toEqual({ removed: true });
    await expect(stat(target)).rejects.toThrow();
  });

  it("reads the trailing non-empty lines of a log file, and returns empty for a missing file", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const logPath = join(dir, "out.log");
    await writeFile(logPath, "line1\nline2\n\nline3\n", "utf8");

    expect(await readLogTail(logPath, 2)).toEqual(["line2", "line3"]);
    expect(await readLogTail(join(dir, "missing.log"))).toEqual([]);
  });

  it("treats a same-path copy of a file as a no-op that reports the existing size", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const file = join(dir, "same.txt");
    await writeFile(file, "unchanged", "utf8");

    const result = await atomicCopyFile(file, file);
    expect(result).toEqual({ bytesCopied: "unchanged".length, replaced: true });
    expect(await readFile(file, "utf8")).toBe("unchanged");
  });

  it("refuses a same-path copy when the shared path is a directory, not a file", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const sameDir = join(dir, "samedir");
    await mkdir(sameDir);

    await expect(atomicCopyFile(sameDir, sameDir)).rejects.toThrow(/destination is not a file/);
  });

  it.skipIf(isRoot)("propagates a non-ENOENT error from the destination existence check (real chmod, non-root)", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const source = join(dir, "source.txt");
    await writeFile(source, "data", "utf8");
    const restrictedDir = join(dir, "restricted");
    await mkdir(restrictedDir);
    const destination = join(restrictedDir, "dest.txt");

    // No read/execute on the destination's parent: stat(destination) fails
    // with EACCES rather than the ENOENT the "does not exist yet" path
    // expects, so the error must be rethrown rather than treated as "new".
    await chmod(restrictedDir, 0o000);
    try {
      await expect(atomicCopyFile(source, destination)).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(restrictedDir, 0o755);
    }
  });

  it("propagates a non-ENOENT error from the destination existence check (mocked stat, root-independent)", async () => {
    // Same code path as the chmod-based test above, but reached
    // deterministically via an injected error rather than relying on OS
    // permission enforcement — root's CAP_DAC_OVERRIDE makes the chmod
    // approach unusable in that environment (see this file's `isRoot` note
    // and the `vi.mock("node:fs/promises", ...)` note above the imports).
    const dir = await makeTempDir("jini-platform-fs-");
    const source = join(dir, "source.txt");
    await writeFile(source, "data", "utf8");
    const destination = join(dir, "dest.txt");

    const fsPromises = await import("node:fs/promises");
    vi.mocked(fsPromises.stat).mockImplementationOnce(async (p) => {
      if (p === destination) {
        const err = new Error("EACCES: permission denied, stat") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      return stat(p as string);
    });
    try {
      await expect(atomicCopyFile(source, destination)).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      vi.mocked(fsPromises.stat).mockClear();
    }
  });

  it("cleans up the temp file and rethrows when the copy itself fails", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const sourceDir = join(dir, "a-directory-not-a-file");
    await mkdir(sourceDir);
    const destination = join(dir, "dest.txt");

    // A directory source makes the underlying copyFile() call itself fail,
    // exercising the outer try/catch's temp-file cleanup + rethrow.
    await expect(atomicCopyFile(sourceDir, destination)).rejects.toThrow();
    await expect(stat(destination)).rejects.toThrow();
  });

  it.skipIf(isRoot)("reports the failure message when a best-effort removal itself fails (real chmod, non-root)", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const blocked = join(dir, "blocked");
    await mkdir(blocked);
    await writeFile(join(blocked, "nested.txt"), "x", "utf8");

    // No read/execute on the target itself: recursive removal can't list its
    // contents, so `rm` throws EACCES instead of quietly succeeding — force
    // only suppresses "already gone", not "can't get in".
    await chmod(blocked, 0o000);
    try {
      const result = await removePathBestEffort(blocked, { recursive: true });
      expect(result.removed).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      await chmod(blocked, 0o755);
    }
  });

  it("reports the failure message when a best-effort removal itself fails (mocked rm, root-independent)", async () => {
    const dir = await makeTempDir("jini-platform-fs-");
    const blocked = join(dir, "blocked");
    await mkdir(blocked);

    const fsPromises = await import("node:fs/promises");
    vi.mocked(fsPromises.rm).mockImplementationOnce(async () => {
      const err = new Error("EACCES: permission denied, rm") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    });
    const result = await removePathBestEffort(blocked, { recursive: true });
    expect(result.removed).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("treats a stat rejection with no .code property as a real (non-ENOENT) failure and rethrows it", async () => {
    // fs.ts's internal errorCode() helper's "no `code` in error" branch: a
    // thrown value can be an object without a `code` at all (unlike a real
    // Node fs error, which always sets one) — errorCode must not crash, and
    // atomicCopyFile must still rethrow rather than treat it as "new".
    const dir = await makeTempDir("jini-platform-fs-");
    const source = join(dir, "source.txt");
    await writeFile(source, "data", "utf8");
    const destination = join(dir, "dest.txt");

    const fsPromises = await import("node:fs/promises");
    vi.mocked(fsPromises.stat).mockImplementationOnce(async (p) => {
      if (p === destination) throw new Error("a stat failure with no .code at all");
      return stat(p as string);
    });
    await expect(atomicCopyFile(source, destination)).rejects.toThrow("a stat failure with no .code at all");
  });

  it("treats a stat rejection with an explicit null .code as not-ENOENT and rethrows it", async () => {
    // errorCode()'s "code == null" branch: `code` present on the error but
    // explicitly null/undefined rather than absent.
    const dir = await makeTempDir("jini-platform-fs-");
    const source = join(dir, "source.txt");
    await writeFile(source, "data", "utf8");
    const destination = join(dir, "dest.txt");

    const fsPromises = await import("node:fs/promises");
    vi.mocked(fsPromises.stat).mockImplementationOnce(async (p) => {
      if (p === destination) {
        throw Object.assign(new Error("stat failure with a null code"), { code: null });
      }
      return stat(p as string);
    });
    await expect(atomicCopyFile(source, destination)).rejects.toThrow("stat failure with a null code");
  });

  it("reports a non-Error rejection's stringified value when a best-effort removal fails", async () => {
    // fs.ts's internal errorMessage() helper's non-Error branch.
    const dir = await makeTempDir("jini-platform-fs-");
    const blocked = join(dir, "blocked-non-error");
    await mkdir(blocked);

    const fsPromises = await import("node:fs/promises");
    vi.mocked(fsPromises.rm).mockImplementationOnce(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error
      throw "a plain string rejection reason";
    });
    const result = await removePathBestEffort(blocked, { recursive: true });
    expect(result.removed).toBe(false);
    expect(result.error).toBe("a plain string rejection reason");
  });
});

describe("@injini/platform — http", () => {
  it("resolves once the URL answers OK, retrying through initial failures", async () => {
    let requestCount = 0;
    const server = createServer((_req, res) => {
      requestCount += 1;
      if (requestCount < 3) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200).end("ok");
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (address == null || typeof address === "string") throw new Error("expected a TCP address");

    try {
      await expect(waitForHttpOk(`http://127.0.0.1:${address.port}/`, { timeoutMs: 5000 })).resolves.toBe(true);
      expect(requestCount).toBeGreaterThanOrEqual(3);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("rejects once the timeout elapses without an OK response", async () => {
    await expect(waitForHttpOk("http://127.0.0.1:1/", { timeoutMs: 200 })).rejects.toThrow(/timed out waiting for/);
  });
});

describe("@injini/platform — proxy-env", () => {
  it("merges layered sources, canonicalizing proxy variable spellings", () => {
    const merged = mergeProxyAwareEnv(
      "darwin",
      { HTTP_PROXY: "http://proxy.example:8080", PATH: "/usr/bin" },
      { https_proxy: "http://proxy.example:8443" },
    );
    expect(merged.HTTP_PROXY).toBe("http://proxy.example:8080");
    expect(merged.HTTPS_PROXY).toBe("http://proxy.example:8443");
    expect(merged.https_proxy).toBe("http://proxy.example:8443");
    expect(merged.PATH).toBe("/usr/bin");
    expect(merged.NODE_USE_ENV_PROXY).toBe("1");
  });

  it("parses macOS scutil proxy output into a normalized env", () => {
    const scutilOutput = [
      "HTTPEnable : 1",
      "HTTPProxy : proxy.example",
      "HTTPPort : 8080",
      "HTTPSEnable : 0",
      "ExceptionsList : <array> {",
      "  0 : *.internal",
      "}",
    ].join("\n");
    const env = parseMacosScutilProxyOutput(scutilOutput, "darwin");
    expect(env.HTTP_PROXY).toBe("http://proxy.example:8080");
    expect(env.NO_PROXY).toContain(".internal");
    expect(env.NODE_USE_ENV_PROXY).toBe("1");
  });

  it("parses Windows Internet Settings registry output into a normalized env", () => {
    const env = parseWindowsInternetSettingsProxyOutput(
      {
        proxyEnable: "    ProxyEnable    REG_DWORD    0x1",
        proxyOverride: "    ProxyOverride    REG_SZ    *.local;10.0.0.1",
        proxyServer: "    ProxyServer    REG_SZ    proxy.example:8080",
      },
      "win32",
    );
    expect(env.HTTP_PROXY).toBe("http://proxy.example:8080");
    expect(env.HTTPS_PROXY).toBe("http://proxy.example:8080");
    expect(env.NO_PROXY).toContain("10.0.0.1");
  });

  it("resolves system proxy env via an injected command runner", () => {
    const env = resolveSystemProxyEnv({
      platform: "darwin",
      runCommand: () => "HTTPEnable : 1\nHTTPProxy : proxy.example\nHTTPPort : 3128\n",
    });
    expect(env.HTTP_PROXY).toBe("http://proxy.example:3128");
  });
});

describe("@injini/platform — toolchain", () => {
  it("assembles an ordered, home-relative bin list honoring explicit prefixes and env overrides", () => {
    const dirs = wellKnownUserToolchainBins({
      env: { NPM_CONFIG_PREFIX: "/custom/npm-prefix" },
      home: "/home/fakeuser",
      includeSystemBins: false,
    });

    expect(dirs[0]).toBe(join("/custom/npm-prefix", "bin"));
    expect(dirs).toContain(join("/home/fakeuser", ".local", "bin"));
    expect(dirs).toContain(join("/home/fakeuser", ".cargo", "bin"));
    expect(dirs).not.toContain("/opt/homebrew/bin");
  });

  it("prepends VP_HOME's bin dir ahead of conventional locations when set", () => {
    const dirs = wellKnownUserToolchainBins({ env: { VP_HOME: "/custom/vp" }, home: "/home/fakeuser" });
    expect(dirs[0]).toBe(join("/custom/vp", "bin"));
  });
});
