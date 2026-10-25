import nodeFs, { type Stats } from "node:fs";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createGuardedFileReader, type DescriptorReadPolicy, type GuardedReaderFilesystem, FsFilePathError } from "../guarded-reader.js";

const limits = { maxFileBytes: 32, binarySniffBytes: 16, maxListedFiles: 10, maxWalkDepth: 4, maxWalkEntries: 20 };
function fixture(options: { data?: Buffer; size?: number; mode?: number; regular?: boolean; failure?: Error; shortReads?: boolean } = {}) {
  const data = options.data ?? Buffer.from("abc");
  const stat = { size: options.size ?? data.length, mode: options.mode ?? 0o100600, isFile: () => options.regular ?? true } as Stats;
  let position = 0;
  const close = vi.fn();
  const read = vi.fn((fd: number, buffer: Buffer, offset: number, length: number) => {
    expect(fd).toBe(71);
    if (options.failure) throw options.failure;
    const count = Math.min(length, data.length - position, options.shortReads ? 1 : Infinity);
    data.copy(buffer, offset, position, position + count);
    position += count;
    return count;
  });
  const stream = vi.fn((_path: unknown, streamOptions: { fd?: number; autoClose?: boolean }) => {
    expect(streamOptions.fd).toBe(71);
    expect(streamOptions.autoClose).toBe(true);
    let sent = false;
    return new Readable({
      read() {
        if (options.failure) { this.destroy(options.failure); return; }
        if (!sent) { sent = true; this.push(data); }
        else this.push(null);
      },
      destroy(error, callback) { close(71); callback(error); },
    });
  });
  const fs: GuardedReaderFilesystem = {
    ...nodeFs,
    existsSync: () => true,
    realpathSync: ((path: unknown) => String(path)) as typeof nodeFs.realpathSync,
    statSync: (() => ({ ...stat, isFile: () => true, size: 1 })) as unknown as typeof nodeFs.statSync,
    fstatSync: vi.fn(() => stat) as unknown as typeof nodeFs.fstatSync,
    openSync: vi.fn(() => 71),
    readSync: read as unknown as typeof nodeFs.readSync,
    closeSync: close,
    createReadStream: stream as unknown as typeof nodeFs.createReadStream,
  };
  const make = (policy: DescriptorReadPolicy | undefined = { exactMode: 0o600 }) => createGuardedFileReader({
    rootPath: "/virtual", filesystem: fs, limits, denyRules: { segments: new Set(["private"]), filenamePatterns: [/^secret$/] },
  }, policy === undefined ? {} : { descriptorRead: policy });
  return { fs, make, close, read, stream };
}

async function invoke(reader: ReturnType<typeof createGuardedFileReader>, method: "read" | "readBytes") {
  return method === "read" ? reader.read({ relativePath: "file" }) : reader.readBytes({ relativePath: "file", maxBytes: 32 });
}

