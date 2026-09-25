/**
 * @file In-memory `BlobStorePort` test double (port/adapter rule-of-two, second
 * adapter alongside `blob-store.fs.ts`). Used by hermetic tests and any
 * host's default dev/test composition root.
 */
import type { BlobStorePort, PutBlobInput } from "./ports.js";
import { computeBlobStorageKey } from "./blob-key.js";

export class InMemoryBlobStore implements BlobStorePort {
  private readonly bytesByKey = new Map<string, Uint8Array>();

  async put(input: PutBlobInput): Promise<{ storageKey: string }> {
    const storageKey = computeBlobStorageKey(input);
    this.bytesByKey.set(storageKey, input.bytes);
    return { storageKey };
  }

  /**
   * Trivially atomic here — single-threaded `Map`, no `await` between the check and the set — but
   * still a real create-only op from a caller's point of view, matching the other adapters'
   * contract (`ports.ts`'s `BlobStorePort.putIfAbsent` doc).
   */
  async putIfAbsent(input: PutBlobInput): Promise<{ storageKey: string; written: boolean }> {
    const storageKey = computeBlobStorageKey(input);
    if (this.bytesByKey.has(storageKey)) {
      return { storageKey, written: false };
    }
    this.bytesByKey.set(storageKey, input.bytes);
    return { storageKey, written: true };
  }

  async get(input: { storageKey: string }): Promise<Uint8Array> {
    const bytes = this.bytesByKey.get(input.storageKey);
    if (!bytes) {
      throw new Error(`blob '${input.storageKey}' was not found`);
    }
    return bytes;
  }

  async exists(input: { storageKey: string }): Promise<boolean> {
    return this.bytesByKey.has(input.storageKey);
  }

  async remove(input: { storageKey: string }): Promise<void> {
    this.bytesByKey.delete(input.storageKey);
  }
}
