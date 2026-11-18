import type { ReactElement } from 'react';
import type { RenderHookOptions, RenderResult } from './fake-chat-kit.js';
// Chat panes and cards render through the ChatKit, so the surfaces wrapper also mounts the fake kit.
import { render, renderHook } from './fake-chat-kit.js';
import type { ChatKit } from '../kit.js';
import { z } from 'zod';
import {
  ChatSurfacesProvider,
  type ChatSurfaceComponentEntry,
  type ChatSurfaces,
  type McpUiHostProps,
} from '../surfaces.js';

function fakeRegistry(ids: readonly string[]) {
  const entries = new Map<string, ChatSurfaceComponentEntry>(
    ids.map((id) => [id, { id, propsSchema: z.object({}), Component: () => <div data-entry={id} /> }]),
  );
  return {
    list: () => [...entries.values()],
    resolveById: ({ id }: { id: string }) => entries.get(id) ?? null,
  };
}

/** In-memory ChatSurfaces: iframe stand-in host, Map-backed registry, trivial catalog builder. */
export function fakeChatSurfaces(overrides: Partial<ChatSurfaces> = {}): ChatSurfaces {
  return {
    mcpUi: { Host: (p) => <iframe title={p.title} data-tool={p.toolName} srcDoc={p.html} /> },
    interactiveUi: { defaultRegistry: fakeRegistry([]) },
    a2ui: {
      catalogFromRegistry: ({ registry, catalogId }, { base } = {}) => ({
        catalogId,
        components: new Map([
          ...(base?.components ?? []),
          ...registry.list().map((e) => [e.id, { kind: 'container' as const, propsSchema: e.propsSchema }] as const),
        ]),
        functions: new Map(base?.functions ?? []),
      }),
    },
    page: { getModelContext: () => undefined },
    ...overrides,
  };
}

export function renderWithChatSurfaces(ui: ReactElement, { surfaces = fakeChatSurfaces(), kit }: { surfaces?: ChatSurfaces; kit?: ChatKit } = {}): RenderResult {
  // Explicit return type: the inferred one names a pnpm-internal @testing-library/dom path, and
  // this helper ships in the declaration build (TS2742).
  return render(ui, { surfaces, ...(kit ? { kit } : {}) });
}

export function renderHookWithChatSurfaces<Result, Props>(
  callback: (props: Props) => Result,
  { surfaces = fakeChatSurfaces(), ...options }: Omit<RenderHookOptions<Props>, 'wrapper'> & { surfaces?: ChatSurfaces } = {},
) {
  return renderHook(callback, { ...options, wrapper: ({ children }) => <ChatSurfacesProvider surfaces={surfaces}>{children}</ChatSurfacesProvider> });
}

/**
 * TEST-ONLY: an MCP-UI host that records the props chat passes it and renders an iframe stand-in tagged
 * with the resource URI. What the real host does with those props (sandbox iframe, `aria-label`, height
 * style) is ui's subject and is proved in ui's `McpUiHost.test.tsx`.
 */
export function recordingMcpUiHost(_required = {}, _optional: Record<string, never> = {}) {
  const renders: McpUiHostProps[] = [];
  const Host = (props: McpUiHostProps) => {
    renders.push(props);
    return <iframe title={props.title} data-uri={props.toolName} />;
  };
  /** The latest props per resource URI, in first-appearance order. */
  const latestByUri = (): McpUiHostProps[] => {
    const latest = new Map<string, McpUiHostProps>();
    for (const props of renders) latest.set(props.toolName ?? '', props);
    return [...latest.values()];
  };
  return { Host, renders, latestByUri };
}