describe.each(["read", "readBytes"] as const)("descriptor %s", method => {
  it("accepts exact 0600 and reads the validated descriptor, closing exactly once", async () => {
    const f = fixture({ shortReads: true });
    const result = await invoke(f.make(), method);
    expect(method === "read" ? result : Buffer.from(result as Uint8Array).toString()).toEqual(method === "read" ? { content: "abc", bytes: 3 } : "abc");
    expect(f.fs.openSync).toHaveBeenCalledWith("/virtual/file", nodeFs.constants.O_RDONLY | nodeFs.constants.O_NOFOLLOW | nodeFs.constants.O_NONBLOCK);
    expect(f.fs.fstatSync).toHaveBeenCalledWith(71);
    expect(f.close.mock.calls).toEqual([[71]]);
  });

  it.each([0o100400, 0o100640, 0o104600])("refuses descriptor mode %s even when pathname checks passed", async mode => {
    const f = fixture({ mode });
    await expect(Promise.resolve().then(() => invoke(f.make(), method))).rejects.toThrow(/exact mode 600/);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.close.mock.calls).toEqual([[71]]);
  });

  it("refuses non-regular descriptors before reading", async () => {
    const f = fixture({ regular: false });
    await expect(Promise.resolve().then(() => invoke(f.make({}), method))).rejects.toBeInstanceOf(FsFilePathError);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.close.mock.calls).toEqual([[71]]);
  });

  it("checks descriptor size rather than trusting pathname size", async () => {
    const f = fixture({ size: 33 });
    await expect(Promise.resolve().then(() => invoke(f.make({}), method))).rejects.toThrow(/descriptor limit/);
    expect(f.close.mock.calls).toEqual([[71]]);
  });

  it("refuses a symlink swapped in at open and does not close an unowned descriptor", async () => {
    const f = fixture();
    const failure = Object.assign(new Error("ELOOP: too many symbolic links, open '/virtual/file'"), { code: "ELOOP" });
    vi.mocked(f.fs.openSync).mockImplementation((_path, flags) => {
      expect(Number(flags) & nodeFs.constants.O_NOFOLLOW).toBe(nodeFs.constants.O_NOFOLLOW);
      throw failure;
    });
    // The refusal names only the relative path; the host's absolute path stays out of it.
    const refusal = await Promise.resolve().then(() => invoke(f.make(), method)).catch(error => error);
    expect(refusal).toBeInstanceOf(FsFilePathError);
    expect(refusal.message).toBe("path 'file' is a symbolic link or could not be opened");
    expect(f.close).not.toHaveBeenCalled();
  });

  it("allows growth by default but rejects it below the cap when requested", async () => {
    const baseline = fixture({ size: 1 });
    const result = await invoke(baseline.make({}), method);
    expect(method === "read" ? result : Buffer.from(result as Uint8Array).toString()).toEqual(method === "read" ? { content: "abc", bytes: 3 } : "abc");
    const guarded = fixture({ size: 1 });
    await expect(Promise.resolve().then(() => invoke(guarded.make({ rejectGrowth: true }), method))).rejects.toThrow(/1-byte/);
    expect(guarded.close.mock.calls).toEqual([[71]]);
  });

  it("independently counts actual bytes even when growth rejection is off", async () => {
    const f = fixture({ size: 1, data: Buffer.alloc(33, 0x61) });
    await expect(Promise.resolve().then(() => invoke(f.make({}), method))).rejects.toThrow(/32-byte/);
    expect(f.close.mock.calls).toEqual([[71]]);
  });

  it("returns short files without padding to their initial size", async () => {
    const f = fixture({ size: 10, shortReads: true });
    const result = await invoke(f.make({ rejectGrowth: true }), method);
    expect(method === "read" ? result : Buffer.from(result as Uint8Array).toString()).toEqual(method === "read" ? { content: "abc", bytes: 3 } : "abc");
    expect(f.close.mock.calls).toEqual([[71]]);
  });

  it("closes on read failure", async () => {
    const f = fixture({ failure: new Error("read failed") });
    await expect(Promise.resolve().then(() => invoke(f.make(), method))).rejects.toThrow(/read failed/);
    expect(f.close.mock.calls).toEqual([[71]]);
  });

  it("retains deny rules before descriptor open", async () => {
    const f = fixture();
    const reader = f.make();
    await expect(Promise.resolve().then(async () => method === "read" ? reader.read({ relativePath: "secret" }) : reader.readBytes({ relativePath: "secret", maxBytes: 32 }))).rejects.toThrow(/denied filename/);
    expect(f.fs.openSync).not.toHaveBeenCalled();
  });
});

it("requires optional descriptor capabilities only for opt-in readers", () => {
  const f = fixture();
  delete f.fs.fstatSync;
  expect(() => f.make({})).toThrow(/fstatSync/);
  expect(() => createGuardedFileReader({ rootPath: "/virtual", filesystem: f.fs, limits, denyRules: { segments: new Set(), filenamePatterns: [] } })).not.toThrow();
});

it("fails closed without supported no-follow or nonblocking flags", () => {
  for (const flag of ["O_NOFOLLOW", "O_NONBLOCK"] as const) {
    const f = fixture();
    f.fs.constants = { ...nodeFs.constants, [flag]: 0 };
    expect(() => f.make({})).toThrow(/supported/);
    expect(f.fs.openSync).not.toHaveBeenCalled();
  }
  const f = fixture();
  delete f.fs.constants;
  expect(() => f.make({})).toThrow(/constants/);
});

it.each([-1, 0o10000, 0.5, NaN])("refuses invalid exact permission bits %s", exactMode => {
  expect(() => fixture().make({ exactMode })).toThrow(TypeError);
});

it("closes when descriptor stat or stream construction fails", async () => {
  const statFailure = fixture();
  vi.mocked(statFailure.fs.fstatSync!).mockImplementation(() => { throw new Error("fstat failed"); });
  expect(() => statFailure.make().read({ relativePath: "file" })).toThrow("fstat failed");
  expect(statFailure.close.mock.calls).toEqual([[71]]);
  const streamFailure = fixture();
  streamFailure.stream.mockImplementation(() => { throw new Error("stream failed"); });
  await expect(streamFailure.make().readBytes({ relativePath: "file", maxBytes: 32 })).rejects.toThrow("stream failed");
  expect(streamFailure.close.mock.calls).toEqual([[71]]);
});
