/** @file Every custom hook the entity screens use is a prop (or option) defaulted to the real one; a fake's output is what renders. */
import { renderHook } from '@testing-library/react';
import { render, screen } from '../../../__tests__/fetch-query-support.js';
import { describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort } from '../../../core/ports/entities.js';
import { EntityDetail } from '../EntityDetail.js';
import { useEntityDetail } from '../EntityDetail.hooks.js';
import { EntityEdit } from '../EntityEdit.js';
import { EntityList } from '../EntityList.js';
import { useEntityList } from '../EntityList.hooks.js';
import { createEntityRoutes } from '../contribution.js';
import type { EntityRegistryPort } from '../types.js';
import { useEntityEdit } from '../use-entity-edit.js';
import type { useEntityRead } from '../use-entity-read.js';

const descriptor = {
  name: 'notes', labelSingular: 'Note', labelPlural: 'Notes', titleField: 'title',
  fields: [{ name: 'title', kind: 'text', required: true }],
} as const;

function fixture() {
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async () => ({ items: [{ id: 'real', title: 'From the real port' }], nextCursor: null })),
    get: vi.fn(async () => ({ id: 'real', title: 'From the real port' })),
    create: vi.fn(async (input) => ({ ...input, id: 'x' })),
    update: vi.fn(async (id, patch) => ({ ...patch, id })),
  };
  const registry: EntityRegistryPort = { listEntities: () => [port], getEntity: ({ name }) => (name === 'notes' ? port : null) };
  const routes = createEntityRoutes({ adminBase: '/admin', panelId: 'notes', navigate: vi.fn() });
  return { port, registry, routes, translate: ({ key }: { readonly key: string }) => key };
}

const settled = <T,>(data: T): ReturnType<typeof useEntityRead<T>> => ({ data, error: undefined, loading: false });

describe('hook injection', () => {
  it('EntityList renders what an injected useListHook returns, without reading the port', async () => {
    const f = fixture();
    const useListHook = vi.fn(() => ({
      port: f.port, entries: [{ cursor: null, offset: 0 }], position: { cursor: null, offset: 0 }, setWalk: vi.fn(),
      result: settled({ page: { items: [{ id: 'f1', title: 'From the fake hook' }], nextCursor: null }, relations: {} }),
    }));
    render(<EntityList {...f} entityName="notes" limitParam={null} useListHook={useListHook as unknown as typeof useEntityList} />);
    expect(await screen.findByText('From the fake hook')).toBeInTheDocument();
    expect(f.port.list).not.toHaveBeenCalled();
    expect(useListHook).toHaveBeenCalledWith(expect.objectContaining({ entityName: 'notes', registry: f.registry }));
  });

  it('EntityDetail renders what an injected useDetailHook returns', async () => {
    const f = fixture();
    const useDetailHook = vi.fn(() => ({ port: f.port, result: settled({ row: { id: 'f1', title: 'Fake detail' }, relations: {} }) }));
    render(<EntityDetail {...f} entityName="notes" id="real" useDetailHook={useDetailHook as unknown as typeof useEntityDetail} />);
    expect(await screen.findByRole('heading', { name: 'Fake detail' })).toBeInTheDocument();
    expect(f.port.get).not.toHaveBeenCalled();
  });

  it('EntityEdit renders the form an injected useEditHook returns', async () => {
    const f = fixture();
    const useEditHook = vi.fn(() => ({
      form: { draft: { title: 'Fake draft' }, jsonText: {}, jsonErrors: {} },
      read: settled({ row: { id: 'real', title: 'x' }, relations: {} }),
      missing: [], invalid: [], canSave: true, pending: null, failed: false, failure: null,
      retry: async () => undefined, reload: () => undefined, setField: () => undefined, setJsonText: () => undefined,
      save: async () => undefined, remove: async () => undefined,
    }));
    render(<EntityEdit {...f} entityName="notes" id="real" useEditHook={useEditHook as unknown as typeof useEntityEdit} />);
    expect(await screen.findByLabelText('title *')).toHaveValue('Fake draft');
    expect(f.port.get).not.toHaveBeenCalled();
  });

  it('useEntityList, useEntityDetail and useEntityEdit return what an injected useReadHook returns', () => {
    const f = fixture();
    const fakeRow = { row: { id: 'real', title: 'Fake row' }, relations: {} };
    const useReadHook = vi.fn(() => settled(fakeRow)) as unknown as typeof useEntityRead;
    const list = renderHook(() => useEntityList({ entityName: 'notes', registry: f.registry, limitParam: null }, { useReadHook }));
    const detail = renderHook(() => useEntityDetail({ entityName: 'notes', registry: f.registry, id: 'real' }, { useReadHook }));
    const edit = renderHook(() => useEntityEdit({ port: f.port, registry: f.registry, routes: f.routes, translate: f.translate, entityName: 'notes', id: 'real', useReadHook }));
    expect(list.result.current.result.data).toBe(fakeRow);
    expect(detail.result.current.result.data).toBe(fakeRow);
    expect(edit.result.current.read.data).toBe(fakeRow);
    expect(edit.result.current.form?.draft).toEqual({ title: 'Fake row' });
    expect(f.port.list).not.toHaveBeenCalled();
    expect(f.port.get).not.toHaveBeenCalled();
  });
});
