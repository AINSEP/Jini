// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TabLauncherMenu, type TabLauncherMenuProps } from './TabLauncherMenu.js';
import { I18nProvider, type useT } from '../../../i18n/index.js';
import type { TabLauncherAction, TabLauncherResultItem } from '../../types.js';

beforeAll(() => {
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => {};
  }
});

const files: TabLauncherResultItem[] = [
  { id: 'f1', name: 'apple.png', kind: 'image', meta: '12 KB', isOpen: true },
  { id: 'f2', name: 'index.html', kind: 'code' },
];
const tabs: TabLauncherResultItem[] = [{ id: 't1', name: 'Design system', kind: 'design-system' }];

type HarnessProps = Omit<TabLauncherMenuProps, 'anchor' | 'files' | 'onOpenFile' | 'onClose'> & {
  files?: TabLauncherResultItem[];
  onOpenFile?: TabLauncherMenuProps['onOpenFile'];
  onClose?: TabLauncherMenuProps['onClose'];
};

function Harness({ files: propsFiles = files, onOpenFile = vi.fn(), onClose = vi.fn(), ...rest }: HarnessProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div>
      <button ref={setAnchor}>+</button>
      {anchor ? (
        <TabLauncherMenu anchor={anchor} files={propsFiles} onOpenFile={onOpenFile} onClose={onClose} {...rest} />
      ) : null}
    </div>
  );
}

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

describe('TabLauncherMenu', () => {
  it('renders nothing until an anchor is available, then renders via a portal to document.body', () => {
    render(<Harness />);
    expect(document.body.querySelector('.jini-tab-launcher-menu')).not.toBeNull();
  });

  it('renders file results with meta and an open badge', () => {
    render(<Harness />);
    expect(screen.getByText('apple.png')).toBeInTheDocument();
    expect(screen.getByText('12 KB')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('filters files by typed query', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('textbox'), 'apple');
    expect(screen.getByText('apple.png')).toBeInTheDocument();
    expect(screen.queryByText('index.html')).not.toBeInTheDocument();
  });

  it('filters by a kind chip, and the "All files" chip resets the filter', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText('code'));
    expect(screen.queryByText('apple.png')).not.toBeInTheDocument();
    expect(screen.getByText('index.html')).toBeInTheDocument();

    await userEvent.click(screen.getByText('All files'));
    expect(screen.getByText('apple.png')).toBeInTheDocument();
    expect(screen.getByText('index.html')).toBeInTheDocument();
  });

  it('renders the tabs section and excludes it once a kind filter is active', async () => {
    render(<Harness tabs={tabs} />);
    expect(screen.getByText('Design system')).toBeInTheDocument();
    await userEvent.click(screen.getByText('image'));
    expect(screen.queryByText('Design system')).not.toBeInTheDocument();
  });

  it('renders a host-supplied search icon via renderSearchIcon', () => {
    render(<Harness renderSearchIcon={() => <span data-testid="search-icon" />} />);
    expect(screen.getByTestId('search-icon')).toBeInTheDocument();
  });

  it('omits the filter chips row entirely when there are no files at all', () => {
    const actions: TabLauncherAction[] = [{ id: 'a1', label: 'New Terminal', run: vi.fn() }];
    render(<Harness files={[]} actions={actions} />);
    expect(screen.queryByText('All files')).not.toBeInTheDocument();
  });

  it('renders the create-new actions section', () => {
    const actions: TabLauncherAction[] = [{ id: 'a1', label: 'New Terminal', run: vi.fn() }];
    render(<Harness actions={actions} />);
    expect(screen.getByText('Create new')).toBeInTheDocument();
    expect(screen.getByText('New Terminal')).toBeInTheDocument();
  });

  it('shows a no-matches message when nothing matches', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('textbox'), 'zzz-nope');
    expect(screen.getByText('No files match')).toBeInTheDocument();
  });

  it('selects a file on click', async () => {
    const onOpenFile = vi.fn();
    const onClose = vi.fn();
    render(<Harness onOpenFile={onOpenFile} onClose={onClose} />);
    await userEvent.click(screen.getByText('apple.png'));
    expect(onOpenFile).toHaveBeenCalledWith(files[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selects a tab on click', async () => {
    const onOpenTab = vi.fn();
    render(<Harness tabs={tabs} onOpenTab={onOpenTab} />);
    await userEvent.click(screen.getByText('Design system'));
    expect(onOpenTab).toHaveBeenCalledWith(tabs[0]);
  });

  it('runs an action on click', async () => {
    const run = vi.fn();
    const actions: TabLauncherAction[] = [{ id: 'a1', label: 'New Terminal', run }];
    render(<Harness actions={actions} />);
    await userEvent.click(screen.getByText('New Terminal'));
    expect(run).toHaveBeenCalled();
  });

  it('does not close on a click inside the menu, but closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on an outside click', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    await userEvent.click(outside);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders translated placeholder and section headers end-to-end under an I18nProvider', () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            'Search files…': 'Rechercher des fichiers…',
            'Open file': 'Ouvrir un fichier',
            'All files': 'Tous les fichiers',
          },
        }}
        initialLocale="fr"
      >
        <Harness />
      </I18nProvider>,
    );
    expect(screen.getByPlaceholderText('Rechercher des fichiers…')).toBeInTheDocument();
    expect(screen.getByText('Ouvrir un fichier')).toBeInTheDocument();
    expect(screen.getByText('Tous les fichiers')).toBeInTheDocument();
  });
});

