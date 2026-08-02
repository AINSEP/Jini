// The Advanced modal portals the raw MEMORY.md index editor plus a technical
// memory-tree view into a host element. These pin the closed / no-host
// guards, the backdrop-click close, the index draft edit + reset + save
// wiring, and the tree render (folders, child rows, edit action).
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MemoryAdvancedModal } from '../../../react/components/MemoryAdvancedModal.js';
import type { MemoryTreeNode } from '../../../types.js';

function folder(id: string, over: Partial<MemoryTreeNode> = {}): MemoryTreeNode {
  return { id, kind: 'folder', name: id, path: `${id}/`, ...over };
}
function child(id: string, over: Partial<MemoryTreeNode> = {}): MemoryTreeNode {
  return { id, kind: 'entry', name: id, parentId: 'f1', ...over };
}

function renderModal(props: Partial<Parameters<typeof MemoryAdvancedModal>[0]> = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const cbs = {
    onClose: vi.fn(),
    onIndexDraftChange: vi.fn(),
    onSaveIndex: vi.fn(),
    onStartEdit: vi.fn(),
  };
  const utils = render(
    <MemoryAdvancedModal
      open
      modalHost={host}
      index="INDEX"
      indexDraft={null}
      busy={false}
      memoryTree={[]}
      treeFolders={[]}
      treeChildren={new Map()}
      {...cbs}
      {...props}
    />,
  );
  return { ...utils, host, ...cbs };
}

describe('MemoryAdvancedModal', () => {
  it('renders nothing when closed', () => {
    const { host } = renderModal({ open: false });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders nothing when there is no host', () => {
    const { container } = render(
      <MemoryAdvancedModal
        open
        modalHost={null}
        onClose={vi.fn()}
        index=""
        indexDraft={null}
        onIndexDraftChange={vi.fn()}
        onSaveIndex={vi.fn()}
        busy={false}
        memoryTree={[]}
        treeFolders={[]}
        treeChildren={new Map()}
        onStartEdit={vi.fn()}
      />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the title and hint when open with a host', () => {
    const { host } = renderModal();
    expect(host.querySelector('#memory-advanced-modal-title')?.textContent).toBe('Advanced');
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('closes when the backdrop (but not the dialog) is clicked', () => {
    const { onClose, host } = renderModal();
    const backdrop = host.querySelector('.memory-action-modal-backdrop') as HTMLElement;
    // Clicking the dialog itself must NOT close (stopPropagation / target guard).
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    dialog.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    // Clicking the backdrop surface closes.
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
  });

  it('fires onClose from the close button', async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('edits the index draft and wires reset + save', async () => {
    const { onIndexDraftChange, onSaveIndex } = renderModal({ indexDraft: 'draft text' });
    const textarea = screen.getByDisplayValue('draft text');
    fireEvent.change(textarea, { target: { value: 'new draft' } });
    expect(onIndexDraftChange).toHaveBeenCalledWith('new draft');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onIndexDraftChange).toHaveBeenCalledWith(null);
    await userEvent.click(screen.getByRole('button', { name: 'Save index' }));
    expect(onSaveIndex).toHaveBeenCalled();
  });

  it('falls back to the saved index when there is no draft', () => {
    renderModal({ index: 'SAVED INDEX', indexDraft: null });
    expect(screen.getByDisplayValue('SAVED INDEX')).toBeInTheDocument();
  });

  it('disables Reset when there is no draft, and Save when busy or no draft', () => {
    renderModal({ indexDraft: null, busy: false });
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save index' })).toBeDisabled();
  });

  it('enables Reset and Save once a draft exists and is not busy', () => {
    renderModal({ indexDraft: 'x', busy: false });
    expect(screen.getByRole('button', { name: 'Reset' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save index' })).not.toBeDisabled();
  });

  it('disables Save while busy even with a draft present', () => {
    renderModal({ indexDraft: 'x', busy: true });
    expect(screen.getByRole('button', { name: 'Save index' })).toBeDisabled();
  });

  it('does not render the memory-tree section when there are no folders', () => {
    renderModal({ treeFolders: [] });
    expect(screen.queryByText('Memory tree')).toBeNull();
  });

  it('renders the memory tree and wires a child edit action', async () => {
    const { onStartEdit } = renderModal({
      memoryTree: [folder('f1'), child('c1')],
      treeFolders: [folder('f1')],
      treeChildren: new Map([['f1', [child('c1', { description: 'a note' })]]]),
    });
    expect(screen.getByText('Memory tree')).toBeInTheDocument();
    expect(screen.getByText('a note')).toBeInTheDocument();
    await userEvent.click(screen.getByTitle('Edit'));
    expect(onStartEdit).toHaveBeenCalledWith('c1');
  });

  it('handles an empty folder (no children map entry) with a "0 nodes" count', () => {
    renderModal({
      memoryTree: [folder('f1')],
      treeFolders: [folder('f1')],
      // No entry for f1 in the map -> the `?? []` fallback + the 0-children path.
      treeChildren: new Map(),
    });
    expect(screen.getByText('0 nodes')).toBeInTheDocument();
  });

  it('renders a single child without a description as "1 node"', () => {
    renderModal({
      memoryTree: [folder('f1'), child('c1')],
      treeFolders: [folder('f1')],
      // One child, no description -> singular "node" + the no-description branch.
      treeChildren: new Map([['f1', [child('c1')]]]),
    });
    expect(screen.getByText('1 node')).toBeInTheDocument();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(
      <I18nProvider dictionaries={{ fr: { Advanced: 'Avancé', Close: 'Fermer' } }} initialLocale="fr">
        <MemoryAdvancedModal
          open
          modalHost={host}
          index=""
          indexDraft={null}
          onClose={vi.fn()}
          onIndexDraftChange={vi.fn()}
          onSaveIndex={vi.fn()}
          busy={false}
          memoryTree={[]}
          treeFolders={[]}
          treeChildren={new Map()}
          onStartEdit={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(host.querySelector('#memory-advanced-modal-title')?.textContent).toBe('Avancé');
    expect(host.querySelector('[aria-label="Fermer"]')).not.toBeNull();
  });
});
