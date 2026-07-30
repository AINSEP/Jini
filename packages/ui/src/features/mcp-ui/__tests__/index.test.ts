import { describe, expect, it } from 'vitest';
import * as mcpUi from '../index.js';
import * as surfaces from '../surfaces/index.js';

describe('@jini-ai/ui/mcp-ui/surfaces barrel', () => {
  it('exports the protocol vocabulary re-exported from @jini-ai/agentic, not a second copy of it', () => {
    expect(mcpUi.MCP_UI_VIEW_METHODS.initialize).toBe('ui/initialize');
    expect(mcpUi.MCP_UI_VIEW_NOTIFICATIONS.initialized).toBe('ui/notifications/initialized');
    expect(mcpUi.MCP_UI_HOST_REQUESTS.teardown).toBe('ui/resource-teardown');
    expect(mcpUi.MCP_UI_HOST_NOTIFICATIONS.toolResult).toBe('ui/notifications/tool-result');
    expect(mcpUi.JSON_RPC_ERROR_CODES.methodNotFound).toBe(-32601);
    expect(mcpUi.JINI_PAGE_ACTION_METHOD).toBe('x-jini/page-action');
    expect(mcpUi.isJsonRpcMessage({ jsonrpc: '2.0', method: 'ping' })).toBe(true);
    expect(mcpUi.createJsonRpcRequest(1, 'ping')).toEqual({ jsonrpc: '2.0', id: 1, method: 'ping' });
  });

  it('states the sandbox rule as a constant, so the reason travels with the value', () => {
    expect(mcpUi.MCP_UI_VIEW_SANDBOX).toBe('allow-scripts');
    expect(mcpUi.MCP_UI_SANDBOX_NOTE).toContain('allow-same-origin');
    expect(mcpUi.MCP_UI_PROTOCOL_VERSION).toBe('2026-01-26');
  });

  it('exports the resource, escaping, store and buffer halves', () => {
    expect(mcpUi.createUIResource).toBeTypeOf('function');
    expect(mcpUi.buildUIToolResult).toBeTypeOf('function');
    expect(mcpUi.parseUIResource).toBeTypeOf('function');
    expect(mcpUi.escapeHtml).toBeTypeOf('function');
    expect(mcpUi.escapeJsValue).toBeTypeOf('function');
    expect(mcpUi.createConfirmationStore).toBeTypeOf('function');
    expect(mcpUi.createEarlyMessageBuffer).toBeTypeOf('function');
  });

  it('re-exports every surface builder', () => {
    for (const name of ['renderSurfaceDocument', 'renderBridgeScript', 'renderTokenBlock', 'renderFieldControl'] as const) {
      expect(surfaces[name]).toBeTypeOf('function');
      expect(mcpUi[name]).toBe(surfaces[name]);
    }
    expect(mcpUi.buildConfirmationSurface).toBe(surfaces.buildConfirmationSurface);
    expect(mcpUi.buildFormSurface).toBe(surfaces.buildFormSurface);
    expect(mcpUi.renderCheckbox).toBe(surfaces.renderCheckbox);
    expect(mcpUi.renderSelect).toBe(surfaces.renderSelect);
    expect(mcpUi.renderTextInput).toBe(surfaces.renderTextInput);
  });
});
