/**
 * Ported from OD `apps/packaged/src/windows-lifecycle.ts`. Flagged
 * explicitly: despite the filename, this file has nothing to do with
 * window/BrowserWindow lifecycle — it syncs a Windows uninstall registry
 * entry's `DisplayVersion` so Add/Remove Programs shows the version of the
 * package actually running (relevant when an in-place/incremental update
 * changed the app without re-running the installer). Genuinely generic
 * once decoupled from OD's `@open-design/sidecar-proto` registry-key
 * helper — the caller now supplies its own `resolveUninstallRegistryKey`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WindowsRegistryExec = (requiredArgs: { command: string; args: string[] }, optionalArgs?: { windowsHide?: true }) => Promise<unknown>;

export interface SyncWindowsUninstallDisplayVersionInput {
  resolveUninstallRegistryKey: (args: { namespace: string }) => string;
  namespace: string;
  version: string | null;
  exec?: WindowsRegistryExec;
  platform?: NodeJS.Platform;
}

export function windowsUninstallRegistryQueryArgs({ registryKey }: { registryKey: string }): string[] {
  return ['query', `HKCU\\${registryKey}`];
}

export function windowsUninstallDisplayVersionRegistryArgs({ registryKey, version }: { registryKey: string; version: string }): string[] {
  return ['add', `HKCU\\${registryKey}`, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', version, '/f'];
}

export async function syncWindowsUninstallDisplayVersion(requiredArgs: Pick<SyncWindowsUninstallDisplayVersionInput, 'resolveUninstallRegistryKey' | 'namespace' | 'version'>, optionalArgs: Omit<SyncWindowsUninstallDisplayVersionInput, 'resolveUninstallRegistryKey' | 'namespace' | 'version'> = {}): Promise<boolean> {
  const input = { ...optionalArgs, ...requiredArgs };
  if ((input.platform ?? process.platform) !== 'win32') return false;
  const version = input.version?.trim();
  if (version == null || version.length === 0) return false;
  const run: WindowsRegistryExec = input.exec ?? (({ command, args }, options = {}) => execFileAsync(command, args, options));
  const registryKey = input.resolveUninstallRegistryKey({ namespace: input.namespace });
  try {
    await run({ command: 'reg.exe', args: windowsUninstallRegistryQueryArgs({ registryKey }) }, { windowsHide: true });
  } catch {
    return false;
  }
  await run({ command: 'reg.exe', args: windowsUninstallDisplayVersionRegistryArgs({ registryKey, version }) }, { windowsHide: true });
  return true;
}
