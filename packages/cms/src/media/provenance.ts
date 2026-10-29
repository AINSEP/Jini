import { MediaValidationError, type MediaProvenance } from './types.js';

/** Keep only a relative origin label; reject absolute, encoded traversal and control characters.
 * @throws MediaValidationError before storage for unsafe paths. @complexity O(path length). */
function relativeOrigin({ path }: { path: string }, _options = {}): string {
  let decoded: string;
  try { decoded = decodeURIComponent(path).replace(/\\/g, '/'); }
  catch { throw new MediaValidationError({ message: 'source path must be a safe relative path' }); }
  const parts = decoded.split('/');
  if (/(?:^[~/])|:|[\x00-\x1f\x7f?#%]/.test(decoded) || parts.some(part => !part || part === '..' || part === '.')) {
    throw new MediaValidationError({ message: 'source path must be a safe relative path' });
  }
  return decoded;
}

/** Project origin metadata through an allowlist, removing URL credentials, queries and fragments.
 * Call before any upload effects; never persist filesystem roots or signed URL credentials.
 * @throws MediaValidationError for an invalid URL, kind or path. @complexity O(origin length). */
export function safeMediaProvenance({ source }: { source?: MediaProvenance | undefined }, _options = {}): MediaProvenance {
  if (!source) return { kind: 'upload' };
  if (source.kind === 'url') {
    let url: URL;
    try { url = new URL(source.url); }
    catch { throw new MediaValidationError({ message: 'source URL must be HTTP or HTTPS' }); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new MediaValidationError({ message: 'source URL must be HTTP or HTTPS' });
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return { kind: 'url', url: url.href };
  }
  if (source.kind === 'picked-folder') return { kind: source.kind, path: relativeOrigin({ path: source.path }) };
  if (source.kind === 'upload' || source.kind === 'generated') {
    return source.path === undefined ? { kind: source.kind } : { kind: source.kind, path: relativeOrigin({ path: source.path }) };
  }
  throw new MediaValidationError({ message: 'unknown source kind' });
}
