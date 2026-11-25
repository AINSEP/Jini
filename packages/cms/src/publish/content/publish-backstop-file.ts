import fs, { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { RawFilePort, RawFileSnapshot } from "../transfer/index.js";
import { BackstopRefusal, type RawFilePolicy } from "./backstop-refusal.js";

function missing({ error }: { error: unknown }, _optional = {}): boolean { return (error as { code?: string })?.code === "ENOENT"; }
function sha(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

const LINK_REFUSAL = "Links are never sent; choose a regular file inside the site folder.";
const NOT_REGULAR_REFUSAL = "Choose a regular file inside the site folder.";

/** The `node:fs` calls this adapter makes, injectable so fault paths are testable without races. */
export type BackstopFilesystem = Pick<typeof fs, "lstatSync" | "mkdirSync" | "openSync" | "closeSync" | "readFileSync" | "writeFileSync" | "renameSync" | "unlinkSync" | "chmodSync">;

/** lstat that reports an absent path as null; every other failure propagates. */
function lstatOrNull({ file }: { file: string }, { filesystem }: { filesystem: BackstopFilesystem }): fs.Stats | null {
  try { return filesystem.lstatSync(file); } catch (error) {
      if (missing({ error })) return null;
      throw error;
    }
}

/** Walk each component below the root without following links. An absent component means the
 * file is new, which is safe. @complexity O(c) lstat calls for c path components.
 */
function componentsRefusal({ root, parts }: { root: string; parts: readonly string[] }, { filesystem }: { filesystem: BackstopFilesystem }): string | null {
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatOrNull({ file: current }, { filesystem });
    if (!stat) return null;
    if (stat.isSymbolicLink()) return LINK_REFUSAL;
    if (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) return NOT_REGULAR_REFUSAL;
  }
  return null;
}
function createRawFileReader(root: string, filesystem: BackstopFilesystem, { lstatSync, openSync, closeSync, readFileSync }: Pick<BackstopFilesystem, "lstatSync" | "openSync" | "closeSync" | "readFileSync">, { checkRawFilePath, maxBytes, normalizeMode }: RawFilePolicy) {
  function check({ relPath }: { relPath: string }, _optional = {}): string | null {
    const denied = checkRawFilePath({ relPath });
    if (denied) return denied;
    try {
      // lstat never follows a link: a linked site folder is not a directory here.
      if (!lstatSync(root).isDirectory()) return "The site folder must be a real directory, never a link.";
      return componentsRefusal({ root, parts: relPath.split("/") }, { filesystem });
    } catch (error) { return missing({ error }) ? "The site folder is unavailable." : "This file cannot be inspected safely."; }
  }

  function target({ relPath }: { relPath: string }, _optional = {}): string {
    const reason = check({ relPath });
    if (reason) throw new BackstopRefusal({ message: reason });
    return path.join(root, ...relPath.split("/"));
  }

  function read({ relPath }: { relPath: string }, _optional = {}): RawFileSnapshot | null {
    const filename = target({ relPath });
    let fd: number;
    try { fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
      if (missing({ error })) return null;
      throw error;
    }
    try {
      const stat = lstatSync(filename);
      if (stat.size > maxBytes) throw new BackstopRefusal({ message: "Choose files totaling at most 50 MB per send." });
      return { absPath: filename, bytes: readFileSync(fd), mode: normalizeMode({ mode: stat.mode }) };
    } finally { closeSync(fd); }
  }
  return { check, target, read };
}

function createRawFileDirectories(root: string, filesystem: BackstopFilesystem, { mkdirSync, chmodSync }: Pick<BackstopFilesystem, "mkdirSync" | "chmodSync">) {
  function privateDir({ name }: { name: ".publish-staging" | ".publish-previous" }, _optional = {}): string {
    const dir = path.join(root, name);
    // lstat never follows a link, so a linked folder fails isDirectory() too.
    const stat = lstatOrNull({ file: dir }, { filesystem });
    if (!stat) mkdirSync(dir, { mode: 0o700 });
    if (stat && !stat.isDirectory()) throw new BackstopRefusal({ message: "The publish staging folder is not a safe directory." });
    chmodSync(dir, 0o700);
    return dir;
  }

  function parents({ relPath }: { relPath: string }, _optional = {}): void {
    let current = root;
    for (const part of relPath.split("/").slice(0, -1)) {
      current = path.join(current, part);
      const stat = lstatOrNull({ file: current }, { filesystem });
      if (!stat) mkdirSync(current, { mode: 0o755 });
      if (stat && !stat.isDirectory()) throw new BackstopRefusal({ message: LINK_REFUSAL });
    }
  }
  return { privateDir, parents };
}
function createRawFileUndoReader({ openSync, closeSync, readFileSync, unlinkSync }: Pick<BackstopFilesystem, 'openSync' | 'closeSync' | 'readFileSync' | 'unlinkSync'>, { read, target }: Pick<ReturnType<typeof createRawFileReader>, 'read' | 'target'>) {
  /** A backup's bytes, or `null` when it is gone. Never follows a link. */
  function readBackup({ backup }: { backup: string }, _optional = {}): Buffer | null {
    let fd: number;
    try { fd = openSync(backup, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
      if (missing({ error })) return null;
      throw error;
    }
    try { return readFileSync(fd); } finally { closeSync(fd); }
  }

  function alreadyRestored(inverse: { relPath: string; sha256: string | null }): boolean {
    const current = read({ relPath: inverse.relPath });
    return current !== null && sha(current.bytes) === inverse.sha256;
  }

  function removeCreatedFile({ relPath }: { relPath: string }, _optional = {}): void {
    try { unlinkSync(target({ relPath })); } catch (error) { if (!missing({ error })) throw error; }
  }
  return { readBackup, alreadyRestored, removeCreatedFile };
}



/** Single CMS site-file adapter. lstat every component, never follow a link; stage on the same
 * filesystem and rename only verified regular bytes. Previous files stay in a private folder for
 * one-click undo, rather than relying on the whole-db restore/restart path.
 * @param required.checkRawFilePath - Host path deny-list; returns a refusal message or null.
 * @param required.maxBytes - Host per-file size cap.
 * @param required.normalizeMode - Host file-mode normalizer baked into the checked hash.
 * @param options.filesystem - The `node:fs` calls used; defaults to Node's.
 */
export function createRawFileSitePort({ siteDir, checkRawFilePath, maxBytes, normalizeMode }: { siteDir: string } & RawFilePolicy, { filesystem = fs }: { filesystem?: BackstopFilesystem } = {}): RawFilePort {
  const { lstatSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, chmodSync } = filesystem;
  const root = path.resolve(siteDir);
  const { check, target, read } = createRawFileReader(root, filesystem, { lstatSync, openSync, closeSync, readFileSync }, { checkRawFilePath, maxBytes, normalizeMode });
  const { privateDir, parents } = createRawFileDirectories(root, filesystem, { mkdirSync, chmodSync });
  const { readBackup, alreadyRestored, removeCreatedFile } = createRawFileUndoReader({ openSync, closeSync, readFileSync, unlinkSync }, { read, target });
  function replace({ relPath, bytes, mode }: { relPath: string; bytes: Uint8Array; mode: number }, _optional = {}): void {
    target({ relPath });
    if (bytes.byteLength > maxBytes) throw new BackstopRefusal({ message: "Choose files totaling at most 50 MB per send." });
    const stage = path.join(privateDir({ name: ".publish-staging" }), randomUUID());
    try {
      writeFileSync(stage, bytes, { mode: normalizeMode({ mode }), flag: "wx" });
      // The process umask must not change the normalized mode included in the checked hash.
      chmodSync(stage, normalizeMode({ mode }));
      if (sha(readFileSync(stage)) !== sha(bytes)) throw new BackstopRefusal({ message: "The staged file failed its checksum check." });
      parents({ relPath });
      renameSync(stage, target({ relPath }));
    } finally {
      try { unlinkSync(stage); } catch (error) { if (!missing({ error })) throw error; }
    }
  }
  return {
    check: async ({ relPath }) => check({ relPath }),
    read: async ({ relPath }) => read({ relPath }),
    capture: async ({ relPath }) => {
      const prior = read({ relPath });
      if (!prior) return { relPath, backupName: null, sha256: null, size: null, mode: 0o644 };
      const backupName = randomUUID();
      writeFileSync(path.join(privateDir({ name: ".publish-previous" }), backupName), prior.bytes, { mode: 0o600, flag: "wx" });
      return { relPath, backupName, sha256: sha(prior.bytes), size: prior.bytes.byteLength, mode: prior.mode };
    },
    replace: async ({ relPath, bytes, mode }) => replace({ relPath, bytes, mode }),
    restore: async ({ inverse }) => {
      if (inverse.backupName === null) {
        removeCreatedFile({ relPath: inverse.relPath });
        return;
      }
      if (!/^[a-f0-9-]{36}$/.test(inverse.backupName)) throw new BackstopRefusal({ message: "The saved undo file has an unsafe address." });
      const backup = path.join(privateDir({ name: ".publish-previous" }), inverse.backupName);
      const bytes = readBackup({ backup });
      // A repeated undo finds its copy already reclaimed below: done when the file holds those bytes.
      if (bytes === null && alreadyRestored(inverse)) return;
      if (bytes === null) throw new BackstopRefusal({ message: "The saved undo file is missing." });
      if (sha(bytes) !== inverse.sha256) throw new BackstopRefusal({ message: "The saved undo file failed its checksum check." });
      replace({ relPath: inverse.relPath, bytes, mode: inverse.mode });
      // The undo is spent and nothing else reads this copy; kept, every overwrite would leave up to
      // 50 MB behind for good.
      try { unlinkSync(backup); } catch (error) { if (!missing({ error })) throw error; }
    },
  };
}
