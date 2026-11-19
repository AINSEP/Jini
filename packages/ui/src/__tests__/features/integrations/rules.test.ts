import { describe, expect, it } from 'vitest';
import {
  buildClaudeCliSnippet,
  buildCodexEnvToml,
  buildCodexTomlSnippet,
  buildCursorDeeplink,
  buildMcpStdioServerConfig,
  buildSharedMcpJson,
  buildVsCodeSnippet,
  buildZedSnippet,
  commandPaletteShortcut,
  homeConfigPath,
  isMcpInstallPrerequisiteMissing,
  methodLabelForClient,
  settingsShortcut,
  snippetForClient,
  utf8Btoa,
} from '../../../features/integrations/rules.js';
import type { McpClientId, McpInstallInfo } from '../../../features/integrations/types.js';

const info: McpInstallInfo = {
  command: 'node',
  args: ['/abs/path/cli.js', 'mcp'],
  daemonUrl: 'http://localhost:4000',
  platform: 'darwin',
  cliExists: true,
  nodeExists: true,
  buildHint: null,
};

const infoWithEnv: McpInstallInfo = {
  ...info,
  env: { API_KEY: 'shh' },
};

describe('homeConfigPath / commandPaletteShortcut / settingsShortcut', () => {
  it('picks the windows path/shortcuts on win32', () => {
    expect(homeConfigPath({ platform: 'win32', posix: '~/.foo', windows: '%USERPROFILE%\\.foo' })).toBe('%USERPROFILE%\\.foo');
    expect(commandPaletteShortcut({ platform: 'win32' })).toBe('Ctrl+Shift+P');
    expect(settingsShortcut({ platform: 'win32' })).toBe('Ctrl+,');
  });

  it('picks the posix path/shortcuts on darwin and other platforms', () => {
    expect(homeConfigPath({ platform: 'darwin', posix: '~/.foo', windows: '%USERPROFILE%\\.foo' })).toBe('~/.foo');
    expect(commandPaletteShortcut({ platform: 'darwin' })).toBe('⌘⇧P');
    expect(settingsShortcut({ platform: 'darwin' })).toBe('⌘,');
    expect(homeConfigPath({ platform: 'linux', posix: '~/.foo', windows: '%USERPROFILE%\\.foo' })).toBe('~/.foo');
    expect(commandPaletteShortcut({ platform: 'linux' })).toBe('Ctrl+Shift+P');
  });
});

describe('utf8Btoa', () => {
  it('round-trips ASCII text', () => {
    expect(atob(utf8Btoa({ s: 'hello' }))).toBe('hello');
  });

  it('handles non-Latin-1 characters that would throw a plain btoa()', () => {
    expect(() => utf8Btoa({ s: 'Émile' })).not.toThrow();
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(utf8Btoa({ s: 'Émile' })), (c) => c.charCodeAt(0)));
    expect(decoded).toBe('Émile');
  });
});

describe('buildMcpStdioServerConfig', () => {
  it('omits env when empty', () => {
    expect(buildMcpStdioServerConfig(info)).toEqual({ command: 'node', args: info.args });
  });

  it('includes env when present', () => {
    expect(buildMcpStdioServerConfig(infoWithEnv)).toEqual({ command: 'node', args: info.args, env: { API_KEY: 'shh' } });
  });
});

