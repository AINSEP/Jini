/** @file The mutation-failure seam: the host words the failure, Reload re-reads, nothing is swallowed. */
import { fireEvent, render, screen, waitFor } from '../../../__tests__/fetch-query-support.js';
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort, AdminEntityRowData } from '../../../core/ports/entities.js';
import { EntityEdit } from '../EntityEdit.js';
import { createEntityRoutes } from '../contribution.js';
import { useEntityEdit } from '../use-entity-edit.js';
import type { EntityRegistryPort } from '../types.js';

const descriptor = {
  name: 'notes', labelSingular: 'Note', labelPlural: 'Notes', titleField: 'title',
  fields: [{ name: 'title', kind: 'text', required: true }, { name: 'version', kind: 'integer', required: true, persistedOnly: true }],
} as const;

class ConflictError extends Error {
  readonly code = 'CONFLICT';
}

function fixture() {
  let stored: AdminEntityRowData = { id: 'n1', title: 'First', version: 1 };
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async () => ({ items: [stored], nextCursor: null })),
    get: vi.fn(async () => stored),
    create: vi.fn(async (input) => ({ ...input, id: 'created' })),
    update: vi.fn(async () => { throw new ConflictError('version 1 is stale'); }),
  };
  const registry: EntityRegistryPort = { listEntities: () => [port], getEntity: ({ name }) => (name === 'notes' ? port : null) };
  const navigate = vi.fn();
  const routes = createEntityRoutes({ adminBase: '/admin', panelId: 'notes', navigate });
  return { port, registry, routes, navigate, translate: ({ key }: { readonly key: string }) => key, changeBehindBack: () => { stored = { id: 'n1', title: 'Server title', version: 2 }; } };
}

const describeConflict = ({ error }: { error: unknown }) => error instanceof ConflictError
  ? { message: 'This note changed since you opened it.', details: `CONFLICT: ${error.message}`, action: 'reload' as const }
  : { message: 'Could not save.', details: String(error) };

async function saveEdited(title: string) {
  const field = await screen.findByLabelText('title *');
  await waitFor(() => expect(field).toHaveValue('First'));
  fireEvent.change(field, { target: { value: title } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('EntityEdit failure seam', () => {
  it('shows the host\'s words and a Reload action for a conflict, and keeps the typed draft', async () => {
    const f = fixture();
    const seen: unknown[] = [];
    render(<EntityEdit {...f} entityName="notes" id="n1" describeFailure={({ error }) => { seen.push(error); return describeConflict({ error }); }} />);
    await saveEdited('My edit');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This note changed since you opened it.');
    expect(alert).not.toHaveTextContent('Operation failed');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByLabelText('title *')).toHaveValue('My edit');
    expect(seen[0]).toBeInstanceOf(ConflictError);
  });

  it('Reload reads the row again, replaces the typed text with what is stored and clears the alert', async () => {
    const f = fixture();
    render(<EntityEdit {...f} entityName="notes" id="n1" describeFailure={describeConflict} />);
    await saveEdited('My edit');
    await screen.findByRole('alert');
    f.changeBehindBack();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByLabelText('title *')).toHaveValue('Server title'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(f.port.get).toHaveBeenCalledTimes(2);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('without describeFailure: plain words, no raw exception as the message, details reachable and copyable', async () => {
    const f = fixture();
    const copyText = vi.fn(async () => undefined);
    render(<EntityEdit {...f} entityName="notes" id="n1" copyText={copyText} />);
    await saveEdited('My edit');
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')).toHaveTextContent(/^Operation failed$/);
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith({ text: 'Error: version 1 is stale' }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('says so when the details cannot be copied', async () => {
    const f = fixture();
    render(<EntityEdit {...f} entityName="notes" id="n1" copyText={async () => { throw new Error('clipboard blocked'); }} />);
    await saveEdited('My edit');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy details' }));
    expect(await screen.findByText('Could not copy details')).toBeInTheDocument();
  });

  it('Try again repeats the failed save and navigates once it works', async () => {
    const f = fixture();
    f.port.update = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ id: 'n1', title: 'My edit', version: 2 });
    render(<EntityEdit {...f} entityName="notes" id="n1" />);
    await saveEdited('My edit');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(f.navigate).toHaveBeenCalledWith({ routePath: '/notes/notes/row/n1' }));
    expect(f.port.update).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('useEntityEdit failure seam', () => {
  it('keeps the last failure with its error object, then retry and reload clear it', async () => {
    const f = fixture();
    const boom = new ConflictError('stale');
    f.port.update = vi.fn().mockRejectedValueOnce(boom).mockResolvedValueOnce({ id: 'n1', title: 'First', version: 2 });
    const { result } = renderHook(() => useEntityEdit({ port: f.port, registry: f.registry, routes: f.routes, translate: f.translate, entityName: 'notes', id: 'n1' }));
    await waitFor(() => expect(result.current.form).not.toBeNull());
    await act(async () => { await result.current.save(); });
    expect(result.current.failure).toEqual({ error: boom, kind: 'save' });
    await act(async () => { await result.current.retry(); });
    expect(result.current.failure).toBeNull();
    expect(f.port.update).toHaveBeenCalledTimes(2);
    f.port.update = vi.fn().mockRejectedValue(boom);
    await act(async () => { await result.current.save(); });
    expect(result.current.failure).not.toBeNull();
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.failure).toBeNull());
  });
});
