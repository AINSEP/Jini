/**
 * @module json-file
 *
 * Small JSON file helpers for sidecar runtime state: a forgiving reader (null on
 * any failure), an atomic pretty-printed writer via temp-file rename, a
 * best-effort remove, and a guarded pointer removal that only deletes when the
 * pointer still names the given run. Depends on `node:fs/promises` and
 * the platform filesystem writer for shared atomic replacement and durability.
 */

import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { writeJsonFileAtomicAsync } from "@jini-ai/platform/fs";

/**
 * Read and parse a JSON file, swallowing any read/parse error.
 * @returns The parsed value, or `null` if missing or unreadable.
 */
export async function readJsonFile<T = any>({ filePath }: { filePath: string }): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Atomically write `payload` as pretty-printed JSON via a temp-file rename,
 * creating the parent directory if needed. Existing modes are preserved; file bytes
 * are synced before rename and the parent directory afterward. Sync failures propagate.
 */
export async function writeJsonFile({ filePath, payload }: { filePath: string; payload: unknown }): Promise<void> {
  await writeJsonFileAtomicAsync({ filePath, data: payload }, {
    createParent: true, trailingNewline: true, defaultMode: 0o666 & ~process.umask(),
    tempPath: () => `${filePath}.${process.pid}.${randomUUID()}.tmp`,
  });
}

/**
 * Remove a file, forcing (no error if absent).
 */
export async function removeFile({ filePath }: { filePath: string }): Promise<void> {
  await rm(filePath, { force: true });
}

/**
 * Remove a pointer file only if it still points at `runId`.
 */
export async function removePointerIfCurrent({ pointerPath, runId }: { pointerPath: string; runId: string }): Promise<void> {
  const pointer = await readJsonFile<{ runId?: string }>({ filePath: pointerPath });
  if (pointer?.runId === runId) await removeFile({ filePath: pointerPath });
}
