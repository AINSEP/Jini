/**
 * @file Run a packaged-app gate against a COPY of the app in a fresh OS temp directory.
 *
 * Why: launched inside the checkout, a packaged app resolves a missing dependency from the checkout's
 * `node_modules` (Node walks up the directory tree), which hides a missing-peer bug from every gate.
 * The copy is made under a directory with no `node_modules` ancestor, the gate runs against it, and
 * the copy is always removed. The directory is a real path: a symlinked temp root (macOS
 * `/var` -> `/private/var`) would otherwise make an entry that runs only when its argv path equals
 * its own resolved URL exit 0 without doing anything.
 */
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A fixed, path-only diagnostic safe for a gate to print. */
export class PackagedTreeIsolationError extends Error {}

/** Throws when `directory` or any real (symlink-resolved) ancestor has a node_modules. */
export function assertPackagedTreeIsolation({ directory }: { directory: string }, _optional: Record<string, never> = {}): void {
  // Walks up until `dirname` stops changing (the filesystem root, which is checked too). The loop
  // ends on its own condition rather than an inner `return`, so it has no unreachable exit path.
  for (let dir = realpathSync(directory), previous = ''; dir !== previous; previous = dir, dir = path.dirname(dir)) {
    const modules = path.join(dir, 'node_modules');
    if (existsSync(modules)) throw new PackagedTreeIsolationError(`Packaged gate isolation refused: ${modules} exists above ${directory}`);
  }
}

export interface PackagedTreeTargets { readonly executablePath: string; readonly nodeModulesDir: string }

export interface IsolatedPackagedTreeRequired {
  readonly targets: PackagedTreeTargets;
  /** Gate body, run against the copied targets with the copy's parent directory as a safe cwd. */
  readonly run: (input: { targets: PackagedTreeTargets; directory: string }, optional?: Record<string, never>) => void | Promise<void>;
  /** Host path resolution for the copy command (`cp`); `null` when unavailable. Unused on win32. */
  readonly resolveCommand: (required: { bin: string }) => string | null;
}

export interface IsolatedPackagedTreeOptions {
  readonly tempRoot?: string;
  /** Selects the copier: `cpSync` on win32, `cp -R` elsewhere. */
  readonly platform?: NodeJS.Platform;
  readonly tempPrefix?: string;
}

function copyApp({ appRoot, copiedRoot, platform, resolveCommand }: { appRoot: string; copiedRoot: string; platform: NodeJS.Platform; resolveCommand: IsolatedPackagedTreeRequired['resolveCommand'] }): void {
  // Keep framework-relative symlinks as-is. Never ditto: ditto-copied apps have hung before dyld.
  if (platform === 'win32') { cpSync(appRoot, copiedRoot, { recursive: true, verbatimSymlinks: true }); return; }
  const command = resolveCommand({ bin: 'cp' });
  if (command === null) throw new Error('cp executable is unavailable.');
  execFileSync(command, ['-R', appRoot, copiedRoot], { stdio: 'pipe' });
}

/** Copy the whole app bundle (a macOS `.app` or a `win-unpacked` directory) into a fresh temp dir, run the gate against the copy, always remove it.
 * @example await withIsolatedPackagedTree({ targets, run, resolveCommand }, { tempPrefix: "acme-gate-" });
 * @throws PackagedTreeIsolationError when the temp root has a node_modules ancestor; copy and run errors propagate.
 * @complexity O(bundle size) for the copy.
 */
export async function withIsolatedPackagedTree(
  { targets, run, resolveCommand }: IsolatedPackagedTreeRequired,
  { tempRoot = tmpdir(), platform = process.platform, tempPrefix = 'packaged-gate-' }: IsolatedPackagedTreeOptions = {},
): Promise<void> {
  const directory = realpathSync(mkdtempSync(path.join(tempRoot, tempPrefix)));
  try {
    assertPackagedTreeIsolation({ directory });
    const executableDir = path.dirname(targets.executablePath);
    const appRoot = path.basename(executableDir) === 'MacOS' ? path.resolve(executableDir, '../..') : executableDir;
    const copiedRoot = path.join(directory, path.basename(appRoot));
    copyApp({ appRoot, copiedRoot, platform, resolveCommand });
    await run({
      targets: {
        executablePath: path.join(copiedRoot, path.relative(appRoot, targets.executablePath)),
        nodeModulesDir: path.join(copiedRoot, path.relative(appRoot, targets.nodeModulesDir)),
      },
      directory,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
