/** Invalid repository destinations fail before any provider I/O. */
export class RepositoryPathError extends Error {}

/**
 * Normalize a repository-relative folder, preserving root only when explicitly empty or omitted.
 * @throws RepositoryPathError for malformed values, absolute paths, controls or traversal.
 * @complexity O(folder length), no effects.
 */
export function normalizeRepositoryFolder({ folder = '' }: { folder?: unknown }, _options = {}): string {
  if (typeof folder !== 'string') throw new RepositoryPathError('Target folder must be a string.');
  const value = folder.replaceAll('\\', '/');
  if (value.startsWith('/') || /[:\x00-\x1f\x7f]/.test(value)) throw new RepositoryPathError('Target folder must be relative and contain no controls or drive prefix.');
  const segments = value.split('/');
  if (segments.some(segment => segment === '.' || segment === '..')) throw new RepositoryPathError('Target folder cannot contain . or .. segments.');
  return segments.filter(Boolean).join('/');
}

/** Canonical file paths cannot normalize into a different path or into repository root. */
function canonicalFilePath({ path }: { path: string }, _options = {}): boolean {
  try { return path !== '' && normalizeRepositoryFolder({ folder: path }) === path; }
  catch { return false; }
}

/** Prefix one folder-relative file exactly once; rejects unsafe file paths before returning it.
 * @throws RepositoryPathError for invalid folders or noncanonical file paths.
 * @complexity O(folder + path length), no effects.
 */
export function prefixRepositoryPath({ folder, path }: { folder?: string | undefined; path: string }, _options = {}): string {
  const normalized = normalizeRepositoryFolder({ folder });
  if (!canonicalFilePath({ path })) throw new RepositoryPathError('Repository file path must be a canonical relative path.');
  return normalized ? `${normalized}/${path}` : path;
}

/** Exact directory-boundary containment for untrusted persisted repository paths.
 * @returns False for malformed or noncanonical paths, including sibling prefix collisions.
 * @complexity O(folder + path length), no effects.
 */
export function repositoryPathContained({ folder, path }: { folder?: string | undefined; path: string }, _options = {}): boolean {
  try {
    const normalized = normalizeRepositoryFolder({ folder });
    return canonicalFilePath({ path }) && (normalized === '' || path.startsWith(`${normalized}/`));
  } catch { return false; }
}