describe('snippet builders — server-name parameterization', () => {
  it('buildClaudeCliSnippet embeds the given serverName, not a hardcoded product name', () => {
    const snippet = buildClaudeCliSnippet({ serverName: 'my-server', info });
    expect(snippet).toContain('claude mcp add-json --scope user my-server');
    expect(snippet).not.toContain('open-design');
  });

  it('buildCodexTomlSnippet embeds serverName in the mcp_servers table key', () => {
    const snippet = buildCodexTomlSnippet({ serverName: 'my-server', info });
    expect(snippet).toContain('[mcp_servers.my-server]');
    expect(snippet).not.toContain('open-design');
  });

  it('buildCodexEnvToml embeds serverName and is empty with no env', () => {
    expect(buildCodexEnvToml({ serverName: 'my-server', info })).toBe('');
    expect(buildCodexEnvToml({ serverName: 'my-server', info: infoWithEnv })).toContain('[mcp_servers.my-server.env]');
  });

  it('buildSharedMcpJson embeds serverName as the mcpServers key', () => {
    const snippet = buildSharedMcpJson({ serverName: 'my-server', info });
    const parsed = JSON.parse(snippet) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toEqual(['my-server']);
  });

  it('buildVsCodeSnippet embeds serverName as the servers key and includes env when present', () => {
    const snippet = buildVsCodeSnippet({ serverName: 'my-server', info: infoWithEnv });
    const parsed = JSON.parse(snippet) as { servers: Record<string, { env?: Record<string, string> }> };
    expect(Object.keys(parsed.servers)).toEqual(['my-server']);
    expect(parsed.servers['my-server']?.env).toEqual({ API_KEY: 'shh' });
  });

  it('buildZedSnippet embeds serverName as the context_servers key', () => {
    const snippet = buildZedSnippet({ serverName: 'my-server', info });
    const parsed = JSON.parse(snippet) as { context_servers: Record<string, unknown> };
    expect(Object.keys(parsed.context_servers)).toEqual(['my-server']);
  });

  it('buildCursorDeeplink embeds serverName as the name query param', () => {
    const deeplink = buildCursorDeeplink({ serverName: 'my-server', info });
    expect(deeplink).toContain('name=my-server');
    expect(deeplink.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?')).toBe(true);
  });

  it('no builder ever emits the literal "open-design" regardless of serverName', () => {
    for (const build of [buildClaudeCliSnippet, buildCodexTomlSnippet, buildSharedMcpJson, buildVsCodeSnippet, buildZedSnippet]) {
      expect(build({ serverName: 'acme-server', info: infoWithEnv })).not.toContain('open-design');
    }
  });
});

describe('snippetForClient', () => {
  it('resolves a client-specific snippet, language, and templated instruction', () => {
    const claude = snippetForClient({ clientId: 'claude', serverName: 'my-server', info });
    expect(claude.language).toBe('bash');
    expect(claude.snippet).toContain('my-server');

    const codex = snippetForClient({ clientId: 'codex', serverName: 'my-server', info });
    expect(codex.language).toBe('toml');
    expect(codex.instructionTemplate).toBe('Paste this into {path}.');
    expect(codex.instructionVars.path).toBe('~/.codex/config.toml');

    const cursor = snippetForClient({ clientId: 'cursor', serverName: 'my-server', info });
    expect(cursor.deeplink).toContain('name=my-server');

    const vscode = snippetForClient({ clientId: 'vscode', serverName: 'my-server', info });
    expect(vscode.instructionVars.shortcut).toBe('⌘⇧P');
  });

  it('resolves windows-flavored instruction vars on win32', () => {
    const winInfo: McpInstallInfo = { ...info, platform: 'win32' };
    const codex = snippetForClient({ clientId: 'codex', serverName: 'my-server', info: winInfo });
    expect(codex.instructionVars.path).toBe('%USERPROFILE%\\.codex\\config.toml');
  });

  it('includes the method label matching methodLabelForClient for every client', () => {
    const clients: McpClientId[] = ['claude', 'codex', 'cursor', 'vscode', 'antigravity', 'zed', 'windsurf'];
    for (const clientId of clients) {
      expect(snippetForClient({ clientId, serverName: 'my-server', info }).method).toBe(methodLabelForClient({ clientId }));
    }
  });

  it('throws on an unknown client id', () => {
    expect(() => snippetForClient({ clientId: 'bogus' as McpClientId, serverName: 'my-server', info })).toThrow('Unknown MCP client id: bogus');
  });
});

describe('isMcpInstallPrerequisiteMissing', () => {
  it('is false when both the CLI and Node.js are present', () => {
    expect(isMcpInstallPrerequisiteMissing(info)).toBe(false);
  });

  it('is true when the CLI is missing', () => {
    expect(isMcpInstallPrerequisiteMissing({ ...info, cliExists: false })).toBe(true);
  });

  it('is true when Node.js is missing', () => {
    expect(isMcpInstallPrerequisiteMissing({ ...info, nodeExists: false })).toBe(true);
  });

  it('is true when both are missing', () => {
    expect(isMcpInstallPrerequisiteMissing({ ...info, cliExists: false, nodeExists: false })).toBe(true);
  });
});

describe('methodLabelForClient', () => {
  it('maps each client to its origin install-method label', () => {
    expect(methodLabelForClient({ clientId: 'claude' })).toBe('CLI command');
    expect(methodLabelForClient({ clientId: 'codex' })).toBe('TOML config');
    expect(methodLabelForClient({ clientId: 'cursor' })).toBe('One-click install');
    expect(methodLabelForClient({ clientId: 'vscode' })).toBe('JSON config');
    expect(methodLabelForClient({ clientId: 'antigravity' })).toBe('JSON config');
    expect(methodLabelForClient({ clientId: 'zed' })).toBe('JSON config');
    expect(methodLabelForClient({ clientId: 'windsurf' })).toBe('JSON config');
  });

  it('throws on an unknown client id', () => {
    expect(() => methodLabelForClient({ clientId: 'bogus' as McpClientId })).toThrow('Unknown MCP client id: bogus');
  });
});
