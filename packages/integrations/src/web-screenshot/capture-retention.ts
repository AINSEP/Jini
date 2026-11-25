import path from "node:path";

import type { CleanupPreviewStore } from "@jini-ai/core/contracts/storage";

import { CAPTURE_PARTIAL_SUFFIX, type CaptureRootLock } from "./capture-files.js";

/**
 * @file Manual "delete screenshots older than…" for one captures folder (`capture-files.ts`).
 *
 * Why preview + confirm and not a cache sweep: a capture is an owner artifact, not a cache. A report
 * may cite it by path, and nothing can regenerate the exact picture of a page as it looked then, so
 * no age makes a capture safe to drop on its own. Deletion happens only when the owner asked, saw the
 * list, and confirmed it, and then only for the files that are still exactly what was shown.
 *
 * Only writer-owned files are ever offered: regular files (by `lstat`, never through a symlink) named
 * `<YYYY-MM-DD>/<name>.jpg` the way `captureRelativePaths` names them, never a `.partial` still being
 * written. Paths come only from the lister, never from the caller. The host supplies the authorized
 * principal, the root, the ports and the root-keyed lock the writer also holds.
 */

/** One entry under the captures root as `lstat` saw it; `identity` changes when the file is replaced or rewritten. */
export interface CaptureEntry {
  relPath: string;
  kind: "file" | "directory" | "symlink" | "other";
  identity: string;
  mtimeMs: number;
  size: number;
}

export type ListOwnedCaptures = (required: { root: string }, optional?: Record<string, never>) => Promise<readonly CaptureEntry[]>;
/** Removes `relPath` only if it is still a regular file with `identity`; resolves whether it removed it. */
export type RemoveOwnedCapture = (required: { root: string; relPath: string; identity: string }, optional?: Record<string, never>) => Promise<boolean>;

export interface CaptureRetentionPreview { previewToken: string; deadline: number; count: number; bytes: number; items: string[] }
export interface CaptureRetentionResult { deleted: string[]; kept: { relPath: string; reason: "missing" | "changed" | "not-eligible" }[] }

const PREVIEW_KIND = "capture-retention";
const SHOWN_ITEMS = 50;
const OWNED_NAME = /^\d{4}-\d{2}-\d{2}\/[^/\\]+\.jpg$/;

/** Whether an entry is a finished, writer-named regular file inside the root and older than `before`. */
function isEligible({ entry, before }: { entry: CaptureEntry; before: number }): boolean {
  if (entry.kind !== "file" || entry.relPath.endsWith(CAPTURE_PARTIAL_SUFFIX)) return false;
  if (!OWNED_NAME.test(entry.relPath) || entry.relPath.split("/").includes("..")) return false;
  return entry.mtimeMs < before;
}

/**
 * Preview/apply engine for manual capture cleanup.
 * `preview` lists at most `limit` eligible captures (oldest first) under the lock and stores their
 * identities behind a single-use token bound to principal and scope. `apply` requires `confirm: true`
 * and that token, then, under the same lock, re-lists and deletes only token entries that are still
 * present with the same identity, still contained, still finished, and still older than the cutoff.
 * @throws Error "Choose a time that has already passed." for a future or invalid cutoff;
 *   "Confirm the screenshot preview first." without confirm; "This preview is out of date. Preview again."
 *   for an unknown, used, expired or foreign token.
 * @complexity O(n log n) in captures listed; one remove call per confirmed capture.
 */
