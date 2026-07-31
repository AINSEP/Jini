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
  methodLabelForClient,
  settingsShortcut,
  snippetForClient,
  utf8Btoa,
} from '../../../tabs/integrations/rules.js';
import type { McpClientId, McpInstallInfo } from '../../../tabs/integrations/types.js';

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
    expect(homeConfigPath('win32', '~/.foo', '%USERPROFILE%\\.foo')).toBe('%USERPROFILE%\\.foo');
    expect(commandPaletteShortcut('win32')).toBe('Ctrl+Shift+P');
    expect(settingsShortcut('win32')).toBe('Ctrl+,');
  });

  it('picks the posix path/shortcuts on darwin and other platforms', () => {
    expect(homeConfigPath('darwin', '~/.foo', '%USERPROFILE%\\.foo')).toBe('~/.foo');
    expect(commandPaletteShortcut('darwin')).toBe('⌘⇧P');
    expect(settingsShortcut('darwin')).toBe('⌘,');
    expect(homeConfigPath('linux', '~/.foo', '%USERPROFILE%\\.foo')).toBe('~/.foo');
    expect(commandPaletteShortcut('linux')).toBe('Ctrl+Shift+P');
  });
});

describe('utf8Btoa', () => {
  it('round-trips ASCII text', () => {
    expect(atob(utf8Btoa('hello'))).toBe('hello');
  });

  it('handles non-Latin-1 characters that would throw a plain btoa()', () => {
    expect(() => utf8Btoa('Émile')).not.toThrow();
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(utf8Btoa('Émile')), (c) => c.charCodeAt(0)));
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
    const snippet = buildClaudeCliSnippet('my-server', info);
    expect(snippet).toContain('claude mcp add-json --scope user my-server');
    expect(snippet).not.toContain('open-design');
  });

  it('buildCodexTomlSnippet embeds serverName in the mcp_servers table key', () => {
    const snippet = buildCodexTomlSnippet('my-server', info);
    expect(snippet).toContain('[mcp_servers.my-server]');
    expect(snippet).not.toContain('open-design');
  });

  it('buildCodexEnvToml embeds serverName and is empty with no env', () => {
    expect(buildCodexEnvToml('my-server', info)).toBe('');
    expect(buildCodexEnvToml('my-server', infoWithEnv)).toContain('[mcp_servers.my-server.env]');
  });

  it('buildSharedMcpJson embeds serverName as the mcpServers key', () => {
    const snippet = buildSharedMcpJson('my-server', info);
    const parsed = JSON.parse(snippet) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toEqual(['my-server']);
  });

  it('buildVsCodeSnippet embeds serverName as the servers key and includes env when present', () => {
    const snippet = buildVsCodeSnippet('my-server', infoWithEnv);
    const parsed = JSON.parse(snippet) as { servers: Record<string, { env?: Record<string, string> }> };
    expect(Object.keys(parsed.servers)).toEqual(['my-server']);
    expect(parsed.servers['my-server']?.env).toEqual({ API_KEY: 'shh' });
  });

  it('buildZedSnippet embeds serverName as the context_servers key', () => {
    const snippet = buildZedSnippet('my-server', info);
    const parsed = JSON.parse(snippet) as { context_servers: Record<string, unknown> };
    expect(Object.keys(parsed.context_servers)).toEqual(['my-server']);
  });

  it('buildCursorDeeplink embeds serverName as the name query param', () => {
    const deeplink = buildCursorDeeplink('my-server', info);
    expect(deeplink).toContain('name=my-server');
    expect(deeplink.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?')).toBe(true);
  });

  it('no builder ever emits the literal "open-design" regardless of serverName', () => {
    for (const build of [buildClaudeCliSnippet, buildCodexTomlSnippet, buildSharedMcpJson, buildVsCodeSnippet, buildZedSnippet]) {
      expect(build('acme-server', infoWithEnv)).not.toContain('open-design');
    }
  });
});

describe('snippetForClient', () => {
  it('resolves a client-specific snippet, language, and templated instruction', () => {
    const claude = snippetForClient('claude', 'my-server', info);
    expect(claude.language).toBe('bash');
    expect(claude.snippet).toContain('my-server');

    const codex = snippetForClient('codex', 'my-server', info);
    expect(codex.language).toBe('toml');
    expect(codex.instructionTemplate).toBe('Paste this into {path}.');
    expect(codex.instructionVars.path).toBe('~/.codex/config.toml');

    const cursor = snippetForClient('cursor', 'my-server', info);
    expect(cursor.deeplink).toContain('name=my-server');

    const vscode = snippetForClient('vscode', 'my-server', info);
    expect(vscode.instructionVars.shortcut).toBe('⌘⇧P');
  });

  it('resolves windows-flavored instruction vars on win32', () => {
    const winInfo: McpInstallInfo = { ...info, platform: 'win32' };
    const codex = snippetForClient('codex', 'my-server', winInfo);
    expect(codex.instructionVars.path).toBe('%USERPROFILE%\\.codex\\config.toml');
  });

  it('includes the method label matching methodLabelForClient for every client', () => {
    const clients: McpClientId[] = ['claude', 'codex', 'cursor', 'vscode', 'antigravity', 'zed', 'windsurf'];
    for (const clientId of clients) {
      expect(snippetForClient(clientId, 'my-server', info).method).toBe(methodLabelForClient(clientId));
    }
  });

  it('throws on an unknown client id', () => {
    expect(() => snippetForClient('bogus' as McpClientId, 'my-server', info)).toThrow('Unknown MCP client id: bogus');
  });
});

describe('methodLabelForClient', () => {
  it('maps each client to its origin install-method label', () => {
    expect(methodLabelForClient('claude')).toBe('CLI command');
    expect(methodLabelForClient('codex')).toBe('TOML config');
    expect(methodLabelForClient('cursor')).toBe('One-click install');
    expect(methodLabelForClient('vscode')).toBe('JSON config');
    expect(methodLabelForClient('antigravity')).toBe('JSON config');
    expect(methodLabelForClient('zed')).toBe('JSON config');
    expect(methodLabelForClient('windsurf')).toBe('JSON config');
  });

  it('throws on an unknown client id', () => {
    expect(() => methodLabelForClient('bogus' as McpClientId)).toThrow('Unknown MCP client id: bogus');
  });
});
