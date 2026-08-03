import { describe, expect, it } from 'vitest';
import * as reactMcpUi from '../index.js';
import * as features from '../../../features/mcp-ui/index.js';

describe('@jini-ai/ui/mcp-ui barrel', () => {
  // `McpUiSurfaceCard`/`registerMcpUiSurfaceRenderer`/`MCP_UI_EXT_EVENT_NAME` moved to
  // `@jini-ai/chat/react` 2026-08-03 (chat-transcript ext-event renderer, not a generic mcp-ui
  // hosting primitive — see `packages/chat/src/react/components/McpUiSurfaceCard.tsx`'s file doc).
  // This barrel keeps only the Host and its supporting mechanics.
  it('exports the Host and the hook', () => {
    expect(reactMcpUi.McpUiHost).toBeTypeOf('function');
    expect(reactMcpUi.useMcpUiHost).toBeTypeOf('function');
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
