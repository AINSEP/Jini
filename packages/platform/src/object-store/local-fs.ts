/**
 * @file The default `local` object-store provider: keys are paths under one root directory.
 *
 * Path formula is `join(rootDir, key)` — byte-identical to `@jini-ai/cms`'s `LocalFsBlobStore`
 * (`resolvePath`), so a host that moves its media from that class to this store reads every
 * existing upload unchanged (no data migration). Unlike that class, keys here come from callers,
 * so a key that would resolve outside `rootDir` (`..`, absolute) is refused before any syscall.
 *
 * Lexical containment alone is not enough: `<root>/link -> /elsewhere` makes `link/victim` look
 * contained while every syscall follows the link out of the root. So each operation also checks
 * the key's parent *physically* (realpath of its nearest existing ancestor against the realpath
 * of the root), and the final component is opened with `O_NOFOLLOW` / `lstat`ed, so a symlink
 * planted as the object itself is refused rather than followed.
 */
import { constants } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { ObjectStore, ObjectStoreProvider } from '@jini-ai/core/object-store';
import { providerOk } from '@jini-ai/core/provider-registry';

/** Node's errno-carrying error, narrowed without a cast at each call site. */
function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * Resolves `key` under `rootDir`, refusing any key that escapes it.
 * @throws {Error} The key is empty, absolute, or resolves outside the root.
 * @complexity O(key length).
 */
function contained(required: { readonly rootDir: string; readonly key: string }): string {
  const { rootDir, key } = required;
  const path = join(rootDir, key);
  const rel = relative(resolve(rootDir), resolve(path));
  const invalidKey = key === '' || isAbsolute(key);
  const escapesRoot = rel === '' || rel.startsWith('..') || isAbsolute(rel);
  if (invalidKey || escapesRoot) {
    throw new Error(`object key '${key}' is outside the store root`);
  }
  return path;
}

// `O_NOFOLLOW` makes the open itself fail (`ELOOP`) when the final component is a symlink, so a link
// swapped in after the containment check cannot redirect the read/write. Where the platform lacks it
// (Windows) the constant is undefined, which a bitwise OR coerces to 0 — degrading to the physical
// parent check alone.
const NOFOLLOW = constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | NOFOLLOW;
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW;
const CREATE_ONLY_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;

/**
 * Realpath of `path`, or of its nearest existing ancestor with the missing tail re-appended.
 * Recursion terminates because the filesystem root always exists; any fault other than absence
 * (`ENOTDIR`, `EACCES`, `ELOOP`) rejects.
 * @complexity O(depth) syscalls.
 */
async function realpathOfNearest(required: { readonly path: string }): Promise<string> {
  const { path } = required;
  try {
    return await realpath(path);
  } catch (error) {
    if (errnoCode(error) !== 'ENOENT') throw error;
    return join(await realpathOfNearest({ path: dirname(path) }), basename(path));
  }
}

/**
 * Resolves `key` lexically, then refuses it unless its parent directory is physically inside the
 * root (so a directory symlink pointing out of the root cannot be traversed).
 * @throws {Error} The key escapes the root lexically or through a symlinked ancestor.
 * @complexity O(depth) syscalls.
 */
async function physicallyContained(required: { readonly rootDir: string; readonly key: string }): Promise<string> {
  const path = contained(required);
  const realRoot = await realpathOfNearest({ path: resolve(required.rootDir) });
  const rel = relative(realRoot, await realpathOfNearest({ path: dirname(resolve(path)) }));
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`object key '${required.key}' is outside the store root`);
  }
  return path;
}

/**
 * Creates a local-filesystem `ObjectStore` rooted at `rootDir`.
 * @complexity Each call is O(1) syscalls beyond the read/write itself.
 */
export function createLocalFsObjectStore(required: { readonly rootDir: string }, _optional: Record<string, never> = {}): ObjectStore {
  const { rootDir } = required;
  const pathOf = (key: string) => physicallyContained({ rootDir, key });
  return {
    async put({ key, bytes }, options = {}) {
      const path = await pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      if (!options.ifAbsent) {
        await writeFile(path, bytes, { flag: WRITE_FLAGS });
        return { written: true };
      }
      // `O_CREAT | O_EXCL` (`"wx"`) makes create-only a kernel-enforced atomic op: of two racing
      // opens of the same path exactly one succeeds and the other gets `EEXIST`, so there is no
      // window between "check" and "write" for a concurrent writer to land in.
      try {
        await writeFile(path, bytes, { flag: CREATE_ONLY_FLAGS });
        return { written: true };
      } catch (error) {
        if (errnoCode(error) === 'EEXIST') return { written: false };
        throw error;
      }
    },
    async get({ key }) {
      try {
        return new Uint8Array(await readFile(await pathOf(key), { flag: READ_FLAGS }));
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') return null;
        throw error;
      }
    },
    // Only ENOENT is absence; EACCES/ENOTDIR/EIO reject, so a caller never mistakes "this stat
    // failed" for "the object was deleted". `lstat` (not `stat`) so a symlink is reported as a
    // refusal instead of the size of whatever it points at.
    async head({ key }) {
      try {
        const info = await lstat(await pathOf(key));
        if (info.isSymbolicLink()) throw new Error(`object key '${key}' is a symbolic link`);
        return { size: info.size };
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') return null;
        throw error;
      }
    },
    // `rm` unlinks a final-component symlink itself and never its target; the physical parent check
    // keeps it from deleting through a symlinked directory.
    async delete({ key }) {
      await rm(await pathOf(key), { force: true });
    },
  };
}

/**
 * The `local` provider bound to one root directory (the host owns where bytes live; settings and
 * credentials are ignored — local storage needs neither).
 * @complexity O(1).
 */
export function createLocalFsObjectStoreProvider(required: { readonly rootDir: string }, _optional: Record<string, never> = {}): ObjectStoreProvider {
  return { create: () => providerOk({ value: createLocalFsObjectStore({ rootDir: required.rootDir }) }) };
}
