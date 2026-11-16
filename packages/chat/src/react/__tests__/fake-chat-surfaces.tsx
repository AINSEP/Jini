import type { ReactElement, ReactNode } from 'react';
import type { RenderHookOptions, RenderResult } from '@testing-library/react';
// Kit-scoped render: chat panes and cards reach ui's kit-backed selects and secret inputs, so the
// surfaces wrapper also needs the UiKitProvider a host mounts at its root.
import { render, renderHook } from './ui-kit-render-support.js';
import { z } from 'zod';
import {
  ChatSurfacesProvider,
  type ChatSurfaceComponentEntry,
  type ChatSurfaces,
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

/** Provider wrapper, so `rerender` keeps the surfaces too. */
function surfacesWrapper(surfaces: ChatSurfaces) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ChatSurfacesProvider surfaces={surfaces}>{children}</ChatSurfacesProvider>;
  };
}

export function renderWithChatSurfaces(ui: ReactElement, { surfaces = fakeChatSurfaces() }: { surfaces?: ChatSurfaces } = {}): RenderResult {
  // Explicit return type: the inferred one names a pnpm-internal @testing-library/dom path, and
  // this helper ships in the declaration build (TS2742).
  return render(ui, { wrapper: surfacesWrapper(surfaces) });
}

export function renderHookWithChatSurfaces<Result, Props>(
  callback: (props: Props) => Result,
  { surfaces = fakeChatSurfaces(), ...options }: Omit<RenderHookOptions<Props>, 'wrapper'> & { surfaces?: ChatSurfaces } = {},
) {
  return renderHook(callback, { ...options, wrapper: surfacesWrapper(surfaces) });
}
