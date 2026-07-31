import { describe, expect, it } from 'vitest';
import { createFakeMcpIntegrationsPort } from '../../../tabs/integrations/dependencies.js';

describe('createFakeMcpIntegrationsPort', () => {
  it('resolves install info', async () => {
    const port = createFakeMcpIntegrationsPort();
    const info = await port.fetchInstallInfo();
    expect(info.command).toBeTruthy();
    expect(Array.isArray(info.args)).toBe(true);
  });

  it('resolves custom install info when supplied', async () => {
    const port = createFakeMcpIntegrationsPort({ info: { command: 'x', args: [], daemonUrl: '', platform: 'linux', cliExists: false, nodeExists: false, buildHint: 'build me' } });
    const info = await port.fetchInstallInfo();
    expect(info.command).toBe('x');
    expect(info.buildHint).toBe('build me');
  });

  it('reflects codex install/uninstall in subsequent status checks', async () => {
    const port = createFakeMcpIntegrationsPort();
    expect((await port.fetchCodexInstallStatus!()).installed).toBe(false);
    await port.installCodexMcp!();
    expect((await port.fetchCodexInstallStatus!()).installed).toBe(true);
    await port.uninstallCodexMcp!();
    expect((await port.fetchCodexInstallStatus!()).installed).toBe(false);
  });

  it('respects a custom initial codexStatus', async () => {
    const port = createFakeMcpIntegrationsPort({ codexStatus: { available: false, installed: false } });
    expect(await port.fetchCodexInstallStatus!()).toEqual({ available: false, installed: false });
  });

  it('simulates latency when latencyMs > 0', async () => {
    const port = createFakeMcpIntegrationsPort({ latencyMs: 5 });
    const start = Date.now();
    await port.fetchInstallInfo();
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
  });
});
