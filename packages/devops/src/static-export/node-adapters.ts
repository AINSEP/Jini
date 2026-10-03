import { once } from 'node:events';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rm } from 'node:fs/promises';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { ExportOutputNotEmptyError, ExportPathError, type AppFactoryPort, type ArtifactWriterPort, type AssetSourcePort } from './contracts.js';
import { safeRelativeOutputFile } from './transforms.js';

/** Require regular directories at every ancestor. Hosts must use canonical absolute storage paths.
 * The storage hierarchy must be caller-owned; cross-process hostile ancestor swaps require host isolation.
 */
async function ensureDirectory(directory: string, create: boolean): Promise<void> {
  if (!path.isAbsolute(directory)) throw new ExportPathError('Artifact and theme directories must be absolute.');
  const resolved = path.resolve(directory);
  const segments = resolved.slice(path.parse(resolved).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(resolved).root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (create) {
      try { await mkdir(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ExportPathError('Artifact and theme paths must be regular directories.');
  }
}
/** Caller-owned output directory, explicit clean, and no-follow regular-file writes. */
export function createNodeArtifactWriter(_required: Record<string, never>): ArtifactWriterPort {
  return {
    async prepare({ outputDir }, optional = {}) {
      await ensureDirectory(outputDir, true);
      const entries = await readdir(outputDir);
      if (entries.length && !optional.clean) throw new ExportOutputNotEmptyError(`export output directory '${outputDir}' is not empty (${entries.length} existing ${entries.length === 1 ? 'entry' : 'entries'}) — pass clean: true to remove its contents first, or select an empty/new directory`);
      if (optional.clean) for (const entry of entries) await rm(path.join(outputDir, entry), { recursive: true, force: true });
    },
    async write({ outputDir, outputFile, data }) {
      safeRelativeOutputFile({ value: outputFile });
      await ensureDirectory(outputDir, true);
      const destination = path.join(outputDir, outputFile);
      await ensureDirectory(path.dirname(destination), true);
      try {
        const info = await lstat(destination);
        if (!info.isFile() || info.isSymbolicLink()) throw new ExportPathError('Artifact output must be a regular file.');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try {
        if (!(await handle.stat()).isFile()) throw new ExportPathError('Artifact output must be a regular file.');
        await handle.truncate(0);
        await handle.writeFile(data);
      } finally { await handle.close(); }
    },
  };
}
/** Independent Node loopback adapter. The app factory is required and remains owned by the host. */
export function createNodeAppFactory(required: { createApp(required: Record<string, never>): RequestListener | Promise<RequestListener> }): AppFactoryPort {
  return { async open() {
    const server = createServer(await required.createApp({}));
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise<void>(resolve => { server.close(() => resolve()); });
    };
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address() as AddressInfo;
      return { baseUrl: `http://127.0.0.1:${address.port}`, close };
    } catch (error) { await close(); throw error; }
  } };
}
/** Inventory only regular theme files. Rendering and API-version layout stay injected. */
export function createNodeAssetSource(_required: Record<string, never>): AssetSourcePort {
  async function list(directory: string, prefix: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) files.push(...await list(path.join(directory, entry.name), relative + '/'));
      else if (entry.isFile()) files.push(relative);
    }
    return files;
  }
  return { async listThemeFiles({ theme }) { await ensureDirectory(theme.dir, false); return (await list(theme.dir, '')).sort(); } };
}
