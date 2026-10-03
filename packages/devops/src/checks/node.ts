import { execFile } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EnvLoaderPort } from '../local-dev/index.js';
import type { FilesystemPort, PackageInstallerPort, ProcessRunnerPort } from './ports.js';

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
    copyDirectory: ({ source, destination }) => { cpSync(source, destination, { recursive: true, force: false, errorOnExist: true }); },
    removeDirectory: ({ path: dir }) => { rmSync(dir, { recursive: true, force: true }); },
  };
}

/** Uses Node's environment precedence: exported variables win over file values. Requires Node 20.12+. */
export function createNodeEnvLoader(_args: Record<string, never>): EnvLoaderPort {
  return { load: ({ path: file }) => { process.loadEnvFile(file); } };
}

/** Shell-free runner; captures compiler output and reports signals/spawn failures as null exits. */
export function createNodeProcessRunner(_args: Record<string, never>, { maxBuffer = 32 * 1024 * 1024, timeoutMs = 300_000 }: {
  maxBuffer?: number; timeoutMs?: number;
} = {}): ProcessRunnerPort {
  return {
    run: ({ command, args, cwd }) => new Promise((resolve) => {
      execFile(command, [...args], { cwd, encoding: 'utf8', maxBuffer, timeout: timeoutMs }, (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === 'number' ? error.code : null) : 0;
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
