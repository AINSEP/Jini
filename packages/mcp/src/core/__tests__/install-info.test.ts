import { splitInstallFixture } from '../../__tests__/args-fixtures.js';
import { describe, expect, it } from 'vitest';
import { buildMcpInstallPayload, type BuildMcpInstallPayloadOptions, type BuildMcpInstallPayloadInputs } from '../install-info.js';

function base(overrides: Partial<BuildMcpInstallPayloadInputs & BuildMcpInstallPayloadOptions> = {}): BuildMcpInstallPayloadInputs & BuildMcpInstallPayloadOptions {
  return {
    cliPath: '/app/cli.js',
    cliExists: true,
    execPath: '/usr/bin/node',
    nodeExists: true,
    port: 17456,
    platform: 'darwin',
    dataDir: '/data',
    dataDirEnvVar: 'JINI_DATA_DIR',
    electronAsNode: false,
    isSidecarMode: false,
    sidecarEnv: {},
    ...overrides,
  };
}

describe('buildMcpInstallPayload', () => {
  it('bakes --daemon-url on a direct (non-sidecar) launch and defaults subcommand to mcp', () => {
    const p = buildMcpInstallPayload(...splitInstallFixture(base({ webBaseUrl: 'http://127.0.0.1:65321' })));
    expect(p.command).toBe('/usr/bin/node');
    expect(p.args).toEqual(['/app/cli.js', 'mcp', '--daemon-url', 'http://127.0.0.1:17456']);
    expect(p.env).toEqual({ JINI_DATA_DIR: '/data' });
    expect(p.daemonUrl).toBe('http://127.0.0.1:17456');
    expect(p.webBaseUrl).toBe('http://127.0.0.1:65321');
    expect(p.platform).toBe('darwin');
    expect(p.cliExists).toBe(true);
    expect(p.nodeExists).toBe(true);
    expect(p.buildHint).toBeNull();
  });

  it('omits --daemon-url in sidecar mode, honors a custom subcommand + sidecar env + electron flag', () => {
    const p = buildMcpInstallPayload(...splitInstallFixture(base({
        isSidecarMode: true,
        subcommand: 'serve',
        electronAsNode: true,
        sidecarEnv: { JINI_SIDECAR_SOCK: '/tmp/s.sock' },
      }))
    );
    expect(p.args).toEqual(['/app/cli.js', 'serve']);
    expect(p.env).toEqual({
      JINI_DATA_DIR: '/data',
      JINI_SIDECAR_SOCK: '/tmp/s.sock',
      ELECTRON_RUN_AS_NODE: '1',
    });
  });

  it('emits both build hints when the cli and node runtime are missing', () => {
    const p = buildMcpInstallPayload(...splitInstallFixture(base({ cliExists: false, nodeExists: false })));
    expect(p.buildHint).toContain('CLI entry is missing at /app/cli.js');
    expect(p.buildHint).toContain('Node-compatible runtime at /usr/bin/node');
    expect(p.cliExists).toBe(false);
    expect(p.nodeExists).toBe(false);
  });

  it('normalizes an empty-string webBaseUrl to null', () => {
    expect(buildMcpInstallPayload(...splitInstallFixture(base({ webBaseUrl: '' }))).webBaseUrl).toBeNull();
  });

  it('normalizes an omitted webBaseUrl to null', () => {
    expect(buildMcpInstallPayload(...splitInstallFixture(base())).webBaseUrl).toBeNull();
  });
});
