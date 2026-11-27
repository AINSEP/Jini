import { expect, it } from 'vitest';
import { assertStagedHomeIsolated, CodexMcpIsolationError } from '../codex/isolation.js';

it.each(['model="chosen"', 'mcp_servers="invalid-shape"', 'mcp_servers=[]'])('accepts a staged config with no declared server table: %s', homeConfig => {
  expect(assertStagedHomeIsolated({ homeConfig, path: '/staged/config.toml' })).toBeUndefined();
});

it('still refuses a personal server in a proper table', () => {
  expect(() => assertStagedHomeIsolated({ homeConfig: '[mcp_servers.personal]\ncommand="private"', path: '/staged/config.toml' }))
    .toThrow(new CodexMcpIsolationError("/staged/config.toml declares MCP servers that can't be removed safely."));
});

it.each([
  ['invalid TOML', '[mcp_servers.jini', "/staged/config.toml declares MCP servers that can't be removed safely."],
  ['trusted project', '[mcp_servers.jini]\ncommand="bridge"\n[projects."/site"]\ntrust_level="trusted"', "/staged/config.toml trusts projects in a way that can't be removed safely."],
])('refuses a bridge-only staged home with %s', (_case, homeConfig, message) => {
  const verify = () => assertStagedHomeIsolated({ homeConfig, path: '/staged/config.toml' });
  expect(verify).toThrow(CodexMcpIsolationError);
  expect(verify).toThrow(new Error(message));
});
