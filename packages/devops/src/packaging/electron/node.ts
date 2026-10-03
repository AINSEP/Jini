import { existsSync, readFileSync, lstatSync, readdirSync, realpathSync, mkdirSync, cpSync, rmSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import type { PackagingFilesystemPort, PackageResolverPort } from './ports.js';

/** Explicit Node filesystem adapter. No effects occur until a port method is called. */
export function createNodePackagingFilesystem(_required: Record<string, never>): PackagingFilesystemPort {
  return {
    exists: ({ path }) => existsSync(path), read: ({ path }) => readFileSync(path),
    // Allocation and I/O depend only on the prefix bound, even for very large payload files.
    readPrefix: ({ path, maxBytes }) => {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('maxBytes must be a nonnegative safe integer');
      const bytes = Buffer.alloc(maxBytes);
      const fd = openSync(path, 'r');
      try {
        const bytesRead = readSync(fd, bytes, 0, maxBytes, 0);
        return bytes.subarray(0, bytesRead);
      } finally { closeSync(fd); }
    },
    stat: ({ path }) => { const info = lstatSync(path); return { kind: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', mtimeMs: info.mtimeMs, diskBytes: info.blocks * 512 }; },
    entries: ({ path }) => readdirSync(path), realpath: ({ path }) => realpathSync(path),
    copy: ({ from, to }, optional = {}) => {
      const source = realpathSync(from);
      const destination = path.resolve(to);
      if (destination === source || destination.startsWith(source + path.sep) || source.startsWith(destination + path.sep)) throw new Error('staging source and destination must be disjoint');
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(source, destination, { recursive: true, dereference: true, filter: full => full === source || (!(optional.dropNestedModules && path.basename(full) === 'node_modules') && !optional.exclude?.({ path: full, directory: statSync(full).isDirectory() })) });
    },
    remove: ({ path }) => rmSync(path, { recursive: true, force: true }),
  };
}
/** Node's upward node_modules walk resolves pnpm links to real package roots. */
export function createNodePackageResolver({ fs }: { fs: PackagingFilesystemPort }): PackageResolverPort {
  return { resolve({ fromDirectory, packageName }) {
    if (!/^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(packageName)) throw new Error('Invalid package name');
    let directory = path.resolve(fromDirectory);
    for (;;) {
      const candidate = path.join(directory, 'node_modules', packageName);
      if (fs.exists({ path: path.join(candidate, 'package.json') })) return fs.realpath({ path: candidate });
      const parent = path.dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  } };
}
