import { ensureHelperCompiled as compile, checkAvailability as available, transcribeWav as transcribe, parseHelperJson as parse, createMacOnDeviceTranscriptionPort as create } from "../mac-on-device-transcriber.js";
const messages = {
  compilerMissing: "swiftc-not-found: no Swift toolchain on this machine",
  compilerFailed: ({ stderr }: { stderr: string }) => `swiftc-failed: ${stderr}`,
  invalidOutput: ({ stdout }: { stdout: string }) => `helper printed non-JSON output: ${stdout}`,
  cannotTranscribe: ({ reason }: { reason: string }) => `cannot transcribe (${reason})`,
  recognitionFailed: ({ reason }: { reason: string }) => `recognition failed (${reason})`,
};
type NativeFs = {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): unknown;
  writeFileSync(path: string, data: Buffer): void;
  rmSync(path: string, options?: { force?: boolean }): void;
};
type MacTranscriberDeps = Omit<import("../mac-on-device-transcriber.js").MacTranscriberDeps, "messages" | "compilerPath" | "locale" | "fs" | "spawnSync" | "execFileAsync"> & {
  fs: NativeFs;
  compileProcess(command: string, args: string[]): import("../mac-on-device-transcriber.js").SpawnResult;
  execFileAsync(file: string, args: string[]): Promise<{ stdout: string }>;
  compilerPath?: string;
};
function bindCompile(args: Pick<MacTranscriberDeps, "fs" | "compileProcess">) {
  return {
    fs: {
      existsSync: ({ path }: { path: string }) => args.fs.existsSync(path),
      mkdirSync: ({ path }: { path: string }, options?: { recursive?: boolean }) => args.fs.mkdirSync(path, options),
      writeFileSync: ({ path, data }: { path: string; data: Buffer }) => args.fs.writeFileSync(path, data),
      rmSync: ({ path }: { path: string }, options?: { force?: boolean }) => args.fs.rmSync(path, options),
    },
    // Immediate fake process outcomes still enter the production asynchronous process port.
    execFileAsync: async ({ file, args: argv }: { file: string; args: string[] }) => {
      const result = args.compileProcess(file, argv);
      if (result.error) throw result.error;
      if (result.status !== 0) throw Object.assign(new Error("compiler failed"), { stderr: result.stderr });
      return { stdout: "" };
    },
  };
}
function bindNative(args: MacTranscriberDeps) {
  const compileDeps = bindCompile(args);
  return { ...compileDeps, execFileAsync: ({ file, args: argv }: { file: string; args: string[] }) =>
    file === (args.compilerPath ?? "swiftc")
      ? compileDeps.execFileAsync({ file, args: argv })
      : args.execFileAsync(file, argv) };
}
type Compile = Pick<MacTranscriberDeps, "fs" | "compileProcess" | "sourcePath" | "binaryPath">;
type Availability = Omit<MacTranscriberDeps, "tempFilePath">;
const ensureHelperCompiled = (args: Compile) => compile({ ...args, ...bindCompile(args), compilerPath: "swiftc", messages });
const checkAvailability = (args: Availability) => available({ ...args, ...bindNative({ ...args, tempFilePath: () => "unused" }), compilerPath: "swiftc", locale: "en-US", messages });
const transcribeWav = (wavBuffer: Buffer, args: MacTranscriberDeps) => transcribe({ ...args, ...bindNative(args), wavBuffer, compilerPath: "swiftc", locale: "en-US", messages });
const parseHelperJson = (stdout: string) => parse({ stdout, invalidOutput: messages.invalidOutput });
const createMacOnDeviceTranscriptionPort = (args: Omit<MacTranscriberDeps, "sourcePath"> & { sourcePath?: string }) => create({ ...args, ...bindNative({ ...args, sourcePath: args.sourcePath ?? "/source.swift" }), sourcePath: args.sourcePath ?? "/source.swift", compilerPath: "swiftc", locale: "en-US", messages });
/**
 * @file Direct tests for `mac-on-device-transcriber.ts` with injected dependencies, plus a
 * native contract checks live in speech-helper.native.test.ts.
 */
import { test } from "vitest";
import assert from "node:assert/strict";


