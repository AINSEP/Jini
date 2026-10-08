/**
 * @file The one path-safety primitive every Agent Plugin package read goes through — extraction
 * (`install.ts`) today, any future preview/read path tomorrow. One implementation, not two, so the
 * containment guarantee cannot drift between "how a package is written" and "how it is later read".
 *
 * The rule is not invented here. The Agent Plugins spec (v1.0.0, "Path safety") states it as a MUST:
 * "the filesystem-resolved path MUST remain within the filesystem-resolved plugin root... symlinks,
 * junctions, reparse points, and equivalent filesystem mechanisms MAY resolve to targets within the
 * plugin root, but clients MUST reject package paths that resolve outside it." The word
 * "filesystem-resolved" is exactly what a lexical `../`-string check alone does not satisfy — a
 * hostile archive can plant a symlinked directory at a lexically-clean path and let a later,
 * innocent-looking entry walk through it (the two-step zip-slip vector; see `install.ts`'s header
 * for the extraction-time mitigation, which is to refuse symlink ENTRIES outright rather than ever
 * relying on this function to catch one after the fact).
 *
 * Architectural role:
 * Pure path logic plus the minimum filesystem calls (`realpath`) the spec's own wording requires.
 * No policy about what happens after containment is established — that is every caller's own job.
 */
/** Extracted from the host plugin lifecycle. Effects are supplied per host context. */
import path from "node:path";
import type { AgentPluginLifecyclePorts } from "./ports.js";

/** Raised for any path a package entry (or a later read against an already-installed package) is
 * not allowed to reach — lexically invalid, or resolving outside the package root. */
export class PackagePathViolation extends Error {
  constructor({ message }: { readonly message: string }, optional: ErrorOptions = {}) { super(message, optional); }
}

function buildModule(ports: AgentPluginLifecyclePorts) {
  const realpath = ports.filesystem.realpath.bind(ports.filesystem);
  /**
 * Rejects an absolute path, a NUL byte, a Windows drive prefix, or a lexical `..`/`.` segment —
 * BEFORE any filesystem call. This is the cheap majority of attempts; {@link assertContainedOnDisk}
 * catches the rest (an entry that is lexically clean but is, or passes through, a symlink).
 *
 * Backslashes are normalized to `/` rather than rejected: the spec models paths as POSIX-style
 * (`./`-prefixed), and an archive built on Windows may use them as its own separator without any
 * hostile intent — the traversal segments that actually matter (`..`, an absolute prefix) are
 * checked after normalization either way.
 *
 * @throws {PackagePathViolation} If the path is unsafe by construction, independent of any
 * filesystem state.
 * @complexity O(n) in the path's own length.
 */
  function normalizePackageEntryPath(rawEntryPath: string): string {
    if (rawEntryPath.includes("\0")) {
      throw new PackagePathViolation({ message: `package entry path contains a NUL byte: '${rawEntryPath}'` });
    }

    const portable = rawEntryPath.replaceAll("\\", "/");

    if (path.posix.isAbsolute(portable) || /^[a-zA-Z]:/.test(portable)) {
      throw new PackagePathViolation({ message: `package entry path must be relative: '${rawEntryPath}'` });
    }

    const normalized = path.posix.normalize(portable);
    if (normalized === ".." || normalized.startsWith("../") || normalized === "." || normalized === "") {
      throw new PackagePathViolation({ message: `package entry path escapes the package root: '${rawEntryPath}'` });
    }

    return normalized;
  }

  /**
 * Resolves `entryPath` against `packageRoot` and asserts the REAL, symlink-resolved result is still
 * inside the REAL, symlink-resolved root — the spec's "filesystem-resolved" requirement, not a
 * string comparison.
 *
 * `packageRoot` is `realpath`'d fresh on every call rather than accepted pre-resolved from the
 * caller, so a root whose own directory entry is later replaced by a symlink between two calls
 * cannot smuggle a stale trusted root in.
 *
 * Handles the case extraction needs and a plain read doesn't: the target may not exist yet (mid-
 * extraction, before this entry's own write), in which case the deepest EXISTING ancestor is
 * `realpath`'d instead — so a symlinked PARENT directory planted by an earlier archive entry is
 * still caught even though the leaf hasn't been created yet.
 *
 * @param packageRoot - Absolute path to the package root (extraction destination, or an already-
 * installed package's root).
 * @param entryPath - A package-relative path, as found in an archive entry name or a caller's own
 * read request. Lexically validated internally via {@link normalizePackageEntryPath}.
 * @returns The resolved (lexical, not yet realpath'd) absolute destination — safe for the caller to
 * `open`/`mkdir`/`stat` against.
 * @throws {PackagePathViolation} If the path is lexically unsafe, or the filesystem-resolved result
 * (direct or via a symlinked ancestor) falls outside `packageRoot`.
 * @complexity O(d) in path depth — one `realpath` per unresolved ancestor in the worst case.
 */
  async function assertContainedOnDisk(packageRoot: string, entryPath: string): Promise<string> {
    const normalized = normalizePackageEntryPath(entryPath);
    const realRoot = await realpath(packageRoot);
    const lexicalCandidate = path.resolve(realRoot, normalized);

    if (!isWithin(realRoot, lexicalCandidate)) {
      throw new PackagePathViolation({ message: `package entry resolves outside the package root: '${entryPath}'` });
    }

    let realCandidate: string;
    try {
      realCandidate = await realpath(lexicalCandidate);
    } catch {
      realCandidate = await realpathDeepestExistingAncestor(lexicalCandidate);
    }

    if (!isWithin(realRoot, realCandidate)) {
      throw new PackagePathViolation({ message: `package entry resolves outside the package root via a symlink: '${entryPath}'` });
    }

    return lexicalCandidate;
  }

  function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  }

  /** Walks up from `candidate` until an existing ancestor is found, `realpath`s that ancestor, and
 * reattaches the non-existent tail — so a symlinked ancestor is caught even for a path whose leaf
 * (and possibly several parent segments) have not been created yet. */
  async function realpathDeepestExistingAncestor(candidate: string): Promise<string> {
    let current = path.dirname(candidate);
    const tail: string[] = [path.basename(candidate)];

    for (;;) {
      try {
        const real = await realpath(current);
        return path.join(real, ...tail);
      } catch {
        const parent = path.dirname(current);
        if (parent === current) return path.join(current, ...tail); // reached the filesystem root
        tail.unshift(path.basename(current));
        current = parent;
      }
    }
  }

  return { normalizePackageEntryPath, assertContainedOnDisk };
}

const instances = new WeakMap<AgentPluginLifecyclePorts, ReturnType<typeof buildModule>>();
/** Internal composition; one state/queue instance per injected host context. */
export function createPackagePathsModule(ports: AgentPluginLifecyclePorts) {
  let instance = instances.get(ports);
  if (!instance) { instance = buildModule(ports); instances.set(ports, instance); }
  return instance;
}
