/**
 * Attachment staging — a generic "temp-store a local file before it's
 * submitted to a remote generation request" port. Generalized from Open
 * Design's `apps/daemon/src/media/amr-image-staging.ts`. Despite the
 * origin's AMR/vela-vendor-specific filename and its narrow "image paths for
 * an agent turn" framing, its actual logic carries zero OD/vendor coupling —
 * root-containment checks, copy-into-a-staging-dir, and TTL-based pruning
 * are all generic filesystem concerns. Ported as a real, testable port +
 * reference implementation (not just an interface) per the task brief,
 * mirroring this package's other port/in-memory-or-fs-reference pairs.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface AttachmentStagingOptions {
  /** Directory name created under `cwd` to hold staged copies. Defaults to `.media-attachments`. Must be a single safe path component (no separators, no `..`). */
  readonly stagingDirName?: string;
  /** Max age (ms) a staged file is retained before opportunistic pruning removes it. Defaults to 24h. */
  readonly maxAgeMs?: number;
  /** Max number of paths accepted per `stage()` call. Defaults to 50. */
  readonly maxItems?: number;
  /** Max bytes copied for a single staged file. Defaults to 100 MiB. */
  readonly maxBytesPerFile?: number;
}

/**
 * Stages a host-supplied list of local file paths for submission: a path
 * already inside `cwd` is used as-is; a path outside `cwd` is copied into a
 * `.media-attachments`-style staging directory under `cwd` with a random
 * prefix, avoiding collisions and leaving the original untouched, but ONLY
 * when it also resolves inside the caller-supplied `uploadRoot` — copying a
 * file from outside `cwd` with no `uploadRoot` (or an `uploadRoot` that
 * fails to resolve) throws rather than silently disabling the containment
 * check, since that would let a caller stage an arbitrary host-readable file
 * (SEC-RB-003). Malformed or missing paths are silently skipped —
 * attachments are advisory input, not a validated contract. Opportunistically
 * prunes staged files older than `maxAgeMs` on each call.
 */
export interface AttachmentStaging {
  stage(imagePaths: readonly string[], uploadRoot?: string | null): Promise<string[]>;
}

const DEFAULT_STAGING_DIRNAME = '.media-attachments';
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_MAX_BYTES_PER_FILE = 100 * 1024 * 1024;

function isWithinRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function assertSafeStagingDirName(stagingDirName: string): void {
  if (
    stagingDirName.length === 0 ||
    path.isAbsolute(stagingDirName) ||
    stagingDirName === '.' ||
    stagingDirName === '..' ||
    stagingDirName.includes('/') ||
    stagingDirName.includes('\\')
  ) {
    throw new Error(`attachment staging: stagingDirName must be a single safe path component, got ${JSON.stringify(stagingDirName)}`);
  }
}

async function pruneStagedAttachments(stagingDir: string, maxAgeMs: number): Promise<void> {
  let entries;
  try {
    entries = await fs.promises.readdir(stagingDir, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const filePath = path.join(stagingDir, entry.name);
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.rm(filePath, { force: true });
        }
      } catch {
        // Best-effort cleanup only.
      }
    }),
  );
}

/** Creates a filesystem-backed `AttachmentStaging` rooted at `cwd`. */
export function createFsAttachmentStaging(cwd: string, options: AttachmentStagingOptions = {}): AttachmentStaging {
  const stagingDirName = options.stagingDirName ?? DEFAULT_STAGING_DIRNAME;
  assertSafeStagingDirName(stagingDirName);
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxBytesPerFile = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
  const root = path.resolve(cwd);
  const stagingDir = path.join(root, stagingDirName);

  return {
    async stage(imagePaths: readonly string[], uploadRoot?: string | null): Promise<string[]> {
      if (!Array.isArray(imagePaths) || imagePaths.length === 0) return [];
      if (imagePaths.length > maxItems) {
        throw new Error(`attachment staging: ${imagePaths.length} paths exceeds the ${maxItems}-item limit`);
      }
      // Fail closed, not open: an explicitly-supplied uploadRoot that doesn't
      // resolve is a caller configuration error, not an "unrestricted" signal
      // (SEC-RB-003 — the prior behavior collapsed "no uploadRoot" and
      // "unresolvable uploadRoot" into the same no-restriction case, letting
      // any host-readable file be staged when uploadRoot merely failed to
      // resolve). Omitting uploadRoot entirely is still allowed, but then only
      // paths already inside `cwd` can be staged — nothing outside `cwd` can
      // be copied in without a resolvable uploadRoot to authorize it.
      let uploadRootReal: string | null = null;
      if (uploadRoot != null) {
        try {
          uploadRootReal = await fs.promises.realpath(uploadRoot);
        } catch (error) {
          throw new Error(`attachment staging: uploadRoot ${JSON.stringify(uploadRoot)} could not be resolved: ${(error as Error).message}`);
        }
      }
      await fs.promises.mkdir(stagingDir, { recursive: true });
      // The staging directory is a destination this component writes into
      // and later prunes/deletes from — refuse to operate through a symlink
      // here, since a pre-planted symlink would redirect writes/deletes
      // outside `root` (SEC-RB-003).
      const stagingDirLstat = await fs.promises.lstat(stagingDir);
      if (stagingDirLstat.isSymbolicLink()) {
        throw new Error(`attachment staging: staging directory ${stagingDir} is a symlink, refusing to use it`);
      }
      await pruneStagedAttachments(stagingDir, maxAgeMs);
      // `root` is guaranteed to exist at this point (the recursive mkdir above
      // created it if it didn't already). Resolve its real path once so the
      // "already inside cwd" check below compares like-for-like against
      // `real` (itself always realpath'd) — comparing a realpath'd candidate
      // against a raw `root` misfires whenever `cwd` sits under a symlinked
      // prefix (e.g. macOS's /tmp -> /private/tmp, /var -> /private/var),
      // causing an unnecessary copy instead of returning the path as-is.
      const rootReal = await fs.promises.realpath(root).catch(() => root);

      const staged: string[] = [];
      for (const inputPath of imagePaths) {
        if (typeof inputPath !== 'string' || inputPath.trim().length === 0) continue;
        try {
          const resolved = path.resolve(inputPath);
          const real = await fs.promises.realpath(resolved);
          const stat = await fs.promises.stat(real);
          if (!stat.isFile()) continue;
          if (isWithinRoot(rootReal, real)) {
            staged.push(real);
            continue;
          }
          // Outside cwd: this is the "copy an external file into staging"
          // path, which requires an authorized uploadRoot — deny by default.
          if (uploadRootReal == null || !isWithinRoot(uploadRootReal, real)) continue;
          if (stat.size > maxBytesPerFile) continue;
          const basename = path.basename(real);
          const destination = path.join(stagingDir, `${randomUUID()}-${basename}`);
          await fs.promises.copyFile(real, destination);
          staged.push(destination);
        } catch {
          // Ignore malformed or missing files; attachments are advisory input.
        }
      }
      return staged;
    },
  };
}
