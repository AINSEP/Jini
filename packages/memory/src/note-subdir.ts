/** @module note-subdir
 * Validation of a note store's `optional.subdir`: exactly one literal path segment, never a traversal or
 * rooted path. Pure string/path rules; split out of `note-store.ts` to keep that file under the size limit.
 */
import path from 'node:path';

/** True when `subdir` is not a non-empty string of at most 128 characters. */
export function hasInvalidSubdirLength({ subdir }: { subdir: unknown }): boolean {
  return typeof subdir !== 'string' || subdir.length === 0 || subdir.length > 128;
}

/** True for the two relative-path segments that never denote a real subdirectory name. */
export function isReservedRelativeSegment({ subdir }: { subdir: string }): boolean {
  return subdir === '.' || subdir === '..';
}

/** True when `subdir` contains a POSIX/Windows path separator or an embedded NUL. */
export function containsPathSeparatorOrNul({ subdir }: { subdir: string }): boolean {
  return subdir.includes('/') || subdir.includes('\\') || subdir.includes('\0');
}

/**
 * True when `subdir` is not a single literal path segment once parsed as a
 * Windows path — checked against `path.win32` unconditionally, not the
 * platform-bound `path` import: a drive-relative segment like `"C:foo"` has
 * no `/`/`\` (so `containsPathSeparatorOrNul` doesn't catch it), yet
 * `path.win32.basename` strips the `"C:"` prefix
 * (`path.win32.basename('C:foo') === 'foo'`) — a real parse-ambiguity
 * filesystem code would only see on an actual Windows host,
 * if this were checked via the platform-bound `path` module instead. Using
 * `path.win32` explicitly makes this validation's outcome identical on every
 * host OS this daemon might run on, rather than silently depending on which
 * platform happens to run it (`path.win32` is a strict superset of
 * `path.posix`'s own separator handling — accepting both `/` and `\` — so
 * this subsumes the POSIX check too, not just adds a Windows-only one).
 */
export function isMultiSegmentOrAbsoluteWin32Path({ subdir }: { subdir: string }): boolean {
  return path.win32.basename(subdir) !== subdir || path.win32.isAbsolute(subdir);
}

/** A `optional.subdir` must be exactly one safe, literal path segment — never a traversal or an absolute/rooted path. */
export function assertSafeSubdir(subdir: string): void {
  if (hasInvalidSubdirLength({ subdir })) {
    throw new Error('invalid note store subdir: must be a non-empty string of at most 128 characters');
  }
  if (isReservedRelativeSegment({ subdir })) {
    throw new Error(`invalid note store subdir "${subdir}": must be a single path segment, not "." or ".."`);
  }
  if (containsPathSeparatorOrNul({ subdir })) {
    throw new Error(`invalid note store subdir "${subdir}": must not contain path separators`);
  }
  if (isMultiSegmentOrAbsoluteWin32Path({ subdir })) {
    throw new Error(`invalid note store subdir "${subdir}": must be a single path segment`);
  }
}
