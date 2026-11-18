/** @file `persistedOnly` fields (a version token, a slug): read-only on a saved row, absent on create. */
import { fireEvent, render, screen, waitFor } from '../../../__tests__/fetch-query-support.js';
import { describe, expect, it, vi } from 'vitest';
import type { AdminErasedEntityPort, AdminEntityRowData } from '../../../core/ports/entities.js';
import { EntityEdit } from '../EntityEdit.js';
import { createEntityRoutes } from '../contribution.js';
import { missingRequiredFields } from '../rules.js';
import type { EntityRegistryPort } from '../types.js';

const descriptor = {
  name: 'notes', labelSingular: 'Note', labelPlural: 'Notes', titleField: 'title',
  fields: [
    { name: 'title', kind: 'text', required: true },
    { name: 'version', kind: 'integer', required: true, persistedOnly: true },
  ],
} as const;

function fixture() {
  const row: AdminEntityRowData = { id: 'n1', title: 'First', version: 7 };
  const port: AdminErasedEntityPort = {
    descriptor,
    list: vi.fn(async () => ({ items: [row], nextCursor: null })),
    get: vi.fn(async () => row),
    create: vi.fn(async (input) => ({ ...input, id: 'created', version: 1 })),
    update: vi.fn(async (id, patch) => ({ ...patch, id })),
  };
  const registry: EntityRegistryPort = { listEntities: () => [port], getEntity: ({ name }) => (name === 'notes' ? port : null) };
  const navigate = vi.fn();
  const routes = createEntityRoutes({ adminBase: '/admin', panelId: 'notes', navigate });
  return { port, registry, routes, navigate, translate: ({ key }: { readonly key: string }) => key };
}

describe('persistedOnly fields', () => {
  it('are absent from the create form and never block saving or reach the port', async () => {
    const f = fixture();
    render(<EntityEdit {...f} entityName="notes" id={null} />);
    fireEvent.change(await screen.findByLabelText('title *'), { target: { value: 'Fresh' } });
    expect(screen.queryByText(/version/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.port.create).toHaveBeenCalledWith({ title: 'Fresh' }));
  });

  it('are shown read-only on a saved row and travel back unchanged in the update', async () => {
    const f = fixture();
    render(<EntityEdit {...f} entityName="notes" id="n1" />);
    const title = await screen.findByLabelText('title *');
    await waitFor(() => expect(title).toHaveValue('First'));
    expect(screen.getByText('version')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByLabelText(/version/)).toBeNull();
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    fireEvent.change(title, { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.port.update).toHaveBeenCalledWith('n1', { title: 'Edited', version: 7 }));
  });

  it('missingRequiredFields skips them when creating and counts them otherwise', () => {
    expect(missingRequiredFields({ descriptor, draft: { title: 'x' } }, { creating: true })).toEqual([]);
    expect(missingRequiredFields({ descriptor, draft: { title: 'x' } })).toEqual(['version']);
    expect(missingRequiredFields({ descriptor, draft: {} }, { creating: true })).toEqual(['title']);
  });
});
