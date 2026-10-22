import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { createFakeProjectLocationsPort } from '../../../dependencies.js';
import type { ProjectLocationsActionResult } from '../../../types.js';
import { useProjectLocationsTab } from '../../hooks/useProjectLocationsTab.js';
import type { UseProjectLocationsTabResult } from '../../hooks/useProjectLocationsTab.js';
import { ProjectLocationsTab } from '../ProjectLocationsTab.js';
import type { ProjectLocationsTabLabels } from '../ProjectLocationsTab.js';

vi.mock('../../hooks/useProjectLocationsTab.js', () => ({ useProjectLocationsTab: vi.fn() }));

const port = createFakeProjectLocationsPort();
const builtIn = { id: 'default', name: 'Default', path: '/projects', builtIn: true };
let state: UseProjectLocationsTabResult;

beforeEach(() => {
  state = {
    locations: [builtIn], drafts: [], builtIn, effectiveDefaultLocationId: 'default',
    loading: false, saving: false, result: { status: 'idle' },
    addFolder: vi.fn(), removeDraft: vi.fn(), setDefaultLocationId: vi.fn(),
  };
  vi.mocked(useProjectLocationsTab).mockImplementation(() => state);
});

describe('ProjectLocationsTab characterization', () => {
  it('resolves all static label overrides and keeps empty strings instead of falling back', () => {
    state.drafts = [{ id: 'work', path: '/work' }];
    render(<ProjectLocationsTab port={port} labels={{
      title: 'Roots', description: '', builtInLabel: 'Host root', defaultBadge: 'Chosen',
      makeDefaultLabel: 'Choose', deleteLabel: 'Remove', addFolderLabel: 'Browse', rowHint: 'Root hint',
    }} />);
    expect(screen.getByRole('heading').textContent).toBe('Roots');
    expect(screen.getByText('Host root')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Chosen' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Choose' })).not.toBeChecked();
    expect(screen.getByText('Root hint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Browse' })).toBeEnabled();
    expect(screen.queryByText('Where new projects are created and existing ones are found.')).toBeNull();
  });

  it('translates defaults independently when only some labels are supplied', () => {
    render(<I18nProvider initialLocale="fr" dictionaries={{ fr: {
      'Project locations': 'Emplacements', 'Default location': 'Racine', 'Add folder': 'Ajouter',
    } }}><ProjectLocationsTab port={port} labels={{ title: 'Host title' }} /></I18nProvider>);
    expect(screen.getByRole('heading').textContent).toBe('Host title');
    expect(screen.getByText('Racine')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeInTheDocument();
  });

  const notices: { result: ProjectLocationsActionResult; key: keyof ProjectLocationsTabLabels; fallback: string }[] = [
    { result: { status: 'no-folder-selected' }, key: 'noFolderSelectedLabel', fallback: 'No folder selected.' },
    { result: { status: 'duplicate' }, key: 'duplicateLabel', fallback: 'That folder is already a project location.' },
    { result: { status: 'saved' }, key: 'savedLabel', fallback: 'Saved.' },
    { result: { status: 'default-saved' }, key: 'defaultSavedLabel', fallback: 'Default location updated.' },
    { result: { status: 'scan-complete', imported: 2, existing: 3 }, key: 'scanCompleteTemplate', fallback: 'Imported 2, 3 already tracked.' },
  ];
  it.each(notices)('renders the fallback and overridden $key for $result.status', ({ result, key, fallback }) => {
    state.result = result;
    const { rerender } = render(<ProjectLocationsTab port={port} />);
    expect(screen.getByRole('status').textContent).toBe(fallback);
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(<ProjectLocationsTab port={port} labels={{ [key]: 'Found {imported}/{existing}' }} />);
    const expected = result.status === 'scan-complete' ? 'Found 2/3' : 'Found {imported}/{existing}';
    expect(screen.getByRole('status').textContent).toBe(expected);
    rerender(<ProjectLocationsTab port={port} labels={{ [key]: '' }} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    { status: 'save-error', key: 'saveErrorLabel', fallback: 'Could not save project locations.' },
    { status: 'scan-error', key: 'scanErrorLabel', fallback: 'Could not scan the new folder for existing projects.' },
  ] as const)('renders the fallback and overridden $key without exposing the port error', ({ status, key, fallback }) => {
    state.result = { status, message: 'Private host detail' };
    const { rerender } = render(<ProjectLocationsTab port={port} />);
    expect(screen.getByRole('alert').textContent).toBe(fallback);
    expect(screen.queryByText('Private host detail')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<ProjectLocationsTab port={port} labels={{ [key]: 'Host error' }} />);
    expect(screen.getByRole('alert').textContent).toBe('Host error');
    rerender(<ProjectLocationsTab port={port} labels={{ [key]: '' }} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders no notices or built-in card when idle without a built-in root', () => {
    state.builtIn = undefined;
    render(<ProjectLocationsTab port={port} />);
    expect(screen.queryByText('/projects')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('forwards row actions, hides the unsaved radio, and disables only mutating buttons while saving', () => {
    state.drafts = [{ id: 'work', path: '/work' }, { path: '/new' }];
    const { rerender } = render(<ProjectLocationsTab port={port} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: 'Make default' }));
    expect(state.setDefaultLocationId).toHaveBeenCalledWith('work');
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(state.addFolder).toHaveBeenCalledOnce();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!);
    expect(state.removeDraft).toHaveBeenCalledWith(1);
    state.saving = true;
    state.effectiveDefaultLocationId = 'work';
    rerender(<ProjectLocationsTab port={port} />);
    expect(screen.getByRole('button', { name: 'Add folder' })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: 'Delete' })) expect(button).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Default' })).toBeChecked();
    const builtInRadio = screen.getByRole('radio', { name: 'Make default' });
    expect(builtInRadio).toBeEnabled();
    fireEvent.click(builtInRadio);
    expect(state.setDefaultLocationId).toHaveBeenCalledWith('default');
  });
});