/** A minimal fake `fs` recording every call it receives, backed by an in-memory existence set. */
function fakeFs({ existing = [] }: { existing?: string[] } = { existing: [] }) {
  const exists = new Set(existing);
  const calls: { mkdirSync: [string, unknown][]; writeFileSync: [string, unknown][]; rmSync: [string, unknown][] } = { mkdirSync: [], writeFileSync: [], rmSync: [] };
  return {
    calls,
    exists,
    existsSync: (p: string) => exists.has(p),
    mkdirSync: (p: string, opts: unknown) => calls.mkdirSync.push([p, opts]),
    writeFileSync: (p: string, data: unknown) => {
      calls.writeFileSync.push([p, data]);
      exists.add(p);
    },
    rmSync: (p: string, opts: unknown) => {
      calls.rmSync.push([p, opts]);
      exists.delete(p);
    },
  };
}

test("ensureHelperCompiled is a no-op when the binary already exists", async () => {
  const fs = fakeFs({ existing: ["/bin/helper"] });
  const compileProcess = () => assert.fail("must not compile when already built");
  const result = await ensureHelperCompiled({ fs, compileProcess, sourcePath: "/src.swift", binaryPath: "/bin/helper" });
  assert.deepEqual(result, { ok: true });
});

test("ensureHelperCompiled reports a clear reason when swiftc is not installed", async () => {
  const fs = fakeFs();
  const compileProcess = () => ({ status: null, stderr: "", error: Object.assign(new Error("not found"), { code: "ENOENT" }) });
  const result = await ensureHelperCompiled({ fs, compileProcess, sourcePath: "/src.swift", binaryPath: "/bin/helper" });
  assert.equal(result.ok, false);
  assert.match(result.error, /swiftc-not-found/);
});

test("ensureHelperCompiled reports the compiler's own stderr on a failed build", async () => {
  const fs = fakeFs();
  const compileProcess = () => ({ status: 1, stderr: Buffer.from("error: syntax error") });
  const result = await ensureHelperCompiled({ fs, compileProcess, sourcePath: "/src.swift", binaryPath: "/bin/helper" });
  assert.equal(result.ok, false);
  assert.match(result.error, /syntax error/);
});

test("ensureHelperCompiled compiles once and creates the parent directory first", async () => {
  const fs = fakeFs();
  const operations: unknown[] = [];
  const mkdirSync = fs.mkdirSync;
  fs.mkdirSync = (p, opts) => {
    operations.push(["mkdir", p, opts]);
    return mkdirSync(p, opts);
  };
  const compileProcess = (cmd: string, args: string[]) => {
    operations.push([cmd, args]);
    fs.exists.add("/speech/.build/helper");
    return { status: 0, stderr: "" };
  };
  const deps = { fs, compileProcess, sourcePath: "/speech/src.swift", binaryPath: "/speech/.build/helper" };
  const result = await ensureHelperCompiled(deps);
  assert.deepEqual(result, { ok: true });
  assert.equal(fs.calls.mkdirSync[0]![0], "/speech/.build");
  assert.deepEqual(await ensureHelperCompiled(deps), { ok: true });
  assert.deepEqual(operations, [
    ["mkdir", "/speech/.build", { recursive: true }],
    ["swiftc", ["-O", "/speech/src.swift", "-o", "/speech/.build/helper"]],
  ]);
});

test("parseHelperJson throws a message that includes the raw stdout on malformed output", () => {
  assert.throws(() => parseHelperJson("not json"), /not json/);
});

test("checkAvailability reports unavailable without spawning the helper when compilation fails", async () => {
  const fs = fakeFs();
  const compileProcess = () => ({ status: null, error: { code: "ENOENT" } as NodeJS.ErrnoException });
  const execFileAsync = () => assert.fail("must not run the helper when compilation failed");
  const result = await checkAvailability({ fs, compileProcess, execFileAsync, sourcePath: "/s.swift", binaryPath: "/b" });
  assert.equal(result.available, false);
  assert.match(result.reason!, /swiftc-not-found/);
});

