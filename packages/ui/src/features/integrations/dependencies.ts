import type { McpIntegrationsPort } from './ports.js';
import type { CodexInstallStatus, McpInstallInfo } from './types.js';

export interface FakeMcpIntegrationsPortOptions {
  info?: McpInstallInfo;
  codexStatus?: CodexInstallStatus;
  /** Simulated network latency in ms; 0 (default) resolves synchronously. */
  latencyMs?: number;
}

const DEFAULT_FAKE_INFO: McpInstallInfo = {
  command: 'node',
  args: ['/path/to/cli.js', 'mcp'],
  daemonUrl: 'http://localhost:0',
  platform: 'darwin',
  cliExists: true,
  nodeExists: true,
  buildHint: null,
};

/**
 * An in-memory test/demo double. Per this package's established convention
 * (see `features/connectors/dependencies.ts`), ships a fake rather than a
 * real transport — a real host supplies its own `McpIntegrationsPort`
 * pointed at its own daemon's install-info/Codex-install endpoints.
 */
export function createFakeMcpIntegrationsPort(options: FakeMcpIntegrationsPortOptions = {}): McpIntegrationsPort {
  const info = options.info ?? DEFAULT_FAKE_INFO;
  let codexStatus = options.codexStatus ?? { available: true, installed: false };
  const latencyMs = options.latencyMs ?? 0;
  const delay = <T>(value: T): Promise<T> =>
    latencyMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(value), latencyMs)) : Promise.resolve(value);

  return {
    fetchInstallInfo() {
      return delay({ ...info });
    },
    fetchCodexInstallStatus() {
      return delay({ ...codexStatus });
    },
    installCodexMcp() {
      codexStatus = { ...codexStatus, installed: true };
      return delay(undefined);
    },
    uninstallCodexMcp() {
      codexStatus = { ...codexStatus, installed: false };
      return delay(undefined);
    },
  };
}
