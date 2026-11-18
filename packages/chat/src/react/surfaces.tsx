/**
 * @file Chat's rich-surface port: the implementations a chat card renders through but must not
 * import (owner 2026-11-15, everything injected). Wire vocabulary (A2UI, MCP-UI resources) is NOT
 * here: it is plain data from @jini-ai/protocol. What is here renders or probes the host: the
 * MCP-UI sandbox iframe, the interactive component registry, the registry->catalog builder, and
 * WebMCP model-context detection. The host proves compatibility with `satisfies ChatSurfaces`.
 * The first `surfaces` value is kept: `useModelContext`-style slots must not change identity.
 */
import { createContext, useContext, useState, type ComponentType, type ReactNode } from 'react';
import type { Catalog, ComponentSpec } from '@jini-ai/protocol/a2ui';
import type { McpUiToolCallHandler } from '@jini-ai/protocol/mcp-ui';

/** Only the props chat passes to the MCP-UI iframe host. */
export interface McpUiHostProps {
  readonly title: string; readonly html: string; readonly sandboxProxyUrl: URL; readonly toolName?: string;
  readonly sessionKey?: string | number; readonly onToolCall?: McpUiToolCallHandler; readonly onOpenLink?: (url: string) => void;
  readonly initialHeight?: number; readonly maxHeight?: number | undefined;
}
/** A registry component chat can render inside an A2UI surface. */
export interface ChatSurfaceComponentEntry {
  readonly id: string; readonly propsSchema: ComponentSpec['propsSchema'];
  readonly Component: ComponentType<Record<string, unknown>>; readonly actionProp?: string;
}
export interface ChatSurfaceRegistry {
  list(required?: Record<string, never>, optional?: Record<string, never>): readonly ChatSurfaceComponentEntry[];
  resolveById(required: { id: string }, optional?: Record<string, never>): ChatSurfaceComponentEntry | null;
}
export interface AgentModelContextToolRegistration {
  readonly name: string; readonly title?: string; readonly description: string; readonly inputSchema: unknown;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
  readonly annotations?: { readonly readOnlyHint?: boolean; readonly untrustedContentHint?: boolean };
}
export interface AgentModelContextLike {
  registerTool(required: { tool: AgentModelContextToolRegistration }, options?: { readonly signal?: AbortSignal; readonly exposedTo?: readonly string[] }): Promise<void>;
  unregisterTool?(required: { name: string }, _optional?: Record<string, never>): void;
}
export interface ChatSurfaces {
  readonly mcpUi: { readonly Host: ComponentType<McpUiHostProps> };
  readonly interactiveUi: { readonly defaultRegistry: ChatSurfaceRegistry };
  readonly a2ui: {
    catalogFromRegistry(required: { registry: Pick<ChatSurfaceRegistry, 'list'>; catalogId: string }, optional?: { base?: Catalog }): Catalog;
  };
  readonly page: {
    getModelContext(required: { host: { candidates(required: Record<string, never>): readonly unknown[] } }, optional?: Record<string, never>): AgentModelContextLike | undefined;
  };
}

const ChatSurfacesContext = createContext<ChatSurfaces | null>(null);

export function ChatSurfacesProvider(required: { surfaces: ChatSurfaces; children: ReactNode }, _optional: Record<string, never> = {}) {
  const [surfaces] = useState(() => required.surfaces);
  return <ChatSurfacesContext.Provider value={surfaces}>{required.children}</ChatSurfacesContext.Provider>;
}
export function useChatSurfaces(): ChatSurfaces {
  const surfaces = useContext(ChatSurfacesContext);
  if (!surfaces) throw new Error('Chat MCP-UI and A2UI cards need <ChatSurfacesProvider surfaces={...}> above them '
    + '(or a ChatKitProvider whose kit has `surfaces`). Hosts bind the implementations once per React root.');
  return surfaces;
}
/** Same-name facade, so McpUiSurfaceCard changes only its import line. */
export function McpUiHost({ useChatSurfacesHook = useChatSurfaces, ...props }: McpUiHostProps & { useChatSurfacesHook?: typeof useChatSurfaces }) {
  const { Host } = useChatSurfacesHook().mcpUi;
  return <Host {...props} />;
}
