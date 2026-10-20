import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabLauncherMenu, type TabLauncherMenuProps } from '../TabLauncherMenu.js';
import type { TabLauncherResultItem } from '../../../types.js';

const files: TabLauncherResultItem[] = [
  { id: 'file-1', name: 'First file', kind: 'image', iconName: 'image', isOpen: true },
  { id: 'file-2', name: 'Second file', kind: 'code' },
];
const tabs: TabLauncherResultItem[] = [
  { id: 'tab-1', name: 'First tab', kind: 'page', iconName: 'page' },
  { id: 'tab-2', name: 'Second tab', kind: 'page' },
];

afterEach(cleanup);

function renderMenu(
  required: Pick<TabLauncherMenuProps, 'files'>,
  optional: Partial<Omit<TabLauncherMenuProps, 'files'>> = {},
) {
  return render(
    <TabLauncherMenu
      anchor={document.createElement('button')}
      onOpenFile={vi.fn()}
      onClose={vi.fn()}
      {...required}
      {...optional}
    />,
  );
}

describe('TabLauncherMenu result-section characterization', () => {
  it.each([
    { files, tabs, headers: ['Open file', 'Open tabs'], names: ['First file', 'Second file', 'First tab', 'Second tab'] },
    { files, tabs: [], headers: ['Open file'], names: ['First file', 'Second file'] },
    { files: [], tabs, headers: ['Open tabs'], names: ['First tab', 'Second tab'] },
    { files: [], tabs: [], headers: [], names: [] },
  ])('renders only nonempty result sections in file-then-tab order: $headers', (scenario) => {
    renderMenu({ files: scenario.files }, { tabs: scenario.tabs });
    const dialog = screen.getByRole('dialog');
    expect(Array.from(dialog.querySelectorAll('.jini-tab-launcher-menu__section-header'), (node) => node.textContent))
      .toEqual(scenario.headers);
    const rows = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-selectable-idx]'));
    expect(rows.map((row) => row.querySelector('.jini-tab-launcher-menu__row-name')?.textContent))
      .toEqual(scenario.names);
    expect(rows.map((row) => row.dataset.selectableIdx)).toEqual(scenario.names.map((_, index) => String(index)));
    expect(within(dialog).queryByText('No files match') !== null).toBe(scenario.names.length === 0);
    expect(dialog.querySelectorAll('.jini-tab-launcher-menu__row-icon')).toHaveLength(0);
  });

  it('highlights and scrolls the flat selection across both sections, and forwards hover indices', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    try {
      renderMenu({ files }, { tabs });
      const firstFile = screen.getByRole('button', { name: 'First file Open' });
      const firstTab = screen.getByRole('button', { name: 'First tab' });
      const secondTab = screen.getByRole('button', { name: 'Second tab' });
      expect(firstFile.classList.contains('jini-tab-launcher-menu__row--selected')).toBe(true);
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowUp' });
      expect(secondTab.classList.contains('jini-tab-launcher-menu__row--selected')).toBe(true);
      expect(firstFile.classList.contains('jini-tab-launcher-menu__row--selected')).toBe(false);
      expect(scroll.mock.instances[scroll.mock.instances.length - 1]).toBe(secondTab);
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
      fireEvent.mouseEnter(firstTab);
      expect(firstTab.classList.contains('jini-tab-launcher-menu__row--selected')).toBe(true);
      expect(secondTab.classList.contains('jini-tab-launcher-menu__row--selected')).toBe(false);
      fireEvent.mouseEnter(firstFile);
      expect(firstFile.classList.contains('jini-tab-launcher-menu__row--selected')).toBe(true);
    } finally {
      scroll.mockRestore();
    }
  });

  it('forwards each result to its own opener and renders host icons in both sections', () => {
    const onOpenFile = vi.fn();
    const onOpenTab = vi.fn();
    const onClose = vi.fn();
    renderMenu({ files }, {
      tabs, onOpenFile, onOpenTab, onClose,
      renderIcon: (name) => <span>{name}</span>,
    });
    const fileRow = screen.getByRole('button', { name: 'First file Open' });
    const tabRow = screen.getByRole('button', { name: 'First tab' });
    expect(within(fileRow).getByText('image').closest('[aria-hidden]')).not.toBeNull();
    expect(within(tabRow).getByText('page').closest('[aria-hidden]')).not.toBeNull();
    fireEvent.click(fileRow);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith(files[0]);
    expect(onOpenTab).not.toHaveBeenCalled();
    fireEvent.click(tabRow);
    expect(onOpenTab).toHaveBeenCalledTimes(1);
    expect(onOpenTab).toHaveBeenCalledWith(tabs[0]);
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
