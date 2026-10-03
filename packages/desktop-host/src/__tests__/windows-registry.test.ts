import { describe, expect, it, vi } from 'vitest';
import {
  syncWindowsUninstallDisplayVersion,
  windowsUninstallDisplayVersionRegistryArgs,
  windowsUninstallRegistryQueryArgs,
} from '../windows-registry.js';

describe('syncWindowsUninstallDisplayVersion', () => {
  it('is a no-op on non-Windows platforms', async () => {
    const exec = vi.fn();
    const result = await syncWindowsUninstallDisplayVersion({ resolveUninstallRegistryKey: ({ namespace: ns }) => `Software\\Jini\\${ns}`, namespace: 'stable', version: '1.2.3' }, { exec, platform: 'darwin' });
    expect(result).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('is a no-op with no version', async () => {
    const exec = vi.fn();
    const result = await syncWindowsUninstallDisplayVersion({ resolveUninstallRegistryKey: ({ namespace: ns }) => `Software\\Jini\\${ns}`, namespace: 'stable', version: null }, { exec, platform: 'win32' });
    expect(result).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('queries then writes the registry key when the uninstall entry exists', async () => {
    const exec = vi.fn().mockResolvedValue(undefined);
    const result = await syncWindowsUninstallDisplayVersion({ resolveUninstallRegistryKey: ({ namespace: ns }) => `Software\\Jini\\${ns}`, namespace: 'stable', version: '1.2.3' }, { exec, platform: 'win32' });
    expect(result).toBe(true);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(1, { command: 'reg.exe', args: windowsUninstallRegistryQueryArgs({ registryKey: 'Software\\Jini\\stable' }) }, { windowsHide: true });
    expect(exec).toHaveBeenNthCalledWith(
      2,
      { command: 'reg.exe', args: windowsUninstallDisplayVersionRegistryArgs({ registryKey: 'Software\\Jini\\stable', version: '1.2.3' }) },
      { windowsHide: true },
    );
  });

  it('returns false without writing when the uninstall entry does not exist', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('not found'));
    const result = await syncWindowsUninstallDisplayVersion({ resolveUninstallRegistryKey: ({ namespace: ns }) => `Software\\Jini\\${ns}`, namespace: 'stable', version: '1.2.3' }, { exec, platform: 'win32' });
    expect(result).toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('falls back to process.platform when platform is not supplied, and is a no-op on this (non-Windows) test runner', async () => {
    const exec = vi.fn();
    const result = await syncWindowsUninstallDisplayVersion({ resolveUninstallRegistryKey: ({ namespace: ns }) => `Software\\Jini\\${ns}`, namespace: 'stable', version: '1.2.3' }, { exec });
    expect(process.platform).not.toBe('win32');
    expect(result).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('falls back to the real execFile-based exec when none is supplied, and treats a real reg.exe-not-found failure as "entry does not exist"', async () => {
    const result = await syncWindowsUninstallDisplayVersion({ resolveUninstallRegistryKey: ({ namespace: ns }) => `Software\\Jini\\${ns}`, namespace: 'stable', version: '1.2.3' }, { platform: 'win32' });
    // No `exec` override on a non-Windows test runner: the real execFileAsync
    // is used, `reg.exe` does not exist, and the query rejects — exercising
    // the `input.exec ?? execFileAsync` fallback for real, not a fake.
    expect(result).toBe(false);
  });
});
