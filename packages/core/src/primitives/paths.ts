/** Root of an already `/`-separated Windows path: a drive root (`C:/`) or a UNC share root. */
function windowsRoot(path: string): string | undefined {
  return /^[A-Za-z]:\//.exec(path)?.[0] ?? /^\/\/[^/]+\/[^/]+(?:\/|$)/.exec(path)?.[0];
}

/** Lexically resolve `.` and `..` segments; `..` never climbs above the root. */
function resolveSegments(rest: string): string[] {
  const segments: string[] = [];
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments;
}

/** Pure lexical normalization of an already absolute path; no cwd, filesystem or symlink access. */
function normalizeAbsolutePath(value: string, separator: '/' | '\\'): string {
  const windows = separator === '\\';
  const path = windows ? value.replace(/\\/g, '/') : value;
  const prefix = (windows ? windowsRoot(path) : undefined) ?? (path.startsWith('/') ? '/' : undefined);
  if (!prefix) throw new RangeError('pathContains requires resolved absolute paths');
  return prefix.replace(/\/+$/, '') + '/' + resolveSegments(path.slice(prefix.length)).join('/');
}

/**
 * Check lexical containment using whole directory segments, including equality.
 * Hosts resolve cwd-relative paths and symlinks before calling: checking a textual
 * prefix alone can permit traversal or a symlink escape. Keeping that effect outside
 * this helper makes the kernel browser-safe. Windows hosts select case-insensitive
 * comparison and backslash separators; drive roots and UNC share roots remain distinct.
 * POSIX backslashes remain literal characters, so distinct directories cannot alias.
 */
export function pathContains(
  { root, target }: { root: string; target: string },
  { caseSensitive = true, separator = '/' }: { caseSensitive?: boolean; separator?: '/' | '\\' } = {},
): boolean {
  const normalize = (value: string): string => {
    const path = normalizeAbsolutePath(value, separator);
    return caseSensitive ? path : path.toLowerCase();
  };
  const normalizedRoot = normalize(root);
  const normalizedTarget = normalize(target);
  const boundary = normalizedRoot.endsWith('/') ? normalizedRoot : normalizedRoot + '/';
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(boundary);
}
