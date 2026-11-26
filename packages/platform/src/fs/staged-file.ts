import { createHash } from "node:crypto";
import type * as nodeFs from "node:fs/promises";
import { join } from "node:path";
import type { StagedMediaFile } from "@jini-ai/core/contracts/site/cms-media";

export interface StagedFileDependencies {
  filesystem: Pick<typeof nodeFs, "open" | "stat" | "chmod">;
  withTempRoot: <T>(required: { work: (owned: { root: string }) => Promise<T> }, optional?: Record<string, never>) => Promise<T>;
  sniffContentType: (required: { bytes: Uint8Array }) => string | undefined;
}

async function* openChunks({ filesystem, path }: { filesystem: StagedFileDependencies["filesystem"]; path: string }, { signal }: { signal?: AbortSignal } = {}): AsyncIterable<Uint8Array> {
  signal?.throwIfAborted();
  const file = await filesystem.open(path, "r");
  try {
    while (true) {
      signal?.throwIfAborted();
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) return;
      yield buffer.subarray(0, bytesRead);
    }
  } finally { await file.close(); }
}

async function withStagedFile<T>({ deps, chunks, byteLength, contentType, consume }: {
  deps: StagedFileDependencies; chunks: AsyncIterable<Uint8Array>; byteLength: number; contentType: string;
  consume: (staged: StagedMediaFile) => Promise<T>;
}, { signal }: { signal?: AbortSignal } = {}): Promise<T> {
  return deps.withTempRoot({ work: async ({ root }) => {
    const path = join(root, "input");
    const file = await deps.filesystem.open(path, "wx", 0o600);
    const hash = createHash("sha256");
    let length = 0;
    try {
      for await (const chunk of chunks) {
        signal?.throwIfAborted();
        length += chunk.byteLength;
        if (length > byteLength) throw new Error("staged source length mismatch");
        await file.writeFile(chunk);
        hash.update(chunk);
      }
      if (length !== byteLength) throw new Error("staged source length mismatch");
    } finally { await file.close(); }
    signal?.throwIfAborted();
    return consume(Object.freeze({ path, root, byteLength, contentType, sha256: hash.digest("hex"),
      openChunks: (_required: Record<string, never>, optional: { signal?: AbortSignal } = {}) => openChunks({ filesystem: deps.filesystem, path }, optional),
    }));
  } }, {});
}

async function sealStagedFile({ deps, root, path, maxBytes }: {
  deps: StagedFileDependencies; root: string; path: string; maxBytes: number;
}, { signal }: { signal?: AbortSignal } = {}): Promise<StagedMediaFile> {
  await deps.filesystem.chmod(path, 0o600);
  const { size: byteLength } = await deps.filesystem.stat(path);
  if (byteLength > maxBytes) throw Object.assign(new Error("staged output exceeds limit"), { reason: "too-large" });
  const hash = createHash("sha256");
  let length = 0;
  let contentType: string | undefined;
  for await (const chunk of openChunks({ filesystem: deps.filesystem, path }, signal ? { signal } : {})) {
    if (length === 0) contentType = deps.sniffContentType({ bytes: chunk });
    length += chunk.byteLength;
    if (length > byteLength) throw Object.assign(new Error("staged output grew"), { reason: "too-large" });
    hash.update(chunk);
  }
  if (length !== byteLength || contentType !== "video/mp4") throw Object.assign(new Error("invalid staged output"), { reason: "invalid" });
  return Object.freeze({ path, root, byteLength, contentType, sha256: hash.digest("hex"),
    openChunks: (_required: Record<string, never>, optional: { signal?: AbortSignal } = {}) => openChunks({ filesystem: deps.filesystem, path }, optional),
  });
}

export function createStagedFileAdapter(deps: StagedFileDependencies, _optional: Record<string, never> = {}) {
  return {
    withStagedFile: <T>(required: Omit<Parameters<typeof withStagedFile<T>>[0], "deps">, optional: { signal?: AbortSignal } = {}) => withStagedFile({ deps, ...required }, optional),
    sealStagedFile: (required: Omit<Parameters<typeof sealStagedFile>[0], "deps">, optional: { signal?: AbortSignal } = {}) => sealStagedFile({ deps, ...required }, optional),
  };
}
