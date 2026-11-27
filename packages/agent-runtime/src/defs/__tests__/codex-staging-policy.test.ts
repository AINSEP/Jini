import { expect, it } from 'vitest';
import { buildCodexHomeConfigToml } from '../codex/home-config.js';
import { CodexMcpIsolationError } from '../codex/isolation.js';

it('keeps personal MCP and CLI settings independently selectable in Codex staging', () => {
  const existingRaw = 'model = "personal-model"\n[mcp_servers.chrome]\ncommand = "chrome"\n[features]\nmulti_agent = true\n';
  const entry = { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };
  const noMcp = buildCodexHomeConfigToml({ existingRaw, entry, inheritUserMcp: false });
  expect(noMcp).toContain('personal-model');
  expect(noMcp).not.toContain('chrome');
  expect(noMcp).toContain('host-bridge');
  const noSettings = buildCodexHomeConfigToml({ existingRaw, entry, inheritUserSettings: false });
  expect(noSettings).not.toContain('personal-model');
  expect(noSettings).not.toContain('multi_agent');
  expect(noSettings).toContain('chrome');
  expect(noSettings).toContain('host-bridge');
});

const bridgeEntry = { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };

it('refuses an unrewritable inline MCP config instead of ignoring an OFF switch', () => {
  expect(() => buildCodexHomeConfigToml({ existingRaw: 'mcp_servers.chrome.command = "chrome"',
    entry: { command: 'host-bridge', args: [], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } }, inheritUserMcp: false })).toThrow('Cannot turn off personal MCP servers');
});

it('drops a hand-written jini table and its subtables whatever their spelling', () => {
  const existingRaw = ['model = "m"', '  [ "mcp_servers" . \'jini\' ]  # stale', 'command = "old"', "['mcp_servers'.jini.env]", 'TOKEN = "old"', '[sandbox]', 'policy = "p"'].join('\n');
  expect(buildCodexHomeConfigToml({ existingRaw, entry: bridgeEntry }).split('\n').slice(0, 3)).toEqual(['model = "m"', '[sandbox]', 'policy = "p"']);
});

it('keeps a table whose name only starts like the jini table', () => {
  const existingRaw = '[mcp_servers.jini2]\ncommand = "other"';
  expect(buildCodexHomeConfigToml({ existingRaw, entry: bridgeEntry })).toContain('[mcp_servers.jini2]\ncommand = "other"');
});

it('drops the bare [mcp_servers] table when personal MCP is off', () => {
  const result = buildCodexHomeConfigToml({ existingRaw: '[mcp_servers]\nx = 1\n[ui]\ntheme = "dark"', entry: bridgeEntry, inheritUserMcp: false });
  expect(result.startsWith('[ui]\ntheme = "dark"\n\n')).toBe(true);
  expect(result).not.toContain('x = 1');
});

it('keeps an inline root MCP declaration untouched while personal MCP stays on', () => {
  expect(buildCodexHomeConfigToml({ existingRaw: 'mcp_servers = { chrome = { command = "chrome" } }', entry: bridgeEntry }))
    .toContain('mcp_servers = { chrome = { command = "chrome" } }');
});

it('names the inline shape and the fix when personal MCP cannot be turned off', () => {
  expect(() => buildCodexHomeConfigToml({ existingRaw: "'mcp_servers' = { chrome = { command = \"chrome\" } }", entry: bridgeEntry, inheritUserMcp: false }))
    .toThrow(new CodexMcpIsolationError('Cannot turn off personal MCP servers: the Codex config.toml declares mcp_servers inline (a dotted key or `mcp_servers = {...}`), which cannot be removed safely; move each server into its own [mcp_servers.<name>] table.'));
});
