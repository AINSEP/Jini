/**
 * @file Zero-setup publishing auth — the real filesystem behind {@link ProvisioningFileIo}.
 *
 * The one place this feature touches a disk. Kept apart from `provisioning.ts` so the port, the
 * codecs and every merge rule stay testable with an in-memory map, and so nothing that runs on the
 * destination at boot drags `node:fs` in behind it.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ProvisioningFileIo } from "./provisioning.js";

/**
 * Reads and writes provisioning config files on the local filesystem.
 *
 * A missing file reads as `null` rather than throwing: "this repo has never provisioned" is an
 * ordinary state, and the empty state has to be a sentence, not a stack trace. Every other read
 * error still throws — an unreadable-but-present config is a real problem and must not be silently
 * reported as "not connected", which would invite provisioning to overwrite it.
 *
 * @complexity O(n) in the file size per call.
 */
export const nodeProvisioningFileIo: ProvisioningFileIo = {
  async read({ path }: { path: string }, _optional = {}): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },

  /**
   * Writes through a temporary file and one `rename`, so a reader never sees a half-written
   * document. This matters most for `revocations.ts`, which the RUNNING server writes while
   * requests are being admitted against it: a torn read there parses as a broken list, and a broken
   * revocation list correctly refuses every publish — so a non-atomic write would turn one
   * disconnect click into a brief outage of publishing.
   *
   * `rename` within a directory is atomic on every filesystem a host deploys onto, which is why the
   * temporary file is placed beside the target rather than in a temp dir on another device.
   */
  async write({ path, contents }: { path: string; contents: string }, _optional = {}): Promise<void> {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true });
    const staging = `${path}.${process.pid}.tmp`;
    await writeFile(staging, contents, "utf8");
    await rename(staging, path);
  },
};
