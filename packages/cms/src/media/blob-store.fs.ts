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

  async get(input: { storageKey: string }): Promise<Uint8Array> {
    return readFile(this.resolvePath(input.storageKey));
  }

  async exists(input: { storageKey: string }): Promise<boolean> {
    try {
      await stat(this.resolvePath(input.storageKey));
      return true;
    } catch {
      return false;
    }
  }

  async remove(input: { storageKey: string }): Promise<void> {
    await rm(this.resolvePath(input.storageKey), { force: true });
  }
}
