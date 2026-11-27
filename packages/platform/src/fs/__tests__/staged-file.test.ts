import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createStagedFileAdapter, type StagedFileDependencies } from "../staged-file.js";

const sha256OfAbc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield Buffer.from(part);
}
async function collect(input: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of input) parts.push(part);
  return Buffer.concat(parts);
}

let base: string;
beforeEach(async () => { base = await fs.mkdtemp(join(tmpdir(), "jini-staged-file-")); });
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });

function fixture() {
  const root = join(base, "owned");
  const path = join(root, "input");
  const filesystem = { open: fs.open, stat: fs.stat, chmod: fs.chmod };
  const sniffContentType = vi.fn(({ bytes }: { bytes: Uint8Array }) =>
    Buffer.from(bytes.subarray(0, 3)).toString() === "abc" ? "video/mp4" : undefined,
  );
  const withTempRoot: StagedFileDependencies["withTempRoot"] = async ({ work }) => {
    await fs.mkdir(root);
    try {
      return await work({ root });
    } finally {
      await fs.rm(root, { recursive: true });
    }
  };
  const adapter = createStagedFileAdapter({ filesystem, sniffContentType, withTempRoot });
  return { adapter, filesystem, sniffContentType, root, path };
}

it("stages exactly the streamed bytes and digest for the lifetime of the consumer", async () => {
  const { adapter, root, path } = fixture();
  const result = await adapter.withStagedFile({
    chunks: chunks("a", "bc"), byteLength: 3, contentType: "application/octet-stream",
    consume: async staged => {
      expect(staged).toMatchObject({ root, path, byteLength: 3, contentType: "application/octet-stream", sha256: sha256OfAbc });
      expect(Object.isFrozen(staged)).toBe(true);
      expect(await fs.readFile(path, "utf8")).toBe("abc");
      expect(await collect(staged.openChunks({}))).toEqual(Buffer.from("abc"));
      return "consumed";
    },
  });
  expect(result).toBe("consumed");
  await expect(fs.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([2, 4])("rejects a stream of length 3 declared as %i without invoking the consumer", async byteLength => {
  const { adapter, path } = fixture();
  const consume = vi.fn(async () => "should not publish");
  await expect(adapter.withStagedFile({ chunks: chunks("a", "bc"), byteLength, contentType: "text/plain", consume }))
    .rejects.toThrow("staged source length mismatch");
  expect(consume).not.toHaveBeenCalled();
  await expect(fs.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not publish a staged file when its source aborts between chunks", async () => {
  const { adapter, path } = fixture();
  const c = new AbortController();
  const reason = new Error("upload cancelled");
  async function* source() {
    yield Buffer.from("a");
    c.abort(reason);
    yield Buffer.from("bc");
  }
  const consume = vi.fn(async () => "should not publish");
  await expect(adapter.withStagedFile({ chunks: source(), byteLength: 3, contentType: "text/plain", consume }, { signal: c.signal }))
    .rejects.toBe(reason);
  expect(consume).not.toHaveBeenCalled();
  await expect(fs.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("seals playback-ready output at the inclusive size cap and sniffs just the first chunk", async () => {
  const { adapter, root, path, sniffContentType } = fixture();
  const bytes = Buffer.concat([Buffer.from("abc"), Buffer.alloc(64 * 1024, 0x65)]);
  await fs.mkdir(root);
  await fs.writeFile(path, bytes);
  const staged = await adapter.sealStagedFile({ root, path, maxBytes: bytes.length });
  expect(staged).toMatchObject({ root, path, byteLength: bytes.length, contentType: "video/mp4" });
  expect(Object.isFrozen(staged)).toBe(true);
  expect(sniffContentType.mock.calls).toEqual([[{ bytes: bytes.subarray(0, 64 * 1024) }]]);
  expect(await collect(staged.openChunks({}))).toEqual(bytes);
  const reason = new Error("playback cancelled");
  await expect(collect(staged.openChunks({}, { signal: AbortSignal.abort(reason) }))).rejects.toBe(reason);
});

it.each([
  { body: "abcd", maxBytes: 3, reason: "too-large", message: "staged output exceeds limit" },
  { body: "gif", maxBytes: 3, reason: "invalid", message: "invalid staged output" },
  { body: "", maxBytes: 3, reason: "invalid", message: "invalid staged output" },
])("rejects output that is $message ($body)", async ({ body, maxBytes, reason, message }) => {
  const { adapter, root, path } = fixture();
  await fs.mkdir(root);
  await fs.writeFile(path, body);
  await expect(adapter.sealStagedFile({ root, path, maxBytes })).rejects.toMatchObject({ reason, message });
});

it.each([
  { replacement: "abcdef", reason: "too-large", message: "staged output grew" },
  { replacement: "abc", reason: "invalid", message: "invalid staged output" },
])("refuses output that changes size between stat and open ($reason)", async ({ replacement, reason, message }) => {
  const { adapter, filesystem, root, path } = fixture();
  await fs.mkdir(root);
  await fs.writeFile(path, "abcd");
  filesystem.open = async (...args) => {
    await fs.writeFile(path, replacement);
    return fs.open(...args);
  };
  await expect(adapter.sealStagedFile({ root, path, maxBytes: 10 })).rejects.toMatchObject({ reason, message });
});

it("does not call the consumer when cancellation arrives after the final input chunk", async () => {
  const { adapter, root } = fixture();
  const controller = new AbortController();
  const reason = new Error("abandoned before publication");
  async function* source() {
    yield Buffer.from("abc");
    controller.abort(reason);
  }
  const consume = vi.fn(async () => "must not publish");
  await expect(adapter.withStagedFile({ chunks: source(), byteLength: 3, contentType: "text/plain", consume },
    { signal: controller.signal })).rejects.toBe(reason);
  expect(consume.mock.calls).toEqual([]);
  await expect(fs.stat(root)).rejects.toMatchObject({ code: "ENOENT" });
});
