/**
 * @file The flags `package-files.ts` opens every packaged file with, computed from the platform's
 * `fs.constants` passed in, so the Windows shape (no `O_NOFOLLOW`) is as checkable as the POSIX one.
 * Internal to the node tier; not re-exported from `./index.ts`.
 */
import type { FileHandle } from "node:fs/promises";

/** The subset of `fs.constants` the read-only, no-follow open needs. */
export interface OpenFlagConstants {
  readonly O_RDONLY: number;
  readonly O_NOFOLLOW?: number | undefined;
}

/**
 * Read-only, and refusing a final-component symlink wherever the platform can express that.
 * @complexity O(1).
 */
export function readNoFollowFlags({ constants }: { constants: OpenFlagConstants }, _optional: Record<string, never> = {}): number {
  // `O_NOFOLLOW` is undefined on Windows; `?? 0` keeps the open valid there.
  return constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
}

/** Reads up to `maxBytes` from the start of the file. */
export async function readAtMost(handle: FileHandle, maxBytes: number): Promise<Buffer> {
  const buffer = Buffer.alloc(maxBytes);
  let offset = 0;
  while (offset < maxBytes) {
    const { bytesRead } = await handle.read(buffer, offset, maxBytes - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}
