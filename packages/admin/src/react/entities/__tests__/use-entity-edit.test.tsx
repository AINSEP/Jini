import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort, AdminEntityRowData } from '../../../core/ports/entities.js';
import { useEntityEdit } from '../use-entity-edit.js';
import type { EntityRegistryPort } from '../types.js';

const descriptor = {
  name: 'items', labelSingular: 'Item', labelPlural: 'Items', titleField: 'title',
  fields: [{ name: 'title', kind: 'text', required: true }, { name: 'payload', kind: 'json' }],
} as const;

// A hand-written port fake whose writes can be held open to observe the in-flight guards.
function fixture({ withRemove = true }: { withRemove?: boolean } = {}) {
  const rows: Record<string, AdminEntityRowData> = { a: { id: 'a', title: 'Alpha', payload: { n: 1 } }, b: { id: 'b', title: 'Bravo' } };
  let release: (() => void) | null = null;
  const held = <T,>(value: T) => new Promise<T>(resolve => { release = () => resolve(value); });
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async () => ({ items: Object.values(rows), nextCursor: null })),
    get: vi.fn(async (id: string) => rows[id] ?? null),
    create: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: 'created' })),
    update: vi.fn((id: string, patch: Record<string, unknown>) => held({ ...patch, id })),
    ...(withRemove ? { remove: vi.fn(() => held(undefined)) } : {}),
  };
  const registry: EntityRegistryPort = { listEntities: () => [port], getEntity: ({ name }) => (name === 'items' ? port : null) };
  const routes = { href: () => '', navigate: vi.fn() };
  const translate = ({ key }: { readonly key: string }) => key;
  const mount = (id: string | null) => renderHook((props: { id: string | null }) =>
    useEntityEdit({ port, registry, routes, translate, entityName: 'items', id: props.id }), { initialProps: { id } });
  return { port, routes, mount, release: () => act(async () => { release?.(); }) };
}

describe('useEntityEdit', () => {
  it('ignores writes to unknown fields and JSON text for non-JSON fields', async () => {
    const f = fixture();
    const { result } = f.mount('a');
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => { result.current.setField({ name: 'nope', value: 1 }); result.current.setJsonText({ name: 'title', text: '"x"' }); });
    expect(result.current.form!.draft).toEqual({ title: 'Alpha', payload: { n: 1 } });
    expect(result.current.form!.jsonText).toEqual({ payload: '{\n  "n": 1\n}' });
  });

  it('blank JSON clears the value; invalid JSON keeps the draft and blocks saving', async () => {
    const f = fixture();
    const { result } = f.mount('a');
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.setJsonText({ name: 'payload', text: '{ broken' }));
    expect(result.current.form!.draft.payload).toEqual({ n: 1 });
    expect(result.current.form!.jsonErrors).toEqual({ payload: true });
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setJsonText({ name: 'payload', text: '   ' }));
    expect(result.current.form!.draft.payload).toBeUndefined();
    expect(result.current.form!.jsonErrors).toEqual({ payload: false });
    expect(result.current.canSave).toBe(true);
  });

  it('locks the form and refuses a second save or a remove while a save is in flight', async () => {
    const f = fixture();
    const { result } = f.mount('a');
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => { void result.current.save(); });
    expect(result.current.pending).toBe('save');
    act(() => {
      result.current.setField({ name: 'title', value: 'Changed' });
      result.current.setJsonText({ name: 'payload', text: '{}' });
      void result.current.save();
      void result.current.remove();
    });
    expect(result.current.form!.draft).toEqual({ title: 'Alpha', payload: { n: 1 } });
    expect(f.port.update).toHaveBeenCalledTimes(1);
    expect(f.port.remove).not.toHaveBeenCalled();
    await f.release();
    expect(f.routes.navigate).toHaveBeenCalledWith({ entity: 'items', id: 'a' });
    expect(result.current.pending).toBeNull();
  });

  it('does not save an incomplete draft', async () => {
    const f = fixture();
    const { result } = f.mount('a');
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => result.current.setField({ name: 'title', value: undefined }));
    expect(result.current.missing).toEqual(['title']);
    await act(async () => { await result.current.save(); });
    expect(f.port.update).not.toHaveBeenCalled();
  });

  it('cannot remove an unsaved row or through a port without remove', async () => {
    const creating = fixture();
    const { result } = creating.mount(null);
    await waitFor(() => expect(result.current.form).not.toBeNull());
    await act(async () => { await result.current.remove(); });
    expect(creating.port.remove).not.toHaveBeenCalled();
    const readOnly = fixture({ withRemove: false });
    const other = readOnly.mount('a');
    await waitFor(() => expect(other.result.current.form).not.toBeNull());
    await act(async () => { await other.result.current.remove(); });
    expect(other.result.current.pending).toBeNull();
    expect(readOnly.routes.navigate).not.toHaveBeenCalled();
  });

  it('setters captured for a previous row do not write into the next row', async () => {
    const f = fixture();
    const { result, rerender } = f.mount('a');
    await waitFor(() => expect(result.current.form?.draft.title).toBe('Alpha'));
    const stale = result.current;
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.form?.draft.title).toBe('Bravo'));
    act(() => { stale.setField({ name: 'title', value: 'Leaked' }); stale.setJsonText({ name: 'payload', text: '{"leaked":true}' }); });
    expect(result.current.form!.draft).toEqual({ title: 'Bravo', payload: undefined });
    expect(result.current.form!.jsonText).toEqual({ payload: '' });
  });

  it('a save still running for the previous row is not shown as pending on the next row', async () => {
    const f = fixture();
    const { result, rerender } = f.mount('a');
    await waitFor(() => expect(result.current.form).not.toBeNull());
    act(() => { void result.current.save(); });
    expect(result.current.pending).toBe('save');
    rerender({ id: 'b' });
    expect(result.current.pending).toBeNull();
    await f.release();
    // The late completion belongs to the old row, so it neither navigates nor marks a failure.
    expect(f.routes.navigate).not.toHaveBeenCalled();
    expect(result.current.failed).toBe(false);
  });
});