export function createCaptureRetention(
  { root, listOwned, removeOwned, previewStore, clock, lock }: {
    root: string; listOwned: ListOwnedCaptures; removeOwned: RemoveOwnedCapture;
    previewStore: CleanupPreviewStore; clock: () => number; lock: CaptureRootLock;
  },
  { limit = 500 }: { limit?: number } = {},
) {
  const key = path.resolve(root);
  const eligible = async (before: number) => (await listOwned({ root: key }, {}))
    .filter((entry) => isEligible({ entry, before }));
  return {
    async preview({ principal, scope, before }: { principal: string; scope: string; before: number }, _optional: Record<string, never> = {}): Promise<CaptureRetentionPreview> {
      if (!Number.isFinite(before) || before > clock()) throw new Error("Choose a time that has already passed.");
      const chosen = await lock.withLock({ key, run: async () => (await eligible(before))
        .sort((a, b) => a.mtimeMs - b.mtimeMs || a.relPath.localeCompare(b.relPath)).slice(0, limit) }, {});
      const items = chosen.map(({ relPath, identity }) => ({ relPath, identity }));
      const { token, deadline } = previewStore.put({ principal, kind: PREVIEW_KIND, scope, payload: { before, items } }, {});
      return { previewToken: token, deadline, count: chosen.length, bytes: chosen.reduce((sum, entry) => sum + entry.size, 0), items: chosen.slice(0, SHOWN_ITEMS).map((entry) => entry.relPath) };
    },
    async apply({ principal, scope, previewToken, confirm }: { principal: string; scope: string; previewToken: string; confirm: boolean }, _optional: Record<string, never> = {}): Promise<CaptureRetentionResult> {
      if (confirm !== true) throw new Error("Confirm the screenshot preview first.");
      const taken = previewStore.take({ token: previewToken, principal, kind: PREVIEW_KIND, scope }, {});
      if (!taken) throw new Error("This preview is out of date. Preview again.");
      const { before, items } = taken.payload as { before: number; items: { relPath: string; identity: string }[] };
      return lock.withLock({ key, run: async () => {
        const current = new Map((await eligible(before)).map((entry) => [entry.relPath, entry]));
        const result: CaptureRetentionResult = { deleted: [], kept: [] };
        for (const { relPath, identity } of items) {
          const now = current.get(relPath);
          if (!now) result.kept.push({ relPath, reason: "not-eligible" });
          else if (now.identity !== identity) result.kept.push({ relPath, reason: "changed" });
          else if (await removeOwned({ root: key, relPath, identity }, {})) result.deleted.push(relPath);
          else result.kept.push({ relPath, reason: "missing" });
        }
        return result;
      } }, {});
    },
  };
}

/** The slice of `node:fs/promises` the default ports use. */
export interface CaptureFs {
  readdir(path: string): Promise<string[]>;
  lstat(path: string, options: { bigint: true }): Promise<{ dev: bigint; ino: bigint; size: bigint; mtimeMs: bigint; mtimeNs: bigint; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }>;
  unlink(path: string): Promise<void>;
}

type BigStat = Awaited<ReturnType<CaptureFs["lstat"]>>;

function entryOf({ relPath, stat }: { relPath: string; stat: BigStat }): CaptureEntry {
  const kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
  return { relPath, kind, identity: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`, mtimeMs: Number(stat.mtimeMs), size: Number(stat.size) };
}

/**
 * Default `listOwned` / `removeOwned` over an injected fs. Lists the root and its real (non-symlinked)
 * date folders one level deep with `lstat`; symlinks are reported as such and never followed.
 * `removeOwned` re-`lstat`s and unlinks only a regular file whose identity still matches.
 * @complexity O(entries) fs calls for a listing; two for a removal.
 */
export function createCaptureFilePorts({ fs }: { fs: CaptureFs }, _optional: Record<string, never> = {}): { listOwned: ListOwnedCaptures; removeOwned: RemoveOwnedCapture } {
  const lstatOrNull = (file: string) => fs.lstat(file, { bigint: true }).catch(() => null);
  const listDir = async (dir: string, prefix: string): Promise<CaptureEntry[]> => {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const entries: CaptureEntry[] = [];
    for (const name of names) {
      const stat = await lstatOrNull(path.join(dir, name));
      if (stat) entries.push(entryOf({ relPath: prefix + name, stat }));
    }
    return entries;
  };
  return {
    async listOwned({ root }) {
      const rootStat = await lstatOrNull(root);
      if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return [];
      const top = await listDir(root, "");
      const nested = await Promise.all(top.filter((entry) => entry.kind === "directory").map((entry) => listDir(path.join(root, entry.relPath), `${entry.relPath}/`)));
      return [...top, ...nested.flat()];
    },
    async removeOwned({ root, relPath, identity }) {
      const file = path.join(root, relPath);
      const stat = await lstatOrNull(file);
      if (!stat || entryOf({ relPath, stat }).kind !== "file" || entryOf({ relPath, stat }).identity !== identity) return false;
      await fs.unlink(file);
      return true;
    },
  };
}