test("checkAvailability relays the helper's own available:true payload", async () => {
  const fs = fakeFs({ existing: ["/b"] });
  const execFileAsync = async () => ({ stdout: '{"available":true,"reason":null}' });
  const result = await checkAvailability({ fs, compileProcess: (): any => {}, execFileAsync, sourcePath: "/s.swift", binaryPath: "/b" }); // any: an unreached compileProcess stub (the binary exists, so swiftc never runs) that returns nothing
  assert.deepEqual(result, { available: true, reason: undefined });
});

test("checkAvailability relays the helper's own available:false reason (e.g. on-device assets missing)", async () => {
  const fs = fakeFs({ existing: ["/b"] });
  const execFileAsync = async () => ({ stdout: '{"available":false,"reason":"on-device-recognition-unavailable"}' });
  const result = await checkAvailability({ fs, compileProcess: (): any => {}, execFileAsync, sourcePath: "/s.swift", binaryPath: "/b" }); // any: an unreached compileProcess stub (the binary exists, so swiftc never runs) that returns nothing
  assert.deepEqual(result, { available: false, reason: "on-device-recognition-unavailable" });
});

test("transcribeWav writes the buffer to the temp path, calls the helper, and returns its text", async () => {
  const fs = fakeFs({ existing: ["/b"] });
  const wav = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0xff, 0x80]);
  const calledArgs: [string, string[]][] = [];
  const execFileAsync = async (binaryPath: string, args: string[]) => {
    calledArgs.push([binaryPath, args]);
    assert.deepEqual(fs.calls.writeFileSync, [[args[1], wav]]);
    assert.equal(fs.exists.has(args[1]!), true);
    return { stdout: '{"ok":true,"text":"publish the homepage","elapsedMs":1234}' };
  };
  const deps = { fs, compileProcess: (): any => {}, execFileAsync, sourcePath: "/s.swift", binaryPath: "/b", tempFilePath: () => "/tmp/rec.wav" }; // any: an unreached compileProcess stub (the binary exists, so swiftc never runs) that returns nothing

  const result = await transcribeWav(wav, deps);

  assert.deepEqual(result, { text: "publish the homepage", elapsedMs: 1234 });
  assert.deepEqual(calledArgs[0], ["/b", ["transcribe", "/tmp/rec.wav", "en-US"]]);
  assert.equal(fs.calls.writeFileSync[0]![0], "/tmp/rec.wav");
  assert.deepEqual(fs.calls.writeFileSync[0]![1], wav);
});

test("transcribeWav always removes the temp file, even when the helper reports a failure", async () => {
  const fs = fakeFs({ existing: ["/b"] });
  const execFileAsync = async () => ({ stdout: '{"ok":false,"error":"on-device-recognition-unavailable"}' });
  const deps = { fs, compileProcess: (): any => {}, execFileAsync, sourcePath: "/s.swift", binaryPath: "/b", tempFilePath: () => "/tmp/rec.wav" }; // any: an unreached compileProcess stub (the binary exists, so swiftc never runs) that returns nothing

  await assert.rejects(() => transcribeWav(Buffer.from("x"), deps), /on-device-recognition-unavailable/);
  assert.equal(fs.exists.has("/tmp/rec.wav"), false);
  assert.deepEqual(fs.calls.rmSync[0], ["/tmp/rec.wav", { force: true }]);
});

test("transcribeWav preserves structured failure stdout from a nonzero helper exit and removes the temp file", async () => {
  const fs = fakeFs({ existing: ["/b"] });
  const execFileAsync = async () => {
    throw Object.assign(new Error("Command failed: /b transcribe /tmp/rec.wav"), {
      code: 1,
      stdout: '{"ok":false,"error":"on-device-recognition-unavailable"}',
    });
  };
  const deps = { fs, compileProcess: () => assert.fail("already compiled"), execFileAsync, sourcePath: "/s.swift", binaryPath: "/b", tempFilePath: () => "/tmp/rec.wav" };

  await assert.rejects(() => transcribeWav(Buffer.from("x"), deps), /recognition failed \(on-device-recognition-unavailable\)/);
  assert.equal(fs.exists.has("/tmp/rec.wav"), false);
  assert.deepEqual(fs.calls.rmSync, [["/tmp/rec.wav", { force: true }]]);
});

