/**
 * @file Local-filesystem `BlobStorePort` adapter (port/adapter rule-of-two "one
 * being built now" half; the `uploads/` convention).
 *
 * Purpose:
 * Writes/reads blob bytes under a configurable root directory, keyed by
 * `computeBlobStorageKey` (`blob-key.ts`). A host wires this in for its real
 * running server; the in-memory adapter (`blob-store.memory.ts`) is what
 * hermetic tests and a default dev composition use instead.
 *
 * Deliberately NOT built: the S3 adapter (deferred), the presign
 * surface, per-generation storage epochs (see `blob-key.ts` file header).
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { BlobStorePort, PutBlobInput } from "./ports.js";
import { computeBlobStorageKey } from "./blob-key.js";

export interface LocalFsBlobStoreDeps {
  /** Root directory blob storage keys are resolved relative to. */
  rootDir: string;
}

export class LocalFsBlobStore implements BlobStorePort {
  private readonly rootDir: string;

  constructor(deps: LocalFsBlobStoreDeps) {
    this.rootDir = deps.rootDir;
  }

  private resolvePath(storageKey: string): string {
    return join(this.rootDir, storageKey);
  }

  async put(input: PutBlobInput): Promise<{ storageKey: string }> {
    const storageKey = computeBlobStorageKey(input);
    const path = this.resolvePath(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.bytes);
    return { storageKey };
  }

  /**
   * `"wx"` (`O_CREAT | O_EXCL`) makes the create-only guarantee a kernel-enforced atomic op, not
   * this method's own logic: of any two concurrent `open()`s racing for the same path, exactly one
   * succeeds and the other gets `EEXIST` — there is no window between "check" and "write" for a
   * concurrent writer to land in. This also means a writer that has only just started (already
   * created/truncated the file via a plain `"w"` `writeFile`, but not yet finished writing bytes)
   * blocks a same-key `putIfAbsent` just as effectively as a fully-written file would: the path
   * exists from the first internal write syscall, well before that writer's promise resolves.
   *
   * @complexity O(1) syscalls beyond the write itself (one `mkdir`, one `writeFile`).
   */
  async putIfAbsent(input: PutBlobInput): Promise<{ storageKey: string; written: boolean }> {
    const storageKey = computeBlobStorageKey(input);
    const path = this.resolvePath(storageKey);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, input.bytes, { flag: "wx" });
      return { storageKey, written: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return { storageKey, written: false };
      }
      throw err;
    }
  }

  async get(input: { storageKey: string }): Promise<Uint8Array> {
    return readFile(this.resolvePath(input.storageKey));
  }

  /**
   * `ENOENT` (the path genuinely does not exist) resolves to `false`. Any other `stat()` failure
   * (`EACCES` permission denied, `ENOTDIR`, `EIO`, ...) is rethrown raw — same "catch the one
   * known code, rethrow everything else" shape {@link putIfAbsent}'s `EEXIST` handling above
   * already uses — instead of collapsing into `false`: a caller branching on `exists()` must not
   * mistake "this stat failed" for "the object was deleted".
   */
  async exists(input: { storageKey: string }): Promise<boolean> {
    try {
      await stat(this.resolvePath(input.storageKey));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  async remove(input: { storageKey: string }): Promise<void> {
    await rm(this.resolvePath(input.storageKey), { force: true });
  }
}
