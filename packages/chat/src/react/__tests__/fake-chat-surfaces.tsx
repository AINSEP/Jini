import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
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

export function renderWithChatSurfaces(ui: ReactElement, { surfaces = fakeChatSurfaces() }: { surfaces?: ChatSurfaces } = {}) {
  return render(<ChatSurfacesProvider surfaces={surfaces}>{ui}</ChatSurfacesProvider>);
}
