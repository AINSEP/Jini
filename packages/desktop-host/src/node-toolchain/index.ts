
export interface ToolchainFilesystemPort {
  mkdirSync(requiredArgs: { path: string }, optionalArgs?: { recursive?: boolean; mode?: number }): unknown;
  chmodSync(requiredArgs: { path: string; mode: number }): void;
  writeFileSync(requiredArgs: { path: string; data: string }, optionalArgs?: { mode?: number }): void;
  renameSync(requiredArgs: { oldPath: string; newPath: string }): void;
  unlinkSync(requiredArgs: { path: string }): void;
}
export interface NodeToolchainPaths {
  toolchainDir: string;
  binDir: string;
  npmCacheDir: string;
  npmPrefixDir: string;
}
export interface BuildNodeToolchainShimsInput {
  electronPath: string;
  npmRoot: string;
  platform: NodeJS.Platform;
  /** A single shell comment line, including its leading #. Host wording is never defaulted. */
  generatedComment: string;
  joinPath: (args: { parts: string[] }) => string;
}
export interface WriteNodeToolchainInput extends BuildNodeToolchainShimsInput {
  paths: NodeToolchainPaths;
  filesystem: ToolchainFilesystemPort;
  writerPid: number;
  isTransientPath: (args: { executablePath: string }) => boolean;
  launcherNamesDurableInstall: (args: { launcherPath: string }) => boolean;
}
export interface BuildNodeToolchainEnvInput {
  toolchainDir: string;
  npmRoot: string;
  toolchainEnvName: string;
  npmRootEnvName: string;
}

