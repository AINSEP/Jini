// The manual editor renders the "Add manually" summary + New button, a
// transient flash pill, and the create/edit form (starters, name/type/desc/
// body, save). These pin the New/cancel/save callbacks, the starter
// prefill, the type-select change, the field edits, the save-disabled-when-
// name-blank guard, and the flash pill (which suppresses the pathCopied
// kind).
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type MutableRefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MemoryManualEditor } from '../../../react/components/MemoryManualEditor.js';
import type { DraftEntry } from '../../../types.js';

function renderEditor(props: Partial<Parameters<typeof MemoryManualEditor>[0]> = {}) {
  const cbs = {
    onEditingChange: vi.fn(),
    onStartNew: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
  };
  const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
  const editorNameRef = createRef<HTMLInputElement>() as MutableRefObject<HTMLInputElement | null>;
  const utils = render(
    <MemoryManualEditor
      editing={null}
      busy={false}
      editorRef={editorRef}
      editorNameRef={editorNameRef}
      flash={null}
      {...cbs}
      {...props}
    />,
  );
  return { ...utils, ...cbs };
}

const newDraft: DraftEntry = { name: '', description: '', type: 'user', body: '' };

describe('MemoryManualEditor', () => {
  it('renders the summary heading and the New button; hides the form when idle', () => {
    renderEditor();
    expect(screen.getByText('Add manually')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New/ })).toBeInTheDocument();
    expect(document.querySelector('.library-card')).toBeNull();
  });

  it('fires onStartNew from the New button when idle', async () => {
    const { onStartNew } = renderEditor({ editing: null });
    await userEvent.click(screen.getByRole('button', { name: /New/ }));
    expect(onStartNew).toHaveBeenCalled();
  });

  it('disables the New button while a draft is being edited', () => {
    renderEditor({ editing: newDraft });
    expect(screen.getByRole('button', { name: /New/ })).toBeDisabled();
  });

  it('shows a flash pill for a non-pathCopied kind', () => {
    renderEditor({ flash: { kind: 'created', key: 1 } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Memory created');
  });

  it('suppresses the flash pill for the pathCopied kind', () => {
    renderEditor({ flash: { kind: 'pathCopied', key: 1 } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders no flash pill when flash is null', () => {
    renderEditor({ flash: null });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('prefills the draft from a starter chip only for a new (id-less) draft', async () => {
    const { onEditingChange } = renderEditor({ editing: newDraft });
    // Starters only render for a new (id-less) draft.
    expect(screen.getByText('Start from')).toBeInTheDocument();
    const starters = screen.getAllByRole('button').filter((b) => b.className.includes('filter-pill'));
    expect(starters.length).toBeGreaterThan(0);
    await userEvent.click(starters[0]!);
    expect(onEditingChange).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'About me', type: 'user' }),
    );
  });

  it('omits the starters row for an existing (id-bearing) draft', () => {
    renderEditor({ editing: { id: 'e1', ...newDraft, name: 'x' } });
    expect(screen.queryByText('Start from')).toBeNull();
  });

  it('reports a name edit and a type-select change', () => {
    const { onEditingChange } = renderEditor({ editing: newDraft });
    fireEvent.change(screen.getByPlaceholderText('e.g. Prefers dark mode'), {
      target: { value: 'My name' },
    });
    expect(onEditingChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'My name' }));

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'project' } });
    expect(onEditingChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'project' }));
  });

  it('reports description and body edits', () => {
    const { onEditingChange } = renderEditor({ editing: { ...newDraft, name: 'X' } });

    fireEvent.change(screen.getByPlaceholderText('Short description'), {
      target: { value: 'New description' },
    });
    expect(onEditingChange).toHaveBeenCalledWith(expect.objectContaining({ description: 'New description' }));

    fireEvent.change(screen.getByPlaceholderText('What should the assistant remember?'), {
      target: { value: 'New body' },
    });
    expect(onEditingChange).toHaveBeenCalledWith(expect.objectContaining({ body: 'New body' }));
  });

  it('disables save while the draft name is blank and enables it once filled', () => {
    const { rerender } = renderEditor({ editing: newDraft });
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    rerender(
      <MemoryManualEditor
        editing={{ ...newDraft, name: 'Filled' }}
        onEditingChange={vi.fn()}
        onStartNew={vi.fn()}
        onCancel={vi.fn()}
        onSave={vi.fn()}
        busy={false}
        editorRef={createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>}
        editorNameRef={createRef<HTMLInputElement>() as MutableRefObject<HTMLInputElement | null>}
        flash={null}
      />,
    );
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled();
  });

  it('disables save while busy even with a filled name', () => {
    renderEditor({ editing: { ...newDraft, name: 'Filled' }, busy: true });
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('fires onSave from the save button', async () => {
    const { onSave } = renderEditor({ editing: { ...newDraft, name: 'Filled' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSave).toHaveBeenCalled();
  });

  it('wires cancel and shows Save (not Create) for an existing entry', async () => {
    const { onCancel } = renderEditor({ editing: { id: 'e1', ...newDraft, name: 'x' } });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    const editorRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    const editorNameRef = createRef<HTMLInputElement>() as MutableRefObject<HTMLInputElement | null>;
    render(
      <I18nProvider dictionaries={{ fr: { 'Add manually': 'Ajouter manuellement', New: 'Nouveau' } }} initialLocale="fr">
        <MemoryManualEditor
          editing={null}
          busy={false}
          editorRef={editorRef}
          editorNameRef={editorNameRef}
          flash={null}
          onEditingChange={vi.fn()}
          onStartNew={vi.fn()}
          onCancel={vi.fn()}
          onSave={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Ajouter manuellement')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nouveau/ })).toBeInTheDocument();
  });
});
