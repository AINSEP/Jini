/**
 * @file Serves the built admin app (`examples/notes-web`'s `dist`) under `/admin/`. It plugs into the
 * adapter's `onUnmatched` hook, so it only ever sees requests no route matched, and answers `undefined` for
 * everything it does not serve (the adapter's plain 404 stands).
 */
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';

const PREFIX = '/admin/';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/** The decoded path segments under /admin/, or null when one could leave the folder (`..`, a slash or NUL once decoded). */
function segmentsOf({ pathname }: { pathname: string }): string[] | null {
  const segments: string[] = [];
  for (const raw of pathname.slice(PREFIX.length).split('/')) {
    let segment: string;
    try { segment = decodeURIComponent(raw); } catch { return null; }
    if (segment === '.' || segment === '..' || /[\\/\0]/.test(segment)) return null;
    if (segment !== '') segments.push(segment);
  }
  return segments;
}

async function realOrNull({ path }: { path: string }): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

/** Reads `file` inside `dir`; null when it is missing, a folder, or resolves (a symlink) outside `dir`. */
async function readInside({ dir, file }: { dir: string; file: string }): Promise<Buffer | null> {
  const root = await realOrNull({ path: dir });
  const full = root === null ? null : await realOrNull({ path: join(root, file) });
  if (root === null || full === null || !full.startsWith(root + sep)) return null;
  try {
    return await readFile(full);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EISDIR') return null;
    throw error;
  }
}

export async function serveAdminBundle(
  { request }: { request: Request },
  { dir }: { dir: string },
): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !pathname.startsWith(PREFIX)) return undefined;
  const segments = segmentsOf({ pathname });
  if (segments === null) return undefined;
  // A path with no file extension is a route of the admin app, which index.html boots.
  const wanted = segments.join('/');
  const file = extname(wanted) === '' ? 'index.html' : wanted;
  const bytes = await readInside({ dir, file });
  if (bytes === null) return undefined;
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': String(bytes.length),
    'x-content-type-options': 'nosniff', 'cache-control': file === 'index.html' ? 'no-cache' : 'public, max-age=3600',
  } });
}