test("transcribeWav always removes the temp file even when the child process itself rejects with no JSON", async () => {
  const fs = fakeFs({ existing: ["/b"] });
  const execFileAsync = async () => {
    throw new Error("spawn EACCES");
  };
  const deps = { fs, compileProcess: (): any => {}, execFileAsync, sourcePath: "/s.swift", binaryPath: "/b", tempFilePath: () => "/tmp/rec.wav" }; // any: an unreached compileProcess stub (the binary exists, so swiftc never runs) that returns nothing

  await assert.rejects(() => transcribeWav(Buffer.from("x"), deps), /EACCES/);
  assert.equal(fs.exists.has("/tmp/rec.wav"), false);
});

test("transcribeWav rejects without writing a temp file when compilation itself fails", async () => {
  const fs = fakeFs();
  const compileProcess = () => ({ status: null, error: { code: "ENOENT" } as NodeJS.ErrnoException });
  const deps = { fs, compileProcess, execFileAsync: () => assert.fail("must not run"), sourcePath: "/s.swift", binaryPath: "/b", tempFilePath: () => "/tmp/rec.wav" };

  await assert.rejects(() => transcribeWav(Buffer.from("x"), deps), /swiftc-not-found/);
  assert.equal(fs.calls.writeFileSync.length, 0);
});

test("createMacOnDeviceTranscriptionPort composes overrides into a working port end to end", async () => {
  const fs = fakeFs({ existing: ["/b"] });
  const execFileAsync = async (_bin: string, args: string[]) =>
    args[0] === "check"
      ? { stdout: '{"available":true,"reason":null}' }
      : { stdout: '{"ok":true,"text":"hello","elapsedMs":50}' };
  const port = createMacOnDeviceTranscriptionPort({ fs, compileProcess: (): any => {}, execFileAsync, binaryPath: "/b", tempFilePath: () => "/t.wav" }); // any: an unreached compileProcess stub (the binary exists, so swiftc never runs) that returns nothing

  assert.deepEqual(await port.isAvailable(), { available: true, reason: undefined });
  assert.deepEqual(await port.transcribe({ wavBuffer: Buffer.from("x") }), { text: "hello", elapsedMs: 50 });
});


test("a partial write is removed even when the filesystem throws", async () => {
  const fs = fakeFs({ existing: ["/b"] });
  fs.writeFileSync = (file) => { fs.exists.add(file); throw new Error("disk full"); };
  await assert.rejects(() => transcribeWav(Buffer.from("x"), { fs, compileProcess: () => assert.fail(), execFileAsync: () => assert.fail(), sourcePath: "/s.swift", binaryPath: "/b", tempFilePath: () => "/tmp/partial.wav" }), /disk full/);
  assert.equal(fs.exists.has("/tmp/partial.wav"), false);
  assert.deepEqual(fs.calls.rmSync, [["/tmp/partial.wav", { force: true }]]);
});
test("the adapter refuses a string availability flag instead of treating it as truthy", async () => {
  await assert.rejects(() => checkAvailability({ fs: fakeFs({ existing: ["/b"] }), compileProcess: () => assert.fail(), execFileAsync: async () => ({ stdout: '{"available":"false"}' }), sourcePath: "/s.swift", binaryPath: "/b" }), /non-JSON|helper printed/);
});
test("caller-provided compiler and locale reach both subprocess commands", async () => {
  const operations: unknown[][] = [];
  const deps = { fs: fakeFs(), compileProcess: (cmd: string, args: string[]) => { operations.push([cmd, args]); return { status: 0 }; }, execFileAsync: async (cmd: string, args: string[]) => { operations.push([cmd, args]); return { stdout: '{"available":false,"reason":"not authorized"}' }; }, sourcePath: "/custom.swift", binaryPath: "/custom/helper", compilerPath: "/custom/swiftc", locale: "fr-FR", messages };
  assert.deepEqual(await available({ ...deps, ...bindNative({ ...deps, tempFilePath: () => "unused" }) }), { available: false, reason: "not authorized" });
  assert.deepEqual(operations, [["/custom/swiftc", ["-O", "/custom.swift", "-o", "/custom/helper"]], ["/custom/helper", ["check", "fr-FR"]]]);
});
