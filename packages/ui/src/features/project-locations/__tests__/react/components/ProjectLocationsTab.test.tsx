import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { createFakeProjectLocationsPort } from '@jini-ai/ui-core';
import type { ProjectLocation, ProjectLocationDraft, ProjectLocationsPort } from '@jini-ai/ui-core';
import { ProjectLocationsTab } from '../../../react/components/ProjectLocationsTab.js';

const BUILT_IN: ProjectLocation = { id: 'default', name: 'Default', path: '/home/op/projects', builtIn: true };
const EXTERNAL: ProjectLocation = { id: 'loc-1', name: 'work', path: '/home/op/work', builtIn: false };

describe('ProjectLocationsTab', () => {
  it('renders the built-in location and every configured external one', async () => {
    const port = createFakeProjectLocationsPort({ locations: [BUILT_IN, EXTERNAL] });
    render(<ProjectLocationsTab port={port} />);
    expect(await screen.findByText('/home/op/projects')).toBeInTheDocument();
    expect(screen.getByText('/home/op/work')).toBeInTheDocument();
    expect(screen.getByText('work')).toBeInTheDocument(); // locationLabel basename
  });

  it('marks the effective default location with the default badge, others with "Make default"', async () => {
    const port = createFakeProjectLocationsPort({ locations: [BUILT_IN, EXTERNAL] });
    render(<ProjectLocationsTab port={port} defaultLocationId="loc-1" />);
    await screen.findByText('/home/op/work');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getAllByText('Default')).toHaveLength(1);
    expect(screen.getAllByText('Make default')).toHaveLength(1);
  });

  it('falls back the effective default to the built-in root when the configured id no longer resolves', async () => {
    const port = createFakeProjectLocationsPort({ locations: [BUILT_IN, EXTERNAL] });
    render(<ProjectLocationsTab port={port} defaultLocationId="gone" />);
    await screen.findByText('/home/op/work');
    const builtInRadio = screen.getAllByRole('radio')[0]!;
    expect(builtInRadio).toBeChecked();
  });

  it('picking a location as default calls onDefaultLocationIdChange with that id', async () => {
    const port = createFakeProjectLocationsPort({ locations: [BUILT_IN, EXTERNAL] });
    const onChange = vi.fn();
    render(<ProjectLocationsTab port={port} defaultLocationId="default" onDefaultLocationIdChange={onChange} />);
    await screen.findByText('/home/op/work');
    const externalRadio = screen.getAllByRole('radio')[1]!;
    await userEvent.click(externalRadio);
    expect(onChange).toHaveBeenCalledWith('loc-1');
  });

  it('adds a folder: opens the picker, saves, and reports the scan result', async () => {
    const port = createFakeProjectLocationsPort({
      locations: [BUILT_IN],
      folderPicks: ['/home/op/new-project'],
    });
    render(<ProjectLocationsTab port={port} />);
    await screen.findByText('/home/op/projects');

    await userEvent.click(screen.getByRole('button', { name: /Add folder/ }));

    await waitFor(() => expect(screen.getByText('/home/op/new-project')).toBeInTheDocument());
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 0, 0 already tracked.');
  });

  it('does nothing (with a status message) when the folder picker is cancelled', async () => {
    const port = createFakeProjectLocationsPort({ locations: [BUILT_IN], folderPicks: [null] });
    render(<ProjectLocationsTab port={port} />);
    await screen.findByText('/home/op/projects');

    await userEvent.click(screen.getByRole('button', { name: /Add folder/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('No folder selected.');
  });

  it('reports a duplicate instead of saving when the picked folder is already configured', async () => {
    const port = createFakeProjectLocationsPort({
      locations: [BUILT_IN, EXTERNAL],
      folderPicks: ['/home/op/work/'], // trailing slash — still a duplicate of EXTERNAL
    });
    const saveSpy = vi.spyOn(port, 'saveLocations');
    render(<ProjectLocationsTab port={port} />);
    await screen.findByText('/home/op/work');

    await userEvent.click(screen.getByRole('button', { name: /Add folder/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('already a project location');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('removes a location: calls save with the row dropped and it disappears', async () => {
    const port = createFakeProjectLocationsPort({ locations: [BUILT_IN, EXTERNAL] });
    render(<ProjectLocationsTab port={port} />);
    await screen.findByText('/home/op/work');

    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));

    await waitFor(() => expect(screen.queryByText('/home/op/work')).not.toBeInTheDocument());
  });

  it('shows a save error and restores the removed row when the save rejects', async () => {
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN, EXTERNAL]),
      openFolderDialog: () => Promise.resolve(null),
      saveLocations: () => Promise.reject(new Error('disk full')),
    };
    render(<ProjectLocationsTab port={port} />);
    await screen.findByText('/home/op/work');

    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save project locations.');
    // The optimistic removal is rolled back once the save fails.
    expect(await screen.findByText('/home/op/work')).toBeInTheDocument();
  });

  it('corrects a stale configured default after a save removes the location it named', async () => {
    const port = createFakeProjectLocationsPort({ locations: [BUILT_IN, EXTERNAL] });
    const onChange = vi.fn();
    render(<ProjectLocationsTab port={port} defaultLocationId="loc-1" onDefaultLocationIdChange={onChange} />);
    await screen.findByText('/home/op/work');

    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('default'));
  });

  it('skips the post-add scan entirely when the port omits scanLocations', async () => {
    const port: ProjectLocationsPort = {
      fetchLocations: () => Promise.resolve([BUILT_IN]),
      openFolderDialog: () => Promise.resolve('/home/op/new-project'),
      saveLocations: (drafts: readonly ProjectLocationDraft[]) =>
        Promise.resolve([BUILT_IN, ...drafts.map((d, i) => ({ id: `new-${i}`, name: 'new-project', path: d.path }))]),
    };
    render(<ProjectLocationsTab port={port} />);
    await screen.findByText('/home/op/projects');

    await userEvent.click(screen.getByRole('button', { name: /Add folder/ }));

    await waitFor(() => expect(screen.getByText('/home/op/new-project')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', async () => {
    const port = createFakeProjectLocationsPort({ locations: [BUILT_IN] });
    render(
      <I18nProvider dictionaries={{ fr: { 'Project locations': 'Emplacements du projet' } }} initialLocale="fr">
        <ProjectLocationsTab port={port} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Emplacements du projet')).toBeInTheDocument();
  });
});
