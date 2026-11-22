/**
 * TEST-ONLY: ChatSurfaces bound to the REAL implementations, exactly as a host binds them (Tovu's
 * apps/admin/src/integrations/jini-surfaces.ts). For the few card tests whose subject is the bound
 * implementation itself: a real sandboxed MCP-UI iframe, a real registry component rendered inside
 * an A2UI card. Everything else uses fake-chat-surfaces.tsx, which proves chat only needs the port.
 */
import { McpUiHost } from '@jini-ai/ui/mcp-ui';
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '@jini-ai/ui/interactive-ui';
import { buildA2uiCatalogFromRegistry } from '@jini-ai/ui/a2ui';
import { getAgentModelContext } from '@jini-ai/agentic/dom';
import type { ChatSurfaces } from '../surfaces.js';

export function hostChatSurfaces(_required = {}, _optional: Record<string, never> = {}): ChatSurfaces {
  return {
    mcpUi: { Host: McpUiHost },
    interactiveUi: { defaultRegistry: DEFAULT_INTERACTIVE_UI_REGISTRY },
    a2ui: { catalogFromRegistry: buildA2uiCatalogFromRegistry },
    page: { getModelContext: getAgentModelContext },
  };
}
