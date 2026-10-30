import { execFile, type ExecFileException } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EnvLoaderPort } from '../local-dev/index.js';
import type { FilesystemPort, PackageInstallerPort, ProcessRunnerPort } from './ports.js';

// Parser is supplied by the caller, so this Node entry keeps TypeScript an optional peer.
export { createHardwiringInspector, diffHardwiringDebt, HARDWIRING_RULES } from './hardwiring.js';
export { sourceFiles, createResolver, displayGraphFile, installedPublicFunctions, runHardwiring } from './hardwiring-node.js';
export type { HardwiringSource, HardwiringViolation } from './hardwiring.js';

/** Explicit Node filesystem adapter. Temporary parents must already exist. */
export function createNodeFilesystem(_args: Record<string, never>): FilesystemPort {
  return {
    exists: ({ path: file }) => existsSync(file),
    isSymbolicLink: ({ path: file }) => lstatSync(file).isSymbolicLink(),
    readText: ({ path: file }) => readFileSync(file, 'utf8'),
    readDirectory: ({ path: dir }) => readdirSync(dir),
    writeText: ({ path: file, text }) => { writeFileSync(file, text); },
    createTempDirectory: ({ parent, prefix }) => mkdtempSync(path.join(parent, prefix)),
    createDirectory: ({ path: dir }) => { mkdirSync(dir); },
    ensureDirectory: ({ path: dir }) => { mkdirSync(dir, { recursive: true }); },
    copyDirectory: ({ source, destination }) => {
      // MOVE: The caller owns the reserved root; exclusive copy still protects every entry inside it.
      for (const entry of readdirSync(source)) {
        cpSync(path.join(source, entry), path.join(destination, entry), { recursive: true, force: false, errorOnExist: true });
      }
    },
    removeDirectory: ({ path: dir }) => { rmSync(dir, { recursive: true, force: true }); },
  };
}

/** Uses Node's environment precedence: exported variables win over file values. Requires Node 20.12+. */
export function createNodeEnvLoader(_args: Record<string, never>): EnvLoaderPort {
  return { load: ({ path: file }) => { process.loadEnvFile(file); } };
}

/** Shell-free runner; captures compiler output and reports signals/spawn failures as null exits. */
/** 0 on success, the child's numeric exit status on failure, or null when it never exited normally. */
function processExitCode(error: ExecFileException | null): number | null {
  if (!error) return 0;
  return typeof error.code === 'number' ? error.code : null;
}

export function createNodeProcessRunner(_args: Record<string, never>, { maxBuffer = 32 * 1024 * 1024, timeoutMs = 300_000 }: {
  maxBuffer?: number; timeoutMs?: number;
} = {}): ProcessRunnerPort {
  return {
    run: ({ command, args, cwd }) => new Promise((resolve) => {
      execFile(command, [...args], { cwd, encoding: 'utf8', maxBuffer, timeout: timeoutMs }, (error, stdout, stderr) => {
        const exitCode = processExitCode(error);
        resolve({ exitCode, stdout, stderr: stderr || error?.message || '' });
      });
    }),
  };
}

/** Optional npm executable adapter. The caller explicitly selects the executable and runner. */
export function createNpmInstaller({ runner, command }: { runner: ProcessRunnerPort; command: string }, { args = [
  'install', '--no-audit', '--no-fund', '--no-package-lock', '--workspaces=false', '--ignore-scripts',
] }: { args?: readonly string[] } = {}): PackageInstallerPort {
  return { install: ({ directory }) => runner.run({ command, args, cwd: directory }) };
}
