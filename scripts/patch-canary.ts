/**
 * Patch canary — milestone 1 gate O (foundry/docs/jini-port/extraction-plan.md §4.3, §8 task 1).
 *
 * OD stays a consumer synced via `git format-patch` (locked decision #4). This harness proves
 * an upstream OD daemon patch still applies once its paths are rewritten onto this repo's
 * mirrored layout (`apps/daemon/...` -> `foundry/integrations/open-design/daemon/...`), and is the
 * mechanical piece a future CI gate can build on top of: run this against an incoming upstream
 * patch, and cross-check every touched path against `sync-ownership.manifest.json` to fail CI
 * on any `delegated-to-jini` path whose `@injini/*` counterpart hasn't also been fixed.
 *
 * Two surfaces:
 *   1. `transformUpstreamPath(path)` — a pure function, importable by tests/tooling.
 *   2. A CLI: `tsx scripts/patch-canary.ts --patch <file> --repo <dir>` — rewrites every path in
 *      the patch file, applies it to `<repo>` via `git apply`, and prints `PATCH_CANARY_OK` on
 *      success.
 *
 * See `foundry/integrations/open-design/sync-ownership.test.ts` for the exact, authoritative spec this
 * file must satisfy.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const UPSTREAM_DAEMON_PREFIX = 'apps/daemon';
const MIRRORED_DAEMON_PREFIX = 'foundry/integrations/open-design/daemon';

/**
 * Rewrites an upstream OD path onto this repo's mirrored `foundry/integrations/open-design/daemon/`
 * layout, e.g. `apps/daemon/src/routes/health.ts` -> `foundry/integrations/open-design/daemon/src/routes/health.ts`.
 * Paths outside `apps/daemon/` are returned unchanged (not every upstream patch is daemon-scoped).
 */
export function transformUpstreamPath(upstreamPath: string): string {
  if (upstreamPath === UPSTREAM_DAEMON_PREFIX) {
    return MIRRORED_DAEMON_PREFIX;
  }
  if (upstreamPath.startsWith(`${UPSTREAM_DAEMON_PREFIX}/`)) {
    return MIRRORED_DAEMON_PREFIX + upstreamPath.slice(UPSTREAM_DAEMON_PREFIX.length);
  }
  return upstreamPath;
}

/**
 * Rewrites the path(s) on a single line of a unified diff, if that line carries one of the
 * three path-bearing prefixes a `git format-patch` output uses: `diff --git a/<path> b/<path>`,
 * `--- a/<path>` (or `--- /dev/null` for a new file, left untouched), and `+++ b/<path>` (or
 * `+++ /dev/null` for a deleted file, left untouched).
 */
function transformPatchLine(line: string): string {
  const diffGitMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
  if (diffGitMatch) {
    const [, aPath, bPath] = diffGitMatch;
    return `diff --git a/${transformUpstreamPath(aPath!)} b/${transformUpstreamPath(bPath!)}`;
  }

  const minusMatch = line.match(/^--- a\/(.+)$/);
  if (minusMatch) {
    return `--- a/${transformUpstreamPath(minusMatch[1]!)}`;
  }

  const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
  if (plusMatch) {
    return `+++ b/${transformUpstreamPath(plusMatch[1]!)}`;
  }

  return line;
}

/** Rewrites every path-bearing line of a full patch file's contents. */
export function transformPatchContents(patchContents: string): string {
  return patchContents.split('\n').map(transformPatchLine).join('\n');
}

interface CliArgs {
  patch: string;
  repo: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  let patch: string | undefined;
  let repo: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--patch') {
      patch = argv[++i];
    } else if (argv[i] === '--repo') {
      repo = argv[++i];
    }
  }
  if (!patch || !repo) {
    throw new Error('Usage: tsx scripts/patch-canary.ts --patch <patchFile> --repo <repoDir>');
  }
  return { patch, repo };
}

function runCli(argv: readonly string[]): void {
  const { patch, repo } = parseCliArgs(argv);

  const originalPatch = readFileSync(patch, 'utf8');
  const transformedPatch = transformPatchContents(originalPatch);

  const scratchDir = mkdtempSync(path.join(tmpdir(), 'jini-patch-canary-transformed-'));
  const transformedPatchPath = path.join(scratchDir, path.basename(patch));
  writeFileSync(transformedPatchPath, transformedPatch);

  try {
    execFileSync('git', ['apply', transformedPatchPath], { cwd: repo, stdio: 'pipe' });
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }

  console.log('PATCH_CANARY_OK');
}

const isMainModule =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  runCli(process.argv.slice(2));
}
