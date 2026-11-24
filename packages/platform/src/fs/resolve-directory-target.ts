import fs from "node:fs";
import path from "node:path";

/**
 * @file Path-containment resolution for a caller-supplied directory argument.
 *
 * Purpose:
 * Resolve a caller-supplied `dirArg` to the ONE real target path every subsequent fs operation must derive
 * from — never re-derived from the raw, unresolved argument. Handles three cases:
 *   1. An ordinary path (existing or not, and NOT itself a symlink) — `path.resolve` collapses
 *      any embedded `..` segments purely lexically, with no filesystem access needed. Returned
 *      as-is, deliberately WITHOUT canonicalizing every ancestor segment (`fs.realpathSync` on
 *      the whole path would also resolve unrelated, pre-existing OS-level symlinks the caller
 *      never named — e.g. macOS aliases `/var` to `/private/var` — which would silently change
 *      an already-unambiguous, non-symlinked target path for no containment benefit).
 *   2. `dirArg` itself IS an existing symlink whose destination already exists — `fs.realpathSync`
 *      is authoritative here and handles nested symlinks / relative link targets in one call.
 *   3. `dirArg` itself IS an existing symlink whose destination does NOT exist yet (e.g. a
 *      dangling symlink at an `init` target) — `fs.realpathSync` cannot resolve this (it requires
 *      the final path to exist), so this falls back to one `readlinkSync` level, which is enough
 *      for the "symlink at the target" shape this containment guarantee covers.
 *
 * Architectural role:
 * Node-only filesystem utility with no host-specific input; hosts call it before deriving any path from a
 * directory argument.
 */

/**
 * Resolve `dirArg` to the real target path every subsequent write must be derived from.
 *
 * @complexity O(1) — at most one `lstatSync` plus one `realpathSync`/`readlinkSync` call, plus a
 *   constant number of `path` operations; not a function of any caller-controlled collection.
 */
export function resolveDirectoryTarget({ dirArg }: { dirArg: string }, _optional = {}): string {
  const lexicallyResolved = path.resolve(dirArg);

  let lst: fs.Stats;
  try {
    lst = fs.lstatSync(lexicallyResolved);
  } catch {
    // Doesn't exist at all — the common `init` case. Nothing to resolve beyond the lexical form.
    return lexicallyResolved;
  }

  if (!lst.isSymbolicLink()) {
    // An ordinary existing file/dir — return as-is, without canonicalizing unrelated ancestor
    // symlinks (see file header).
    return lexicallyResolved;
  }

  try {
    // The target IS a symlink whose destination exists — resolve it fully and authoritatively.
    return fs.realpathSync(lexicallyResolved);
  } catch {
    // A dangling symlink — its destination doesn't exist yet. Follow the link one level instead
    // of requiring the destination to already exist.
    const linkTarget = fs.readlinkSync(lexicallyResolved);
    return path.isAbsolute(linkTarget) ? linkTarget : path.resolve(path.dirname(lexicallyResolved), linkTarget);
  }
}
