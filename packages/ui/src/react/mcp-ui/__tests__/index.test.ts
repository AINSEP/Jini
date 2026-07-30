import { describe, expect, it } from 'vitest';
import * as reactMcpUi from '../index.js';
import * as features from '../../../features/mcp-ui/index.js';

describe('@jini-ai/ui/mcp-ui barrel', () => {
  it('exports the Host, the hook, the card and its registration entry point', () => {
    expect(reactMcpUi.McpUiHost).toBeTypeOf('function');
    expect(reactMcpUi.useMcpUiHost).toBeTypeOf('function');
    expect(reactMcpUi.McpUiSurfaceCard).toBeTypeOf('function');
    expect(reactMcpUi.registerMcpUiSurfaceRenderer).toBeTypeOf('function');
    expect(reactMcpUi.MCP_UI_EXT_EVENT_NAME).toBe('mcp-ui');
    expect(reactMcpUi.subscribeToViewMessages).toBeTypeOf('function');
    expect(reactMcpUi.DEFAULT_TEARDOWN_TIMEOUT_MS).toBeGreaterThan(0);
    expect(reactMcpUi.DEFAULT_INITIALIZED_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('re-exports the non-React half, so a React consumer needs one import for the whole feature', () => {
    expect(reactMcpUi.buildConfirmationSurface).toBe(features.buildConfirmationSurface);
    expect(reactMcpUi.createConfirmationStore).toBe(features.createConfirmationStore);
    expect(reactMcpUi.MCP_UI_VIEW_SANDBOX).toBe(features.MCP_UI_VIEW_SANDBOX);
  });
});
