import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';

/** Environment isolation for child processes; hosts name the settings that belong to one run. */

/**
 * Copy an environment without host-selected keys. Reports names only, never values; no I/O.
 * Windows callers opt into case-insensitive matching so duplicate spellings cannot survive.
 * @returns A fresh environment and the configured names whose defined values were omitted.
 * @complexity O(e + k) time/space for e environment entries and k configured names.
 * @example omitEnvironmentKeys({ env: parent, keys: ['WORKSPACE_STORAGE'] });
 */
export function omitEnvironmentKeys(
  { env, keys }: { env: Readonly<Record<string, string | undefined>>; keys: readonly string[] },
  { caseInsensitive = false }: { caseInsensitive?: boolean } = {},
): { env: Record<string, string | undefined>; omitted: string[] } {
  const normalize = (key: string) => caseInsensitive ? key.toUpperCase() : key;
  const names = new Map(keys.map((key) => [normalize(key), key]));
  const child: Record<string, string | undefined> = {};
  const omitted = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    const name = names.get(normalize(key));
    if (name !== undefined) {
      if (value !== undefined) omitted.add(name);
    } else {
      child[key] = value;
    }
  }
  return { env: child, omitted: [...omitted] };
}

/** Runs one bounded command and resolves its stdout; `execFile` semantics. */
export type LoginShellCommandRunner = (
  required: { file: string; args: readonly string[]; env: Record<string, string>; cwd: string | undefined },
  optional?: {},
) => Promise<{ stdout: string }>;

/** Host process facts and the command runner the default login-environment reader uses. */
export interface LoginShellPorts {
  readonly platform: NodeJS.Platform;
  /** The account's login shell; `null` where the OS has none (Windows). */
  readonly userShell: () => string | null;
  readonly runCommand: LoginShellCommandRunner;
}

const LOGIN_SHELL_BOOTSTRAP_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SSH_AUTH_SOCK', 'SystemRoot', 'windir', 'ComSpec', 'PATHEXT'];

// Registry-backed machine/user environment, without inheriting the service's private values.
const WINDOWS_ENVIRONMENT_SCRIPT = "$e=@{}; foreach($s in @('Machine','User')) { [Environment]::GetEnvironmentVariables($s).GetEnumerator() | ForEach-Object { $e[$_.Key]=$_.Value } }; $e | ConvertTo-Json -Compress";

/** The real host: this process's platform, the account's login shell and `execFile` (10 s, 1 MiB). */
export function nodeLoginShellPorts(): LoginShellPorts {
  const exec = promisify(execFile);
  return {
    platform: process.platform,
    userShell: () => userInfo().shell,
    runCommand: ({ file, args, env, cwd }) => exec(file, [...args], { env, timeout: 10_000, maxBuffer: 1024 * 1024, cwd }),
  };
}

/** Parse `env -0` output, keeping only well-formed variable names.
 * @complexity O(n) in the output length. */
function parseNullSeparatedEnvironment({ stdout }: { stdout: string }): Record<string, string> {
  const entries = stdout.split('\0').flatMap(pair => {
    const at = pair.indexOf('=');
    return at > 0 && /^[A-Za-z_]\w*$/.test(pair.slice(0, at)) ? [[pair.slice(0, at), pair.slice(at + 1)]] : [];
  });
  return Object.fromEntries(entries);
}

/** The default reader: the Windows registry environment, or the login shell's `env -0`. */
async function readHostLoginEnvironment(
  { shell, env }: { shell: string; env: Record<string, string> }, ports: LoginShellPorts,
): Promise<Record<string, string>> {
  if (ports.platform === 'win32') {
    const { stdout } = await ports.runCommand({ file: 'powershell.exe', args: ['-NoLogo', '-NonInteractive', '-Command', WINDOWS_ENVIRONMENT_SCRIPT],
      env, cwd: env.USERPROFILE });
    return { ...env, ...JSON.parse(stdout) } as Record<string, string>;
  }
  const { stdout } = await ports.runCommand({ file: shell, args: ['-ilc', 'exec /usr/bin/env -0'], env, cwd: env.HOME });
  return parseNullSeparatedEnvironment({ stdout });
}

/** True when a host-owned name, prefix or suffix claims this key (case-insensitively). */
function isExcludedEnvironmentKey({ key, required }: { key: string; required: {
  excludedPrefixes: readonly string[]; excludedKeys: readonly string[]; excludedSuffixes?: readonly string[];
} }): boolean {
  const upper = key.toUpperCase();
  return required.excludedKeys.some(name => name.toUpperCase() === upper) ||
    required.excludedPrefixes.some(prefix => upper.startsWith(prefix.toUpperCase())) ||
    (required.excludedSuffixes ?? []).some(suffix => upper.endsWith(suffix.toUpperCase()));
}

/** Read the operator's login environment from a clean baseline, never the daemon's secret bag.
 * Only shell bootstrap keys reach the shell. Host-owned names are removed again after profiles
 * load, before a CLI or its MCP children can inherit them. Profile failures reject the launch.
 * `ports` replaces the host platform, login-shell lookup and command runner the default `read` uses.
 * @complexity O(e * p) for e environment entries and p small host-selected exclusions; one bounded process.
 */
export async function readLoginShellEnvironment(required: {
  baseEnv: Readonly<Record<string, string | undefined>>;
  excludedPrefixes: readonly string[]; excludedKeys: readonly string[]; excludedSuffixes?: readonly string[];
}, optional: {
  read?: (input: { shell: string; env: Record<string, string> }, options?: {}) => Promise<Record<string, string>>;
  ports?: LoginShellPorts;
} = {}): Promise<Record<string, string>> {
  const baseline: Record<string, string> = {};
  for (const key of LOGIN_SHELL_BOOTSTRAP_KEYS) {
    const value = required.baseEnv[key];
    if (value !== undefined) baseline[key] = value;
  }
  const ports = optional.ports ?? nodeLoginShellPorts();
  const shell = ports.userShell() || baseline.SHELL || '/bin/sh';
  const read = optional.read ?? ((input: { shell: string; env: Record<string, string> }) => readHostLoginEnvironment(input, ports));
  let env: Record<string, string>;
  try { env = await read({ shell, env: baseline }, {}); }
  catch { throw new Error('Login shell environment unavailable'); }
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => typeof value === 'string' &&
    !isExcludedEnvironmentKey({ key, required })));
}
