/**
 * @file The default `local` object-store provider: keys are paths under one root directory.
 *
 * Path formula is `join(rootDir, key)` — byte-identical to `@jini-ai/cms`'s `LocalFsBlobStore`
 * (`resolvePath`), so a host that moves its media from that class to this store reads every
 * existing upload unchanged (no data migration). Unlike that class, keys here come from callers,
 * so a key that would resolve outside `rootDir` (`..`, absolute) is refused before any syscall.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

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
  if (key === '' || isAbsolute(key) || rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`object key '${key}' is outside the store root`);
  }
  return path;
}

/**
 * Creates a local-filesystem `ObjectStore` rooted at `rootDir`.
 * @complexity Each call is O(1) syscalls beyond the read/write itself.
 */
export function createLocalFsObjectStore(required: { readonly rootDir: string }, _optional: Record<string, never> = {}): ObjectStore {
  const { rootDir } = required;
  const pathOf = (key: string) => contained({ rootDir, key });
  return {
    async put({ key, bytes }, options = {}) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      if (!options.ifAbsent) {
        await writeFile(path, bytes);
        return { written: true };
      }
      // `"wx"` (`O_CREAT | O_EXCL`) makes create-only a kernel-enforced atomic op: of two racing
      // opens of the same path exactly one succeeds and the other gets `EEXIST`, so there is no
      // window between "check" and "write" for a concurrent writer to land in.
      try {
        await writeFile(path, bytes, { flag: 'wx' });
        return { written: true };
      } catch (error) {
        if (errnoCode(error) === 'EEXIST') return { written: false };
        throw error;
      }
    },
    async get({ key }) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') return null;
        throw error;
      }
    },
    // Only ENOENT is absence; EACCES/ENOTDIR/EIO reject, so a caller never mistakes "this stat
    // failed" for "the object was deleted".
    async head({ key }) {
      try {
        return { size: (await stat(pathOf(key))).size };
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') return null;
        throw error;
      }
    },
    async delete({ key }) {
      await rm(pathOf(key), { force: true });
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