describe('TabLauncherMenu 4-pattern hook override test suite', () => {
  const dummyAnchor = document.createElement('button');

  it('Pattern 1 — State 1: Closed menu state (no position) via hook override', () => {
    const customHook = () => ({
      position: null,
      containerRef: { current: null },
      query: '',
      setQuery: vi.fn(),
      kindFilter: '*',
      setKindFilter: vi.fn(),
      presentKinds: [],
      actions: [],
      fileResults: [],
      tabResults: [],
      selected: 0,
      setSelected: vi.fn(),
      selectFile: vi.fn(),
      selectTab: vi.fn(),
      runAction: vi.fn(),
      handleInputKeyDown: vi.fn(),
    });

    render(
      <TabLauncherMenu
        files={files}
        anchor={dummyAnchor}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        useTabLauncherMenu={customHook as any}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Pattern 2 — State 2: Open menu with file results state via hook override', () => {
    const customHook = () => ({
      position: { top: 100, left: 100 },
      containerRef: { current: null },
      query: 'apple',
      setQuery: vi.fn(),
      kindFilter: '*',
      setKindFilter: vi.fn(),
      presentKinds: ['image'],
      actions: [],
      fileResults: [files[0]!],
      tabResults: [],
      selected: 0,
      setSelected: vi.fn(),
      selectFile: vi.fn(),
      selectTab: vi.fn(),
      runAction: vi.fn(),
      handleInputKeyDown: vi.fn(),
    });

    render(
      <TabLauncherMenu
        files={files}
        anchor={dummyAnchor}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        useTabLauncherMenu={customHook as any}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('apple.png')).toBeInTheDocument();
  });

  it('Pattern 3 — State 3: Empty results match state via hook override', () => {
    const customHook = () => ({
      position: { top: 100, left: 100 },
      containerRef: { current: null },
      query: 'nonexistent',
      setQuery: vi.fn(),
      kindFilter: '*',
      setKindFilter: vi.fn(),
      presentKinds: [],
      actions: [],
      fileResults: [],
      tabResults: [],
      selected: 0,
      setSelected: vi.fn(),
      selectFile: vi.fn(),
      selectTab: vi.fn(),
      runAction: vi.fn(),
      handleInputKeyDown: vi.fn(),
    });

    render(
      <TabLauncherMenu
        files={files}
        anchor={dummyAnchor}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        useTabLauncherMenu={customHook as any}
      />,
    );

    expect(screen.getByText('No files match')).toBeInTheDocument();
  });

  it('Pattern 4 — State 4: Dynamic search input transition walkthrough using React useState inside test harness', () => {
    render(<Harness />);

    const input = screen.getByRole('textbox');
    expect(screen.getByText('apple.png')).toBeInTheDocument();
    expect(screen.getByText('index.html')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'apple' } });

    expect(screen.getByText('apple.png')).toBeInTheDocument();
    expect(screen.queryByText('index.html')).toBeNull();
  });

  it('renders the translator supplied through useTHook', () => {
    const anchor = document.body.appendChild(document.createElement('button'));
    render(<TabLauncherMenu anchor={anchor} files={files} onOpenFile={vi.fn()} onClose={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByRole('dialog', { name: '«New tab»' })).toBeInTheDocument();
  });
});
