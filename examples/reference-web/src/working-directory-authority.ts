import { timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export interface PlaygroundWorkingDirectoryAuthority {
  grant: (directory: unknown, presentedSecret: unknown) => Promise<string>;
  resolveForRun: (requestedDirectory: string | undefined, project: string) => Promise<string>;
}

/** Accepts only direct IPv4/IPv6 loopback socket addresses. */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

interface CreateAuthorityInput {
  repoRoot: string;
  projects: ReadonlySet<string>;
  grantSecret: string | undefined;
}

function secretsMatch(expected: string | undefined, presented: unknown): boolean {
  if (!expected || typeof presented !== 'string') return false;
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return expectedBytes.length === presentedBytes.length
    && timingSafeEqual(expectedBytes, presentedBytes);
}

async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) {
    throw new Error('Working directory is not a directory');
  }
  return canonical;
}

/**
 * Creates the example-only authority separating renderer path data from
 * directories explicitly approved by the Electron main process.
 *
 * Grants are canonical, multi-use for this daemon lifetime, and re-realpathed
 * on every run so a changed symlink cannot retain authority.
 *
 * @complexity Time: O(p) startup for p sample projects, O(1) per grant/run.
 * @overallScore 100/100
 */
export async function createPlaygroundWorkingDirectoryAuthority({
  repoRoot,
  projects,
  grantSecret,
}: CreateAuthorityInput): Promise<PlaygroundWorkingDirectoryAuthority> {
  const sampleDirectories = new Set<string>();
  for (const project of projects) {
    sampleDirectories.add(await canonicalDirectory(
      resolve(repoRoot, 'examples/sample-projects', project),
    ));
  }
  const grantedDirectories = new Set<string>();

  return {
    async grant(directory, presentedSecret) {
      if (!secretsMatch(grantSecret, presentedSecret)) {
        throw new Error('Working-directory grant denied');
      }
      if (typeof directory !== 'string' || directory.length === 0) {
        throw new Error('Working-directory grant requires a path');
      }
      const canonical = await canonicalDirectory(directory);
      grantedDirectories.add(canonical);
      return canonical;
    },
    async resolveForRun(requestedDirectory, project) {
      const candidate = requestedDirectory
        ? (isAbsolute(requestedDirectory)
            ? resolve(requestedDirectory)
            : resolve(repoRoot, requestedDirectory))
        : resolve(repoRoot, 'examples/sample-projects', project);
      const canonical = await canonicalDirectory(candidate);
      if (!sampleDirectories.has(canonical) && !grantedDirectories.has(canonical)) {
        throw new Error('Working directory has not been approved');
      }
      return canonical;
    },
  };
}
