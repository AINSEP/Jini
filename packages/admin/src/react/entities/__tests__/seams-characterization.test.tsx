/**
 * @file Pins what the entity screens do today at the four seams the notes screens need (create-only fields,
 * the failure message, refresh, list query). Written before the seams so each later change shows
 * which assertion it flips.
 */
import { fireEvent, render, screen, waitFor } from '../../../__tests__/fetch-query-support.js';
import { describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort, AdminEntityRowData } from '../../../core/ports/entities.js';
import { EntityEdit } from '../EntityEdit.js';
import { EntityList } from '../EntityList.js';
import { createEntityRoutes } from '../contribution.js';
import type { EntityRegistryPort } from '../types.js';

const descriptor = {
  name: 'notes', labelSingular: 'Note', labelPlural: 'Notes', titleField: 'title',
  fields: [
    { name: 'title', kind: 'text', required: true },
    { name: 'version', kind: 'integer', required: true },
  ],
} as const;

function fixture() {
  const row: AdminEntityRowData = { id: 'n1', title: 'First', version: 1 };
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async () => ({ items: [row], nextCursor: null })),
    get: vi.fn(async () => row),
    create: vi.fn(async (input) => ({ ...input, id: 'created' })),
    update: vi.fn(async (id, patch) => ({ ...patch, id })),
  };
  const registry: EntityRegistryPort = { listEntities: () => [port], getEntity: ({ name }) => (name === 'notes' ? port : null) };
  const navigate = vi.fn();
  const routes = createEntityRoutes({ adminBase: '/admin', panelId: 'notes', navigate });
  return { port, registry, routes, navigate, translate: ({ key }: { readonly key: string }) => key, row };
}

describe('entity screen seams, as they behave before the seams exist', () => {
  it('a required non-boolean field with no initial value keeps Save disabled on create, even when it is a concurrency token', async () => {
    const f = fixture();
    render(<EntityEdit {...f} entityName="notes" id={null} />);
    fireEvent.change(await screen.findByLabelText('title *'), { target: { value: 'Fresh' } });
    expect(screen.getByLabelText('version *')).toHaveValue(null);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('a rejected update keeps the draft; the message is the fixed text and the error appears only under Details (GA 2 changed this)', async () => {
    const f = fixture();
    f.port.update = vi.fn(async () => { throw Object.assign(new Error('version 1 is stale'), { code: 'CONFLICT' }); });
    render(<EntityEdit {...f} entityName="notes" id="n1" />);
    const title = await screen.findByLabelText('title *');
    await waitFor(() => expect(title).toHaveValue('First'));
    fireEvent.change(title, { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.querySelector('p')).toHaveTextContent(/^Operation failed$/);
    expect(alert.querySelector('details')).toHaveTextContent('version 1 is stale');
    expect(screen.queryByRole('button', { name: /reload/i })).toBeNull();
    expect(screen.getByLabelText('title *')).toHaveValue('Edited');
  });

  it('a list reads once and does not reload when it re-renders with nothing changed', async () => {
    const f = fixture();
    const view = render(<EntityList {...f} entityName="notes" limitParam={null} />);
    await screen.findByText('First');
    view.rerender(<EntityList {...f} entityName="notes" limitParam={null} />);
    view.rerender(<EntityList {...f} entityName="notes" limitParam={null} />);
    expect(f.port.list).toHaveBeenCalledTimes(1);
  });
});
