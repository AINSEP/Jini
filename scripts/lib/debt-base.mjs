/** The one reader of a debt file at the trusted base commit, shared by the debt ratchets so editing
 * the JSON in the same change can never raise an allowance. A zero base (the first push of a new
 * branch) falls back to the parent of the push's first commit. Plain JS with a .d.mts so the .mjs
 * ratchets and the TypeScript guard both import it.
 */
import { spawnSync } from 'node:child_process';

function git({ root, args }) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

/**
 * The trusted base commit, resolved once per call (a zero ref falls back as described above).
 * @param {{ root: string }} required Repository root.
 * @param {{ baseRef?: string; firstCommit?: string }} [optional] Trusted base (default HEAD).
 * @returns {string} The base commit SHA.
 * @throws {Error} When the base cannot be resolved: the ratchet fails closed.
 */
export function baseCommit({ root }, { baseRef = 'HEAD', firstCommit = '' } = {}) {
  let ref = baseRef || 'HEAD';
  if (/^0+$/.test(ref)) ref = firstCommit ? `${firstCommit}^` : 'HEAD^';
  const commit = git({ root, args: ['rev-parse', '--verify', `${ref}^{commit}`] });
  if (commit.status !== 0) throw new Error(`Cannot resolve debt base ${ref}: ${commit.stderr.trim()}`);
  return commit.stdout.trim();
}

/**
 * One file's text at a commit, or undefined when the commit has no such file. Used to read the base
 * tree's public exports for the approved-runtime check (Gate C1).
 * @param {{ root: string; commit: string; file: string }} required Repository root, commit and repo-relative path.
 * @returns {string | undefined}
 */
export function fileAtCommit({ root, commit, file }) {
  const show = git({ root, args: ['show', `${commit}:${file}`] });
  return show.status === 0 ? show.stdout : undefined;
}

/**
 * @param {{ root: string; file: string }} required Repository root and the debt file relative to it.
 * @param {{ baseRef?: string; firstCommit?: string }} [optional] Trusted base (default HEAD).
 * @returns {unknown} The parsed JSON at the base, or null when the base has no such file yet.
 * @throws {Error} When the base cannot be resolved or read: the ratchet fails closed.
 */
export function debtAtBase({ root, file }, optional = {}) {
  const commit = baseCommit({ root }, optional);
  const listing = git({ root, args: ['ls-tree', '-r', '--name-only', commit, '--', file] });
  if (listing.status !== 0) throw new Error(`Cannot inspect debt base: ${listing.stderr.trim()}`);
  if (!listing.stdout.trim()) return null; // Initial adoption creates the first baseline.
  const text = fileAtCommit({ root, commit, file });
  if (text === undefined) throw new Error(`Cannot read debt base ${commit}:${file}`);
  return JSON.parse(text);
}
