import path from 'node:path';
import type { FileInfo, PackagingFilesystemPort } from '../ports.js';

/** Recorded effect of one port call, so tests can assert what was (and was not) touched. */
export type MemoryCall =
  | { op: 'remove'; path: string }
  | { op: 'copy'; from: string; to: string; dropNestedModules: boolean | undefined; excluding: boolean }
  | { op: 'read' | 'readPrefix'; path: string };

export interface MemoryFs extends PackagingFilesystemPort {
  readonly files: Map<string, Uint8Array>;
  readonly calls: MemoryCall[];
}

/**
 * In-memory PackagingFilesystemPort fake. Directories are implied by file paths (plus `dirs` for
 * empty ones); `others` are non-regular entries (lstat kind `other`); `realpaths` maps a path to
 * its canonical form (identity otherwise). `copy` honours `dropNestedModules` and `exclude`.
 */
export function memoryFs(
  required: { files: Record<string, string | Uint8Array> },
  optional: { dirs?: readonly string[]; others?: readonly string[]; realpaths?: Record<string, string>; mtimes?: Record<string, number>; diskBytes?: number; withoutPrefix?: boolean } = {},
): MemoryFs {
  const files = new Map(Object.entries(required.files).map(([file, body]) => [file, typeof body === 'string' ? Buffer.from(body) : body]));
  const dirs = new Set(optional.dirs ?? []);
  const others = new Set(optional.others ?? []);
  const calls: MemoryCall[] = [];
  const isDir = (dir: string) => dirs.has(dir) || [...files.keys(), ...others, ...dirs].some(file => file.startsWith(dir + '/'));
  const exists = (target: string) => files.has(target) || others.has(target) || isDir(target);
  const stat = ({ path: target }: { path: string }): FileInfo => {
    if (!exists(target)) throw new Error(`ENOENT: ${target}`);
    const kind = files.has(target) ? 'file' : others.has(target) ? 'other' : 'directory';
    return { kind, mtimeMs: optional.mtimes?.[target] ?? 0, diskBytes: kind === 'directory' ? 0 : optional.diskBytes ?? 1 };
  };
  const port: MemoryFs = {
    files, calls,
    exists: ({ path: target }) => exists(target),
    read: ({ path: target }) => {
      calls.push({ op: 'read', path: target });
      const body = files.get(target);
      if (!body) throw new Error(`ENOENT: ${target}`);
      return body;
    },
    stat,
    entries: ({ path: dir }) => [...new Set([...files.keys(), ...others, ...dirs].filter(file => file.startsWith(dir + '/')).map(file => file.slice(dir.length + 1).split('/')[0]!))],
    realpath: ({ path: target }) => optional.realpaths?.[target] ?? target,
    copy: ({ from, to }, copyOptional = {}) => {
      calls.push({ op: 'copy', from, to, dropNestedModules: copyOptional.dropNestedModules, excluding: Boolean(copyOptional.exclude) });
      for (const [file, body] of [...files]) {
        if (!file.startsWith(from + '/')) continue;
        const relative = file.slice(from.length + 1);
        const segments = relative.split('/');
        if (copyOptional.dropNestedModules && segments.includes('node_modules')) continue;
        const dropped = segments.some((_, index) => {
          const full = path.join(from, ...segments.slice(0, index + 1));
          return copyOptional.exclude?.({ path: full, directory: index < segments.length - 1 });
        });
        if (!dropped) files.set(path.join(to, relative), body);
      }
    },
    remove: ({ path: target }) => {
      calls.push({ op: 'remove', path: target });
      for (const file of [...files.keys()]) if (file === target || file.startsWith(target + '/')) files.delete(file);
      for (const dir of [...dirs]) if (dir === target || dir.startsWith(target + '/')) dirs.delete(dir);
      others.delete(target);
    },
  };
  if (!optional.withoutPrefix) port.readPrefix = ({ path: target, maxBytes }) => {
    calls.push({ op: 'readPrefix', path: target });
    return (files.get(target) ?? new Uint8Array()).subarray(0, maxBytes);
  };
  return port;
}

/** Only the mutating calls (copy/remove), for tests that assert what was changed rather than read. */
export function effects(fs: MemoryFs): MemoryCall[] { return fs.calls.filter(call => call.op === 'copy' || call.op === 'remove'); }
