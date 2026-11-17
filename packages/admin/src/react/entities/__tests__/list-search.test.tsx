/** @file `search` in the list query: typed on the port, passed through by the list, never invented. */
import { fireEvent, render, screen } from '../../../__tests__/fetch-query-support.js';
import { describe, expect, it, vi } from 'vitest';
import type { AdminEntityListQuery, AdminErasedEntityPort } from '../../../core/ports/entities.js';
import { EntityList } from '../EntityList.js';
import { createEntityRoutes } from '../contribution.js';
import type { EntityRegistryPort } from '../types.js';

const descriptor = {
  name: 'notes', labelSingular: 'Note', labelPlural: 'Notes', titleField: 'title',
  fields: [{ name: 'title', kind: 'text', required: true }],
} as const;

function fixture() {
  const queries: AdminEntityListQuery[] = [];
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async (query?: AdminEntityListQuery) => {
      if (query) queries.push(query);
      return query?.cursor
        ? { items: [{ id: 'b', title: 'Second' }], nextCursor: null }
        : { items: [{ id: 'a', title: `Match for ${query?.search ?? 'nothing'}` }], nextCursor: 'c1' };
    }),
    get: vi.fn(async () => null),
    create: vi.fn(async (input) => ({ ...input, id: 'x' })),
    update: vi.fn(async (id, patch) => ({ ...patch, id })),
  };
  const registry: EntityRegistryPort = { listEntities: () => [port], getEntity: ({ name }) => (name === 'notes' ? port : null) };
  const routes = createEntityRoutes({ adminBase: '/admin', panelId: 'notes', navigate: vi.fn() });
  return { port, registry, routes, queries, translate: ({ key }: { readonly key: string }) => key };
}

describe('EntityList search', () => {
  it('sends search to the port as typed, together with limit', async () => {
    const f = fixture();
    render(<EntityList {...f} entityName="notes" limitParam="10" search="milk" />);
    await screen.findByText('Match for milk');
    expect(f.queries).toEqual([{ limit: 10, search: 'milk' }]);
  });

  it('sends no search key without one, or for an empty search', async () => {
    const f = fixture();
    const view = render(<EntityList {...f} entityName="notes" limitParam={null} search={null} />);
    await screen.findByText('Match for nothing');
    view.rerender(<EntityList {...f} entityName="notes" limitParam={null} search="" />);
    await screen.findByText('Match for nothing');
    expect(f.queries.every((query) => !('search' in query))).toBe(true);
  });

  it('keeps the search on every page and starts again from page one when it changes', async () => {
    const f = fixture();
    const view = render(<EntityList {...f} entityName="notes" limitParam="10" search="milk" />);
    await screen.findByText('Match for milk');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Second');
    expect(f.queries.at(-1)).toEqual({ limit: 10, cursor: 'c1', search: 'milk' });
    view.rerender(<EntityList {...f} entityName="notes" limitParam="10" search="eggs" />);
    await screen.findByText('Match for eggs');
    expect(f.queries.at(-1)).toEqual({ limit: 10, search: 'eggs' });
  });
});