/** Reject batch metacharacters without echoing the untrusted value. @complexity O(n) in value length. */
export function assertCmdQuotable({ value, field }: { value: unknown; field: string }): string {
  // Double quotes do not stop cmd.exe expansion: % expands variables, a quote ends the literal,
  // ^ escapes, and & chains commands. Refuse metacharacters instead of attempting unsafe quoting.
  if (typeof value !== 'string' || value === '') throw new Error(`node-toolchain: ${field} must be a non-empty string.`);
  if (/[%"^&|<>!\r\n]/.test(value)) throw new Error(`node-toolchain: ${field} contains a character a .cmd launcher cannot quote and cannot be used.`);
  return value;
}
/** Single-quoted POSIX arguments cannot contain a quote or newline. @complexity O(n). */
function assertShellQuotable(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`node-toolchain: ${field} must be a non-empty string.`);
  if (/'|[\r\n]/.test(value)) throw new Error(`node-toolchain: ${field} contains a quote or newline and cannot be used in the launcher script.`);
  return value;
}

/** Exact Node/npm/npx launchers; the executable, path joiner and header are caller supplied.
 * No I/O. Throws before writing when a value cannot be safely quoted. @complexity O(n) in path lengths.
 */
export function buildNodeToolchainShims({ electronPath, npmRoot, platform, generatedComment, joinPath }: BuildNodeToolchainShimsInput): Record<string, string> {
  // Reuse Electron's bundled Node/npm without requiring a system install. ELECTRON_RUN_AS_NODE
  // prevents a second GUI process; npm/npx use the bundled CLI entry points.
  if (!generatedComment.startsWith('#') || /[\r\n]/.test(generatedComment)) throw new Error('node-toolchain: generatedComment must be one shell comment line.');
  if (platform === 'win32') {
    const exe = assertCmdQuotable({ value: electronPath, field: 'electronPath' });
    const npm = assertCmdQuotable({ value: joinPath({ parts: [npmRoot, 'bin', 'npm-cli.js'] }), field: 'npmRoot' });
    const npx = assertCmdQuotable({ value: joinPath({ parts: [npmRoot, 'bin', 'npx-cli.js'] }), field: 'npmRoot' });
    const header = ['@echo off', 'set ELECTRON_RUN_AS_NODE=1'];
    return {
      'node.cmd': [...header, `"${exe}" %*`, ''].join('\r\n'),
      'npm.cmd': [...header, `"${exe}" "${npm}" %*`, ''].join('\r\n'),
      'npx.cmd': [...header, `"${exe}" "${npx}" %*`, ''].join('\r\n'),
    };
  }
  const exe = assertShellQuotable(electronPath, 'electronPath');
  const npm = assertShellQuotable(joinPath({ parts: [npmRoot, 'bin', 'npm-cli.js'] }), 'npmRoot');
  const npx = assertShellQuotable(joinPath({ parts: [npmRoot, 'bin', 'npx-cli.js'] }), 'npmRoot');
  const header = ['#!/bin/sh', generatedComment, 'ELECTRON_RUN_AS_NODE=1', 'export ELECTRON_RUN_AS_NODE'];
  return {
    node: [...header, `exec '${exe}' "$@"`, ''].join('\n'),
    npm: [...header, `exec '${exe}' '${npm}' "$@"`, ''].join('\n'),
    npx: [...header, `exec '${exe}' '${npx}' "$@"`, ''].join('\n'),
  };
}

/** Atomically replace each executable shim in caller-selected directories, with owner-only modes.
 * A transient launch preserves an existing durable launcher or returns null without writing.
 * Filesystem/probe errors propagate; temporary files are cleaned up after a failed replacement.
 * @complexity O(n) shim bytes, with three writes and renames.
 */
export function writeNodeToolchain(input: WriteNodeToolchainInput): NodeToolchainPaths | null {
  // These paths are shared by every running copy. A transient disk-image/translocated executable
  // must not overwrite durable shims or pin the mounted image through another copy's child process.
  // Durable launches rewrite every time because moving/updating the app changes its executable path.
  const { paths, filesystem, writerPid, joinPath, isTransientPath, launcherNamesDurableInstall } = input;
  if (isTransientPath({ executablePath: input.electronPath })) {
    return launcherNamesDurableInstall({ launcherPath: joinPath({ parts: [paths.binDir, input.platform === 'win32' ? 'node.cmd' : 'node'] }) }) ? paths : null;
  }
  // Validate all launchers before touching a directory or file.
  const shims = buildNodeToolchainShims(input);
  filesystem.mkdirSync({ path: paths.binDir }, { recursive: true, mode: 0o700 });
  filesystem.chmodSync({ path: paths.binDir, mode: 0o700 });
  // bin goes first on child PATH: only the owner may write it. chmod is needed even after mkdir,
  // which leaves existing permissions alone and applies umask to newly created directories.
  filesystem.mkdirSync({ path: paths.npmCacheDir }, { recursive: true });
  filesystem.mkdirSync({ path: paths.npmPrefixDir }, { recursive: true });
  for (const [name, contents] of Object.entries(shims)) {
    const target = joinPath({ parts: [paths.binDir, name] });
    const temporary = `${target}.${writerPid}.tmp`;
    // Same-directory rename publishes a complete executable atomically; a crash must not leave a
    // half-written executable shim visible to another launcher.
    try {
      filesystem.writeFileSync({ path: temporary, data: contents }, { mode: 0o700 });
      filesystem.chmodSync({ path: temporary, mode: 0o700 });
      filesystem.renameSync({ oldPath: temporary, newPath: target });
    } catch (error) {
      try { filesystem.unlinkSync({ path: temporary }); } catch { /* Preserve the original write error. */ }
      throw error;
    }
  }
  return paths;
}

/** Host-named environment contract; duplicate/invalid names fail loudly. @complexity O(n) in names. */
export function buildNodeToolchainEnv({ toolchainDir, npmRoot, toolchainEnvName, npmRootEnvName }: BuildNodeToolchainEnvInput): Record<string, string> {
  if (![toolchainEnvName, npmRootEnvName].every(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) || toolchainEnvName === npmRootEnvName) {
    throw new Error('node-toolchain: environment names must be valid and distinct.');
  }
  return { [toolchainEnvName]: toolchainDir, [npmRootEnvName]: npmRoot };
}
