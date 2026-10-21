import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import type { VersionManagerDependencies, VersionManagerPort } from '../../../ports.js';
import type { VersionManagerFileRef, VersionRecord, VersionRestoreResult } from '../../../types.js';
import { VersionManagerModal } from '../../../react/components/VersionManagerModal.js';

const FILE_REF: VersionManagerFileRef = { scopeId: 'proj-1', name: 'index.html' };

function makeVersion(overrides: Partial<VersionRecord> & { id: string; version: number }): VersionRecord {
  return { createdAt: Date.UTC(2026, 0, 1), current: false, source: 'ai', ...overrides };
}

function createDeps(overrides: {
  versions?: VersionRecord[];
  content?: Map<string, string>;
  restoreResult?: VersionRestoreResult<VersionRecord> | null;
  openPreviewInNewTab?: VersionManagerPort<VersionRecord>['openPreviewInNewTab'];
} = {}): VersionManagerDependencies<VersionRecord> {
  const content = overrides.content ?? new Map<string, string>();
  const port: VersionManagerPort<VersionRecord> = {
    listVersions: vi.fn(async () => overrides.versions ?? []),
    fetchVersionContent: vi.fn(async (_fileRef, versionId) => content.get(versionId) ?? null),
    restoreVersion: vi.fn(async () => (overrides.restoreResult === undefined ? {} : overrides.restoreResult)),
    resolvePreviewDocument: vi.fn((_fileRef, versionContent) => versionContent),
    ...(overrides.openPreviewInNewTab ? { openPreviewInNewTab: overrides.openPreviewInNewTab } : {}),
  };
  return { versions: port, clipboard: { copyText: vi.fn(async () => true) } };
}

