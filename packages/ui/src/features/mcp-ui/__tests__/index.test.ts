import { describe, expect, it } from 'vitest';
import * as mcpUi from '../index.js';
import * as surfaces from '../surfaces/index.js';
import { defineSecretCardTool } from '../secret-card.js';

describe('@jini-ai/ui/mcp-ui/surfaces barrel', () => {
  it('exports the same secret-card owner as the dedicated universal entry', () => {
    expect(mcpUi.defineSecretCardTool).toBe(defineSecretCardTool);
  });
  it('states the sandbox rule as a constant, so the reason travels with the value', () => {
    expect(mcpUi.MCP_UI_VIEW_SANDBOX).toBe('allow-scripts');
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
