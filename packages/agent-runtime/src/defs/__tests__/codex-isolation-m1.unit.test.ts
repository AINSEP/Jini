import { expect, it } from 'vitest';
import { assertStagedHomeIsolated, CodexMcpIsolationError } from '../isolation.js';

it.each(['model="chosen"', 'mcp_servers="invalid-shape"', 'mcp_servers=[]'])('accepts a staged config with no declared server table: %s', homeConfig => {
  expect(assertStagedHomeIsolated({ homeConfig, path: '/staged/config.toml' })).toBeUndefined();
});

it('still refuses a personal server in a proper table', () => {
  expect(() => assertStagedHomeIsolated({ homeConfig: '[mcp_servers.personal]\ncommand="private"', path: '/staged/config.toml' }))
    .toThrow(new CodexMcpIsolationError("/staged/config.toml declares MCP servers that can't be removed safely."));
});
