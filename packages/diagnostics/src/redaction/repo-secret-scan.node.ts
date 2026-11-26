import path from "node:path";
import { scanTrackedRepo, scanRepoHistory, type SecretScanViolation } from "./repo-secret-scan.js";

function listTrackedFiles({ repoRoot, runner }: { repoRoot: string; runner: Parameters<typeof scanRepoForSecrets>[0]["runner"] }, _optional: Record<string, never> = {}): string[] {
  const out = runner(["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

/** One tracked file's (or historical blob's) already-read, latin1-decoded content, ready to scan. */
interface ScannableContent {
  readonly text: string;
  readonly isBinary: boolean;
}

/** Reads one tracked file's content for scanning, or `null` if it should be skipped: a skipped
 *  binary-media extension, missing from disk (e.g. removed locally but not yet staged as
 *  deleted), not a regular file, or over the size cap (see file header). */
function readScannableFile({ repoRoot, relFile, fs, maxScanBytes }: { repoRoot: string; relFile: string; fs: Parameters<typeof scanRepoForSecrets>[0]["fs"]; maxScanBytes: number }, _optional: Record<string, never> = {}): ScannableContent | null {
  const absFile = path.join(repoRoot, relFile);
  let stat: ReturnType<Parameters<typeof scanRepoForSecrets>[0]["fs"]["statSync"]>;
  try {
    stat = fs.statSync(absFile);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > maxScanBytes) return null;

  const buf = fs.readFileSync(absFile);
  return { text: buf.toString("latin1"), isBinary: buf.subarray(0, 8000).includes(0) };
}

/** Real-repo scan: every tracked file (per `git ls-files`), latin1-decoded so binary content is
 *  scanned byte-for-byte alongside text (see file header). */
export function scanRepoForSecrets({ repoRoot, runner, fs, policy }: {
  repoRoot: string;
  runner: (args: readonly string[], options: { cwd: string; encoding: "utf8" | "latin1"; input?: string; maxBuffer?: number }) => string;
  fs: { statSync(file: string): { size: number; isFile(): boolean }; readFileSync(file: string): Buffer };
  policy: Parameters<typeof scanTrackedRepo>[0]["policy"];
}, _optional: Record<string, never> = {}): SecretScanViolation[] {
  return scanTrackedRepo({
    ports: {
      trackedPaths: () => listTrackedFiles({ repoRoot, runner }),
      readTracked: ({ file }) => readScannableFile({ repoRoot, relFile: file, fs, maxScanBytes: policy.maxScanBytes }),
    },
    policy,
  });
}

interface HistoricalBlob {
  readonly sha: string;
  /** Repo-root-relative path this blob was found under (its first-seen path — a blob can appear
   *  under multiple paths/commits; content, not path, is what's deduped on). */
  readonly path: string;
}

/** Every blob object reachable from any local branch or tag, deduped by blob SHA (a content hash,
 *  so identical file content is scanned exactly once regardless of how many commits or paths
 *  reference it). See file header's History scanning section. */
/** Parses `git rev-list --objects --all` output into a sha -> first-seen-path map. Commit objects
 *  (listed with no path suffix) are skipped; only the first path seen per sha is kept (content,
 *  not path, is what {@link listHistoricalBlobs} dedupes on). */
function parseObjectPaths({ objectsOut }: { objectsOut: string }, _optional = {}): Map<string, string> {
  const pathBySha = new Map<string, string>();
  for (const line of objectsOut.split("\n")) {
    const spaceIdx = line.indexOf(" ");
    if (spaceIdx === -1) continue; // commit objects are listed with no path suffix
    const sha = line.slice(0, spaceIdx);
    const relPath = line.slice(spaceIdx + 1);
    if (relPath && !pathBySha.has(sha)) pathBySha.set(sha, relPath);
  }
  return pathBySha;
}

/** Parses `git cat-file --batch-check` output, keeping only blob objects — `rev-list --objects`
 *  also lists tree objects (which carry a path but aren't scannable file content). */
function filterBlobShas(
  { typeCheckOut, pathBySha }: { typeCheckOut: string; pathBySha: ReadonlyMap<string, string> },
  _optional = {}
): HistoricalBlob[] {
  const blobs: HistoricalBlob[] = [];
  for (const line of typeCheckOut.split("\n")) {
    if (!line) continue;
    const [sha, type] = line.split(" ");
    if (type === "blob" && sha !== undefined) {
      const path = pathBySha.get(sha);
      if (path === undefined) throw new Error(`Historical blob ${sha} has no source path`);
      blobs.push({ sha, path });
    }
  }
  return blobs;
}

function listHistoricalBlobs({ repoRoot, runner }: { repoRoot: string; runner: Parameters<typeof scanRepoForSecrets>[0]["runner"] }, _optional = {}): HistoricalBlob[] {
  const objectsOut = runner(["rev-list", "--objects", "--all"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  const pathBySha = parseObjectPaths({ objectsOut });
  if (pathBySha.size === 0) return [];

  const shas = [...pathBySha.keys()];
  const typeCheckOut = runner(["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
    cwd: repoRoot,
    input: shas.join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  return filterBlobShas({ typeCheckOut, pathBySha });
}

/** Reads every listed blob's content in one `git cat-file --batch` pass, latin1-decoded (same
 *  binary-preserving technique `scanRepoForSecrets` uses; see file header). Keyed by blob SHA. */
function readBlobContents(
  { repoRoot, shas, runner }: { repoRoot: string; shas: readonly string[]; runner: Parameters<typeof scanRepoForSecrets>[0]["runner"] },
  _optional = {}
): Map<string, string> {
  const contents = new Map<string, string>();
  if (shas.length === 0) return contents;

  const out = runner(["cat-file", "--batch"], {
    cwd: repoRoot,
    input: shas.join("\n") + "\n",
    encoding: "latin1",
    maxBuffer: 512 * 1024 * 1024,
  });

  let offset = 0;
  while (offset < out.length) {
    const headerEnd = out.indexOf("\n", offset);
    if (headerEnd === -1) break;
    const [sha, , sizeStr] = out.slice(offset, headerEnd).split(" ");
    // Malformed/unexpected batch records stop the scan rather than misparse.
    if (sha === undefined || sizeStr === undefined) return contents;
    const size = Number(sizeStr);
    const contentStart = headerEnd + 1;
    contents.set(sha, out.slice(contentStart, contentStart + size));
    offset = contentStart + size + 1; // +1 for the trailing newline git appends after each record
  }
  return contents;
}

/** Every distinct path any commit on any local branch/tag ever added or changed (merges included),
 *  sorted. Blob dedupe keys on content, so a credential-named file sharing its blob with another
 *  file never reaches the blob list under its own name; paths are listed separately. */
function listHistoricalPaths({ repoRoot, runner }: { repoRoot: string; runner: Parameters<typeof scanRepoForSecrets>[0]["runner"] }, _optional: Record<string, never> = {}): string[] {
  const out = runner(["log", "--all", "-m", "--no-renames", "--format=", "--name-only", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return [...new Set(out.split("\0").map((entry) => entry.replace(/^\n+/, "")).filter(Boolean))].sort();
}

/** History scan: every blob ever committed to any local branch/tag, not just the current tip.
 *  Closes the gap where a secret committed then removed in a later commit is still fully
 *  recoverable from `git log`/`git show` while `scanRepoForSecrets` (tip-only) reports clean.
 *  `repoRoot` defaults to this repo but is overridable so tests can point it at a throwaway repo
 *  instead of mutating real history. */
export function scanGitHistoryForSecrets({ repoRoot, runner, policy }: Parameters<typeof scanRepoForSecrets>[0], _optional: Record<string, never> = {}): SecretScanViolation[] {
  return scanRepoHistory({
    ports: {
      historicalPaths: () => listHistoricalPaths({ repoRoot, runner }),
      historicalBlobs: () => listHistoricalBlobs({ repoRoot, runner }),
      readBlobContents: ({ shas }) => readBlobContents({ repoRoot, shas, runner }),
    },
    policy,
  });
}
