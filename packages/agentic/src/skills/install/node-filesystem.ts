import { lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { FilesystemPort } from './ports.js';

/** Node adapter kept separate from the injected installation policy. */
export function createNodeSkillFilesystem(_required: Record<string, never>, _optional: Record<string, never> = {}): FilesystemPort {
  return {
    mkdir: async ({ path }) => { await mkdir(path, { recursive: true }); },
    mkdtemp: ({ prefix }) => mkdtemp(prefix),
    lstat: async ({ path }) => {
      const stat = await lstat(path);
      return { kind: stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other', size: stat.size };
    },
    readFile: async ({ path, maxBytes }) => {
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maxBytes) throw new Error('Invalid skill installation record.');
        const chunks: Buffer[] = [];
        let size = 0;
        for (;;) {
          const chunk = Buffer.alloc(Math.min(4096, maxBytes + 1 - size));
          const result = await handle.read(chunk, 0, chunk.length, null);
          if (!result.bytesRead) break;
          size += result.bytesRead;
          if (size > maxBytes) throw new Error('Invalid skill installation record.');
          chunks.push(chunk.subarray(0, result.bytesRead));
        }
        return Buffer.concat(chunks);
      } finally { await handle.close(); }
    },
    writeFile: ({ path, bytes, exclusive, mode }) => writeFile(path, bytes, { flag: exclusive ? 'wx' : 'w', mode }),
    rename: ({ from, to }) => rename(from, to),
    remove: ({ path }, options = {}) => rm(path, options),
  };
}