describe('VersionManagerModal', () => {
  it('renders the dialog and version count once loaded', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const v2 = makeVersion({ id: 'v2', version: 2 });
    const dependencies = createDeps({ versions: [v1, v2], content: new Map([['v2', '<p>v2</p>']]) });
    render(
      <VersionManagerModal
        fileRef={FILE_REF}
        currentContent="<p>current</p>"
        onClose={vi.fn()}
        onRestored={vi.fn()}
        dependencies={dependencies}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Version history' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('2 versions')).toBeInTheDocument());
  });

  it('shows "1 version" for a single-version file', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const dependencies = createDeps({ versions: [v1] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByText('1 version')).toBeInTheDocument());
  });

  it('closes on backdrop click', async () => {
    const onClose = vi.fn();
    const dependencies = createDeps({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={onClose} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    const backdrop = document.querySelector('.jini-version-modal-backdrop') as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the dialog', async () => {
    const onClose = vi.fn();
    const dependencies = createDeps({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={onClose} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByText('1 version')).toBeInTheDocument());
    await userEvent.click(screen.getByText('1 version'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on the Close button and on Escape', async () => {
    const onClose = vi.fn();
    const dependencies = createDeps({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={onClose} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('selecting a version updates the preview and restore availability', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const v2 = makeVersion({ id: 'v2', version: 2, label: 'Older draft' });
    const dependencies = createDeps({ versions: [v1, v2], content: new Map([['v2', '<p>v2</p>']]) });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>current</p>" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByText('Older draft')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Older draft'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore this version' })).toBeEnabled());
  });

  it('restoring a version calls onRestored and closes the modal', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const v2 = makeVersion({ id: 'v2', version: 2, label: 'Older draft' });
    const restoredVersion = makeVersion({ id: 'v3', version: 3, source: 'restore' });
    const dependencies = createDeps({
      versions: [v1, v2],
      content: new Map([['v2', '<p>v2</p>']]),
      restoreResult: { version: restoredVersion },
    });
    const onRestored = vi.fn();
    const onClose = vi.fn();
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>current</p>" onClose={onClose} onRestored={onRestored} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByText('Older draft')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Older draft'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore this version' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith('<p>v2</p>', restoredVersion));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not render an "Open" button when the port omits openPreviewInNewTab', async () => {
    const dependencies = createDeps({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByText('1 version')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Open in new tab' })).not.toBeInTheDocument();
  });

  it('renders an "Open" button and calls the port when provided', async () => {
    const openPreviewInNewTab = vi.fn();
    const v1 = makeVersion({ id: 'v1', version: 1, current: true });
    const dependencies = createDeps({ versions: [v1], openPreviewInNewTab });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open in new tab' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Open in new tab' }));
    expect(openPreviewInNewTab).toHaveBeenCalledWith(FILE_REF, '<p>x</p>', `${FILE_REF.name} · v1`);
  });

  it('changing the viewport re-renders the preview frame with the new preset', async () => {
    const dependencies = createDeps({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByText('1 version')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Mobile' }));
    const viewportEl = document.querySelector('.jini-preview-viewport') as HTMLElement;
    await waitFor(() => expect(viewportEl.style.getPropertyValue('--preview-viewport-width')).toBe('390px'));
  });

  it('shows the restored-from badge for a restored version', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1 });
    const v2 = makeVersion({ id: 'v2', version: 2, current: true, source: 'restore', restoreFromVersionId: 'v1' });
    const dependencies = createDeps({ versions: [v1, v2] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getAllByText('Restored from v1').length).toBeGreaterThan(0));
  });

  it('renders translated strings end-to-end under I18nProvider with a translated dictionary', async () => {
    const dependencies = createDeps({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            'Version history': 'Historique des versions',
            Close: 'Fermer',
            Current: 'Actuelle',
            'AI generated': 'Généré par IA',
            '{count} versions': '{count} versions',
            '1 version': '1 version',
          },
        }}
        initialLocale="fr"
      >
        <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />
      </I18nProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Historique des versions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('Actuelle').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Généré par IA').length).toBeGreaterThan(0);
  });

  it('accepts a custom viewportPresets list', async () => {
    const dependencies = createDeps({ versions: [makeVersion({ id: 'v1', version: 1, current: true })] });
    const customPresets = [{ id: 'wide', label: 'Wide', width: 1600, height: 900 }];
    render(
      <VersionManagerModal
        fileRef={FILE_REF}
        currentContent="<p>x</p>"
        onClose={vi.fn()}
        onRestored={vi.fn()}
        dependencies={dependencies}
        viewportPresets={customPresets}
      />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Wide' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Desktop' })).not.toBeInTheDocument();
  });

  it('shows the selected version prompt and copies it via the injected clipboard port', async () => {
    const v1 = makeVersion({ id: 'v1', version: 1, current: true, prompt: '  make it blue  ' });
    const dependencies = createDeps({ versions: [v1] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prompt' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    expect(within(screen.getByRole('region')).getByText('make it blue')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(dependencies.clipboard.copyText).toHaveBeenCalledWith('make it blue');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
  });

  it('pressing Escape while the Prompt popover is open closes only the popover, not the modal', async () => {
    const onClose = vi.fn();
    const v1 = makeVersion({ id: 'v1', version: 1, current: true, prompt: 'make it blue' });
    const dependencies = createDeps({ versions: [v1] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="<p>x</p>" onClose={onClose} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prompt' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    expect(screen.getByRole('region')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Version history' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('VersionManagerModal with useVersionManager hook override', () => {
  it('renders with injected hook controller state 1 (empty versions / searching)', () => {
    const mockSetSearch = vi.fn();
    const customHook = () => ({
      versions: [],
      visibleVersions: [],
      versionById: new Map(),
      selectedVersion: null,
      selectedId: null,
      selectVersion: vi.fn(),
      prefetchVersion: vi.fn(),
      restoredFrom: vi.fn(() => null),
      loading: false,
      loadingContent: false,
      error: null,
      search: 'nonexistent',
      setSearch: mockSetSearch,
      showSearch: true,
      selectedContent: null,
      previewDocument: '',
      frameReady: true,
      markFrameLoaded: vi.fn(),
      restoring: false,
      restoreDisabled: true,
      restore: vi.fn(),
      openInNewTab: null,
      viewportPresets: [{ id: 'desktop', label: 'Desktop', width: 1280, height: 800 }],
      viewport: 'desktop',
      setViewport: vi.fn(),
      describeVersion: vi.fn(() => ''),
    });

    render(
      <VersionManagerModal
        fileRef={FILE_REF}
        currentContent="<p>hello</p>"
        onClose={vi.fn()}
        onRestored={vi.fn()}
        useVersionManager={customHook as any}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('0 versions')).toBeInTheDocument();
    // Exercises `showSearch: true`: the search box only renders at all when
    // the controller says to show it.
    expect(screen.getByRole('searchbox')).toHaveValue('nonexistent');
  });

  it('renders with injected hook controller state 2 (selected non-current version with prompt and restore button)', () => {
    const mockSelectVersion = vi.fn();
    const mockRestore = vi.fn();
    const v2: any = {
      id: 'v2',
      fileId: 'file-1',
      version: 2,
      createdAt: '2026-07-22T10:00:00Z',
      source: 'ai',
      current: false,
      prompt: 'Injected Prompt text',
    };

    const customHook = () => ({
      versions: [v2],
      visibleVersions: [v2],
      versionById: new Map([['v2', v2]]),
      selectedVersion: v2,
      selectedId: 'v2',
      selectVersion: mockSelectVersion,
      prefetchVersion: vi.fn(),
      restoredFrom: vi.fn(() => null),
      loading: false,
      loadingContent: false,
      error: null,
      search: '',
      setSearch: vi.fn(),
      showSearch: false,
      selectedContent: '<h1>Injected Content</h1>',
      previewDocument: '<h1>Injected Content</h1>',
      frameReady: true,
      markFrameLoaded: vi.fn(),
      restoring: false,
      restoreDisabled: false,
      restore: mockRestore,
      openInNewTab: null,
      viewportPresets: [{ id: 'mobile', label: 'Mobile', width: 375, height: 667 }],
      viewport: 'mobile',
      setViewport: vi.fn(),
      describeVersion: vi.fn(() => ''),
    });

    render(
      <VersionManagerModal
        fileRef={FILE_REF}
        currentContent="<h1>Injected Content</h1>"
        onClose={vi.fn()}
        onRestored={vi.fn()}
        useVersionManager={customHook as any}
      />,
    );

    expect(screen.getByRole('button', { name: 'Prompt' })).toBeEnabled();
    const restoreBtn = screen.getByRole('button', { name: 'Restore this version' });
    expect(restoreBtn).toBeInTheDocument();
    fireEvent.click(restoreBtn);

    expect(screen.getByRole('dialog', { name: 'Restore this version?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });
});

describe('VersionManagerModal metadata characterization (L204)', () => {
  it('uses the file name and disables prompt with no selected version', async () => {
    const dependencies = createDeps({ versions: [] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent={null} onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByText('0 versions')).toBeInTheDocument());
    expect(screen.getByText(FILE_REF.name)).toHaveClass('jini-version-selected-date');
    expect(screen.getByRole('button', { name: 'Prompt' })).toBeDisabled();
    expect(screen.queryByText('Current')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument();
  });

  it.each([null, undefined, '   '])('shows the empty-prompt message for prompt %s', async (prompt) => {
    const version = makeVersion({ id: 'v1', version: 1, current: true, prompt });
    const dependencies = createDeps({ versions: [version] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="body" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prompt' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Prompt' }));
    expect(within(screen.getByRole('region')).getByText('This version has no recorded prompt.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('updates current, source and restored-from badges when selection changes', async () => {
    const original = makeVersion({ id: 'original', version: 1, source: 'manual', label: 'Original draft' });
    const restored = makeVersion({ id: 'restored', version: 2, source: 'restore', current: true, restoreFromVersionId: original.id });
    const dependencies = createDeps({ versions: [original, restored], content: new Map([[original.id, 'original body']]) });
    const { container } = render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="restored body" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    // The portal is rendered into document.body, outside the render container.
    expect(container).toBeEmptyDOMElement();
    const metadata = document.querySelector('.jini-version-meta');
    if (!(metadata instanceof HTMLElement)) throw new Error('Missing modal metadata');
    await waitFor(() => expect(within(metadata).getByText('Current')).toBeInTheDocument());
    expect(within(metadata).getByText('Restored from v1')).toBeInTheDocument();
    expect(within(metadata).getByText('Restored')).toHaveClass('restore');
    await userEvent.click(screen.getByText('Original draft'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore this version' })).toBeEnabled());
    expect(within(metadata).queryByText('Current')).not.toBeInTheDocument();
    expect(within(metadata).queryByText('Restored from v1')).not.toBeInTheDocument();
    expect(within(metadata).getByText('Manual')).toHaveClass('manual');
  });

  it('omits a restored-from badge if the referenced version is absent', async () => {
    const version = makeVersion({ id: 'v2', version: 2, current: true, source: 'restore', restoreFromVersionId: 'missing' });
    const dependencies = createDeps({ versions: [version] });
    render(
      <VersionManagerModal fileRef={FILE_REF} currentContent="body" onClose={vi.fn()} onRestored={vi.fn()} dependencies={dependencies} />,
    );
    await waitFor(() => expect(screen.getByText('1 version')).toBeInTheDocument());
    // The list resolves before the selected version's cached content populates the preview.
    expect(await screen.findByTitle(`${FILE_REF.name} · v2`)).toBeInTheDocument();
    expect(screen.queryByText(/Restored from v/)).not.toBeInTheDocument();
  });
});
