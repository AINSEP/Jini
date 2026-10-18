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

/** Read the operator's login environment from a clean baseline, never the daemon's secret bag.
 * Only shell bootstrap keys reach the shell. Host-owned names are removed again after profiles
 * load, before a CLI or its MCP children can inherit them. Profile failures reject the launch.
 * @complexity O(e * p) for e environment entries and p small host-selected exclusions; one bounded process.
 */
export async function readLoginShellEnvironment(required: {
  baseEnv: Readonly<Record<string, string | undefined>>;
  excludedPrefixes: readonly string[]; excludedKeys: readonly string[]; excludedSuffixes?: readonly string[];
}, optional: {
  read?: (input: { shell: string; env: Record<string, string> }, options?: {}) => Promise<Record<string, string>>;
} = {}): Promise<Record<string, string>> {
  const baseline: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
    'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SSH_AUTH_SOCK', 'SystemRoot', 'windir', 'ComSpec', 'PATHEXT']) {
    const value = required.baseEnv[key];
    if (value !== undefined) baseline[key] = value;
  }
  const shell = userInfo().shell || baseline.SHELL || '/bin/sh';
  const read = optional.read ?? (async ({ shell, env }: { shell: string; env: Record<string, string> }) => {
    if (process.platform === 'win32') {
      // Registry-backed machine/user environment, without inheriting the service's private values.
      const script = "$e=@{}; foreach($s in @('Machine','User')) { [Environment]::GetEnvironmentVariables($s).GetEnumerator() | ForEach-Object { $e[$_.Key]=$_.Value } }; $e | ConvertTo-Json -Compress";
      const { stdout } = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NonInteractive', '-Command', script],
        { env, timeout: 10_000, maxBuffer: 1024 * 1024, cwd: env.USERPROFILE });
      return { ...env, ...JSON.parse(stdout) } as Record<string, string>;
    }
    const { stdout } = await promisify(execFile)(shell, ['-ilc', 'exec /usr/bin/env -0'],
      { env, timeout: 10_000, maxBuffer: 1024 * 1024, cwd: env.HOME });
    const entries = stdout.split('\0').flatMap(pair => {
      const at = pair.indexOf('=');
      return at > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(pair.slice(0, at)) ? [[pair.slice(0, at), pair.slice(at + 1)]] : [];
    });
    return Object.fromEntries(entries);
  });
  let env: Record<string, string>;
  try { env = await read({ shell, env: baseline }, {}); }
  catch { throw new Error('Login shell environment unavailable'); }
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => typeof value === 'string' &&
    !required.excludedKeys.some(name => name.toUpperCase() === key.toUpperCase()) &&
    !required.excludedPrefixes.some(prefix => key.toUpperCase().startsWith(prefix.toUpperCase())) &&
    !required.excludedSuffixes?.some(suffix => key.toUpperCase().endsWith(suffix.toUpperCase()))));
}
