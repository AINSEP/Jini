/** @file `refreshToken`: a changed token reloads the read once; the same token never does. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { render, screen } from '../../../__tests__/fetch-query-support.js';
import { describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort, AdminEntityRowData } from '../../../core/ports/entities.js';
import { EntityDetail } from '../EntityDetail.js';
import { EntityList } from '../EntityList.js';
import { createEntityPanel, createEntityRoutes } from '../contribution.js';
import { matchRoute } from '../../../core/routing/rules.js';
import type { ReactElement } from 'react';
import type { EntityRegistryPort } from '../types.js';
import { useEntityRead } from '../use-entity-read.js';

const descriptor = {
  name: 'notes', labelSingular: 'Note', labelPlural: 'Notes', titleField: 'title',
  fields: [{ name: 'title', kind: 'text', required: true }],
} as const;

function fixture() {
  let title = 'First';
  const row = (): AdminEntityRowData => ({ id: 'n1', title });
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async () => ({ items: [row()], nextCursor: null })),
    get: vi.fn(async () => row()),
    create: vi.fn(async (input) => ({ ...input, id: 'created' })),
    update: vi.fn(async (id, patch) => ({ ...patch, id })),
  };
  const registry: EntityRegistryPort = { listEntities: () => [port], getEntity: ({ name }) => (name === 'notes' ? port : null) };
  const routes = createEntityRoutes({ adminBase: '/admin', panelId: 'notes', navigate: vi.fn() });
  return { port, registry, routes, translate: ({ key }: { readonly key: string }) => key, rename: (next: string) => { title = next; } };
}

describe('useEntityRead refreshToken', () => {
  it('reloads once when the token changes and not when it stays the same', async () => {
    const load = vi.fn(async () => 'data');
    const scope = {};
    const { result, rerender } = renderHook((props: { token: unknown }) => useEntityRead({ load, scope, refreshToken: props.token }), { initialProps: { token: 1 } });
    await waitFor(() => expect(result.current.data).toBe('data'));
    rerender({ token: 1 });
    rerender({ token: 1 });
    expect(load).toHaveBeenCalledTimes(1);
    rerender({ token: 2 });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    rerender({ token: 2 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps showing the last data while the refresh is in flight, then the new data', async () => {
    let calls = 0;
    let settle: (value: string) => void = () => {};
    const load = vi.fn(() => (calls++ === 0 ? Promise.resolve('old') : new Promise<string>((resolve) => { settle = resolve; })));
    const scope = {};
    const { result, rerender } = renderHook((props: { token: unknown }) => useEntityRead({ load, scope, refreshToken: props.token }), { initialProps: { token: 'a' } });
    await waitFor(() => expect(result.current.data).toBe('old'));
    rerender({ token: 'b' });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBe('old');
    await act(async () => settle('new'));
    expect(result.current.data).toBe('new');
  });

  it('shows the error of a failed refresh instead of the stale data', async () => {
    let calls = 0;
    const load = vi.fn(async () => { if (calls++ > 0) throw new Error('gone'); return 'old'; });
    const scope = {};
    const { result, rerender } = renderHook((props: { token: unknown }) => useEntityRead({ load, scope, refreshToken: props.token }), { initialProps: { token: 1 } });
    await waitFor(() => expect(result.current.data).toBe('old'));
    rerender({ token: 2 });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  });
});

describe('screens take refreshToken', () => {
  it('EntityList reloads its page on a new token and shows the changed row', async () => {
    const f = fixture();
    const view = render(<EntityList {...f} entityName="notes" limitParam={null} refreshToken={1} />);
    await screen.findByText('First');
    f.rename('Renamed');
    view.rerender(<EntityList {...f} entityName="notes" limitParam={null} refreshToken={1} />);
    expect(f.port.list).toHaveBeenCalledTimes(1);
    view.rerender(<EntityList {...f} entityName="notes" limitParam={null} refreshToken={2} />);
    await screen.findByText('Renamed');
    expect(f.port.list).toHaveBeenCalledTimes(2);
  });

  it('EntityDetail reloads its row on a new token', async () => {
    const f = fixture();
    const view = render(<EntityDetail {...f} entityName="notes" id="n1" refreshToken="a" />);
    await screen.findByRole('heading', { name: 'First' });
    f.rename('Renamed');
    view.rerender(<EntityDetail {...f} entityName="notes" id="n1" refreshToken="b" />);
    await screen.findByRole('heading', { name: 'Renamed' });
    expect(f.port.get).toHaveBeenCalledTimes(2);
  });
});

describe('createEntityPanel refreshToken option', () => {
  it('reaches the screens: a panel made with a new token reads the open list again', async () => {
    const f = fixture();
    const panelWith = (refreshToken: unknown) => createEntityPanel(
      { registry: f.registry, translate: f.translate, adminBase: '/admin', panelId: 'notes', navigate: vi.fn() }, { refreshToken });
    const renderPanel = (panel: ReturnType<typeof panelWith>) =>
      panel.render({ route: matchRoute({ routePath: '/notes/notes', panels: [panel] }) } as Parameters<typeof panel.render>[0]) as ReactElement;
    const view = render(renderPanel(panelWith(1)));
    await screen.findByText('First');
    f.rename('Renamed');
    view.rerender(renderPanel(panelWith(2)));
    await screen.findByText('Renamed');
    expect(f.port.list).toHaveBeenCalledTimes(2);
  });
});
