import { describe, expect, it, vi } from "vitest";
import {
  checkAvailability,
  ensureHelperCompiled,
  transcribeWav,
  type MacTranscriberDeps,
} from "../mac-on-device-transcriber.js";

function deferred() {
  let resolve!: (value: { stdout: string }) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<{ stdout: string }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const compiler = deferred();
  const files = new Set<string>();
  const execFileAsync = vi.fn(({ file, args }: { file: string; args: string[] }) => {
    if (file === "/toolchain/swiftc") return compiler.promise;
    return Promise.resolve({ stdout: args[0] === "check"
      ? '{"available":true,"reason":null}'
      : '{"ok":true,"text":"hello","elapsedMs":3}' });
  });
  const deps: MacTranscriberDeps = {
    fs: {
      existsSync: ({ path }) => files.has(path),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(({ path }) => { files.add(path); }),
      rmSync: vi.fn(({ path }) => { files.delete(path); }),
    },
    // Legacy hosts may still supply this adapter; compilation must never reach it.
    spawnSync: () => { throw new Error("blocking compiler called"); },
    execFileAsync,
    sourcePath: "/source.swift",
    binaryPath: "/cache/helper",
    compilerPath: "/toolchain/swiftc",
    locale: "en-US",
    tempFilePath: () => "/scratch.wav",
    messages: {
      compilerMissing: "compiler missing",
      compilerFailed: ({ stderr }) => `compiler failed: ${stderr}`,
      invalidOutput: ({ stdout }) => `invalid output: ${stdout}`,
      cannotTranscribe: ({ reason }) => `cannot transcribe: ${reason}`,
      recognitionFailed: ({ reason }) => `recognition failed: ${reason}`,
    },
  };
  return { deps, compiler, files, execFileAsync };
}

describe("asynchronous native helper compilation", () => {
  it("leaves the event loop responsive while the compiler is pending", async () => {
    const { deps, compiler, execFileAsync } = fixture();
    let finished = false;
    const compiling = ensureHelperCompiled(deps).then((result) => { finished = true; return result; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(finished).toBe(false);
    expect(execFileAsync.mock.calls).toEqual([[{
      file: "/toolchain/swiftc", args: ["-O", "/source.swift", "-o", "/cache/helper"],
    }]]);
    compiler.resolve({ stdout: "" });
    expect(await compiling).toEqual({ ok: true });
  });

  it("shares first-use compilation and waits even if swiftc has already created its output", async () => {
    const { deps, compiler, files, execFileAsync } = fixture();
    const available = checkAvailability(deps);
    files.add(deps.binaryPath); // Output exists before swiftc has finished linking it.
    const transcribing = transcribeWav({ ...deps, wavBuffer: Buffer.from("wav") });
    await Promise.resolve();
    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled();
    compiler.resolve({ stdout: "" });
    expect(await available).toEqual({ available: true, reason: undefined });
    expect(await transcribing).toEqual({ text: "hello", elapsedMs: 3 });
    expect(execFileAsync.mock.calls.map(([args]) => args)).toEqual([
      { file: "/toolchain/swiftc", args: ["-O", "/source.swift", "-o", "/cache/helper"] },
      { file: "/cache/helper", args: ["check", "en-US"] },
      { file: "/cache/helper", args: ["transcribe", "/scratch.wav", "en-US"] },
    ]);
    expect(deps.fs.rmSync).toHaveBeenCalledWith({ path: "/scratch.wav" }, { force: true });
  });

  it("shares a missing-compiler result, never invokes the helper, and allows a later retry", async () => {
    const { deps, compiler, execFileAsync } = fixture();
    const available = checkAvailability(deps);
    const transcribing = transcribeWav({ ...deps, wavBuffer: Buffer.from("wav") });
    const failedTranscription = expect(transcribing).rejects.toThrow("cannot transcribe: compiler missing");
    compiler.reject(Object.assign(new Error("not found"), { code: "ENOENT" }));
    expect(await available).toEqual({ available: false, reason: "compiler missing" });
    await failedTranscription;
    expect(execFileAsync).toHaveBeenCalledTimes(1);
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled();
    execFileAsync.mockImplementationOnce(async () => ({ stdout: "" }));
    expect(await ensureHelperCompiled(deps)).toEqual({ ok: true });
    expect(execFileAsync).toHaveBeenCalledTimes(2);
  });

  it("preserves trimmed compiler stderr on asynchronous rejection", async () => {
    const { deps, compiler } = fixture();
    const compiling = ensureHelperCompiled(deps);
    compiler.reject(Object.assign(new Error("exit 1"), { stderr: Buffer.from("  syntax error\n") }));
    expect(await compiling).toEqual({ ok: false, error: "compiler failed: syntax error" });
  });

  it("skips the compiler when a completed binary is cached", async () => {
    const { deps, files, execFileAsync } = fixture();
    files.add(deps.binaryPath);
    expect(await ensureHelperCompiled(deps)).toEqual({ ok: true });
    expect(execFileAsync).not.toHaveBeenCalled();
  });
});
