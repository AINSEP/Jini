import { once } from 'node:events';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { ExportPathError, type AppFactoryPort, type ArtifactWriterPort, type AssetSourcePort } from './contracts.js';
import { safeRelativeOutputFile } from './transforms.js';

/** Create one directory level; an existing entry is left for the caller's lstat check. */
async function makeDirectory(directory: string): Promise<void> {
  try { await mkdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}
/** True only for macOS's own /tmp or /var symlink into /private. */
async function isSystemTempAlias(current: string, info: Stats): Promise<boolean> {
  // macOS exposes its system temporary roots through these fixed OS aliases. Arbitrary
  // symlinks still fail closed; rejecting /var would reject Node's own tmpdir() output.
  if (process.platform !== 'darwin' || (current !== '/tmp' && current !== '/var') || !info.isSymbolicLink()) return false;
  return await realpath(current) === '/private' + current;
}
/** Require regular directories at every ancestor. Hosts must use canonical absolute storage paths.
 * The storage hierarchy must be caller-owned; cross-process hostile ancestor swaps require host isolation.
 */
async function ensureDirectory({ directory, label }: { directory: string; label: 'Output' | 'Artifact' | 'Theme' }, optional: { create?: boolean } = {}): Promise<void> {
  if (!path.isAbsolute(directory)) throw new ExportPathError(`${label} path must be absolute.`);
  const resolved = path.resolve(directory);
  const { root } = path.parse(resolved);
  let current = root;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (optional.create) await makeDirectory(current);
    const info = await lstat(current);
    if (await isSystemTempAlias(current, info)) continue;
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ExportPathError(`${label} path must be a regular directory.`);
  }
}
/** Overlay exports in a caller-owned directory; only explicit clean removes unrelated files.
 * No persisted ownership marker exists, so overlays also support exports from earlier versions.
 * Paths and existing files still require regular, no-follow storage; filesystem errors propagate.
 * The legacy nonemptyReason option remains accepted for source compatibility.
 */
export function createNodeArtifactWriter(_required: Record<string, never>, _optional: { nonemptyReason?: (required: { outputDir: string; count: number }) => string } = {}): ArtifactWriterPort {
  return {
    async prepare({ outputDir }, options = {}) {
      await ensureDirectory({ directory: outputDir, label: 'Output' }, { create: true });
      if (options.clean) for (const entry of await readdir(outputDir)) await rm(path.join(outputDir, entry), { recursive: true, force: true });
    },
    async write({ outputDir, outputFile, data }) {
      safeRelativeOutputFile({ value: outputFile });
      await ensureDirectory({ directory: outputDir, label: 'Output' }, { create: true });
      const destination = path.join(outputDir, outputFile);
      await ensureDirectory({ directory: path.dirname(destination), label: 'Artifact' }, { create: true });
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
function closeServer(server: Server): Promise<void> {
  return new Promise<void>(resolve => { server.close(() => resolve()); });
}
/** Independent Node loopback adapter. The app factory is required and remains owned by the host. */
export function createNodeAppFactory(required: { createApp(required: Record<string, never>): RequestListener | Promise<RequestListener> }, _optional = {}): AppFactoryPort {
  return { async open() {
    const server = createServer(await required.createApp({}));
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await closeServer(server);
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
export function createNodeAssetSource(_required: Record<string, never>, _optional = {}): AssetSourcePort {
  async function list(directory: string, prefix: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) {
        files.push(...await list(path.join(directory, entry.name), relative + '/'));
        continue;
      }
      if (entry.isFile()) files.push(relative);
    }
    return files;
  }
  return { async listThemeFiles({ theme }) { await ensureDirectory({ directory: theme.dir, label: 'Theme' }); return (await list(theme.dir, '')).sort(); } };
}
