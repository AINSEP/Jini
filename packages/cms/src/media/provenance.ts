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

/** A generator label (model or vendor id) is a short plain catalog id, never free text.
 * @throws MediaValidationError for blank, control-character or over-long labels. @complexity O(label length). */
function generatorLabel({ label }: { label: string }, _options = {}): string {
  if (label.trim() === '' || label.length > 200 || /[\x00-\x1f\x7f]/.test(label)) {
    throw new MediaValidationError({ message: 'generated image model and vendor must be short plain labels (1-200 characters, no line breaks)' });
  }
  return label;
}

/** Keep a generated origin's optional path, model and vendor; omit each field that is absent.
 * @throws MediaValidationError for an unsafe path or label. @complexity O(origin length). */
function generatedOrigin({ source }: { source: Extract<MediaProvenance, { kind: 'generated' }> }, _options = {}): MediaProvenance {
  return {
    kind: 'generated',
    ...(source.path === undefined ? {} : { path: relativeOrigin({ path: source.path }) }),
    ...(source.model === undefined ? {} : { model: generatorLabel({ label: source.model }) }),
    ...(source.provider === undefined ? {} : { provider: generatorLabel({ label: source.provider }) }),
  };
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
  if (source.kind === 'generated') return generatedOrigin({ source });
  if (source.kind === 'upload') {
    return source.path === undefined ? { kind: source.kind } : { kind: source.kind, path: relativeOrigin({ path: source.path }) };
  }
  throw new MediaValidationError({ message: 'unknown source kind' });
}
