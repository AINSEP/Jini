import { describe, expect, it } from 'vitest';
import * as IntegrationsBarrel from '../index.js';

describe('integrations tab barrel', () => {
  it('exports constants, rules, port helpers, hooks (+ wirers), and components', () => {
    expect(Array.isArray(IntegrationsBarrel.MCP_CLIENTS)).toBe(true);
    expect(IntegrationsBarrel.DEFAULT_MCP_CLIENT_ID).toBe('claude');
    expect(typeof IntegrationsBarrel.DEFAULT_MCP_SERVER_NAME).toBe('string');

    expect(typeof IntegrationsBarrel.buildClaudeCliSnippet).toBe('function');
    expect(typeof IntegrationsBarrel.buildCodexEnvToml).toBe('function');
    expect(typeof IntegrationsBarrel.buildCodexTomlSnippet).toBe('function');
    expect(typeof IntegrationsBarrel.buildCursorDeeplink).toBe('function');
    expect(typeof IntegrationsBarrel.buildMcpStdioServerConfig).toBe('function');
    expect(typeof IntegrationsBarrel.buildSharedMcpJson).toBe('function');
    expect(typeof IntegrationsBarrel.buildVsCodeSnippet).toBe('function');
    expect(typeof IntegrationsBarrel.buildZedSnippet).toBe('function');
    expect(typeof IntegrationsBarrel.commandPaletteShortcut).toBe('function');
    expect(typeof IntegrationsBarrel.homeConfigPath).toBe('function');
    expect(typeof IntegrationsBarrel.methodLabelForClient).toBe('function');
    expect(typeof IntegrationsBarrel.settingsShortcut).toBe('function');
    expect(typeof IntegrationsBarrel.snippetForClient).toBe('function');
    expect(typeof IntegrationsBarrel.utf8Btoa).toBe('function');

    expect(typeof IntegrationsBarrel.createFakeMcpIntegrationsPort).toBe('function');

    expect(typeof IntegrationsBarrel.useMcpInstallInfo).toBe('function');
    expect(typeof IntegrationsBarrel.useWiredMcpInstallInfo).toBe('function');
    expect(typeof IntegrationsBarrel.useCodexInstallToggle).toBe('function');
    expect(typeof IntegrationsBarrel.useWiredCodexInstallToggle).toBe('function');

    expect(typeof IntegrationsBarrel.ClientPicker).toBe('function');
    expect(typeof IntegrationsBarrel.SnippetBlock).toBe('function');
    expect(typeof IntegrationsBarrel.CodexInstallToggleButton).toBe('function');
    expect(typeof IntegrationsBarrel.IntegrationsTab).toBe('function');
  });
});
