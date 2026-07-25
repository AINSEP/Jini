// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  basename,
  DEFAULT_WORKING_DIR_LABELS,
  resolveWorkingDirLabels,
  useDismissablePanel,
  useRecentFlyout,
  useWorkingDirPicker,
  WorkingDirPicker,
} from '../../components/WorkingDirPicker.js';

// ── Pure helpers ──────────────────────────────────────────────────────────
describe('working-dir helpers', () => {
  it('basename returns the last path segment for both separators', () => {
    expect(basename('/Users/me/projects/demo')).toBe('demo');
    expect(basename('C:\\Users\\me\\demo')).toBe('demo');
    expect(basename('/a/b/c/')).toBe('c'); // trailing slash filtered out
  });

  it('basename falls back to the whole input when there is no segment', () => {
    expect(basename('')).toBe(''); // pop() is undefined -> ?? dir
    expect(basename('///')).toBe('///');
  });

  it('resolveWorkingDirLabels merges overrides onto the defaults', () => {
    expect(resolveWorkingDirLabels()).toEqual(DEFAULT_WORKING_DIR_LABELS);
    const merged = resolveWorkingDirLabels({ pick: 'Pick!', clear: 'Wipe' });
    expect(merged.pick).toBe('Pick!');
    expect(merged.clear).toBe('Wipe');
    expect(merged.recent).toBe(DEFAULT_WORKING_DIR_LABELS.recent); // untouched default
  });
});

// ── useDismissablePanel ───────────────────────────────────────────────────
describe('useDismissablePanel', () => {
  it('starts closed and toggle flips it', () => {
    const { result } = renderHook(() => useDismissablePanel());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
  });

  it('fires onOpen only on the closed→open edge', () => {
    const onOpen = vi.fn();
    const { result } = renderHook(() => useDismissablePanel(onOpen));
    act(() => result.current.toggle()); // open
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => result.current.toggle()); // close — must NOT re-fire onOpen
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('toggles without an onOpen handler', () => {
    const { result } = renderHook(() => useDismissablePanel());
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(result.current.open).toBe(true);
  });

  it('close() closes an open panel', () => {
    const { result } = renderHook(() => useDismissablePanel());
    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it('closes on an outside pointer press when no wrapper node is attached', () => {
    const { result } = renderHook(() => useDismissablePanel());
    act(() => result.current.toggle());
    // wrapRef.current is null here, so `wrapRef.current?.contains(...)` short-circuits.
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(result.current.open).toBe(false);
  });

  it('closes on Escape but ignores other keys', () => {
    const { result } = renderHook(() => useDismissablePanel());
    act(() => result.current.toggle());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
    expect(result.current.open).toBe(true); // non-Escape ignored
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.open).toBe(false);
  });
});

// ── useRecentFlyout ───────────────────────────────────────────────────────
describe('useRecentFlyout', () => {
  it('starts collapsed and show/hide/toggle drive it', () => {
    const { result } = renderHook(() => useRecentFlyout(true));
    expect(result.current.recentOpen).toBe(false);
    act(() => result.current.show());
    expect(result.current.recentOpen).toBe(true);
    act(() => result.current.hide());
    expect(result.current.recentOpen).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.recentOpen).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.recentOpen).toBe(false);
  });

  it('auto-collapses when the parent panel closes', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useRecentFlyout(open),
      { initialProps: { open: true } },
    );
    act(() => result.current.show());
    expect(result.current.recentOpen).toBe(true);
    rerender({ open: false });
    expect(result.current.recentOpen).toBe(false);
  });
});

// ── useWorkingDirPicker (orchestrator) ────────────────────────────────────
describe('useWorkingDirPicker', () => {
  it('resolves labels and each action closes the panel + forwards to the host', () => {
    const onPickDirectory = vi.fn();
    const onSelectRecent = vi.fn();
    const onClear = vi.fn();
    const { result } = renderHook(() =>
      useWorkingDirPicker({ onPickDirectory, onSelectRecent, onClear, labels: { pick: 'Pick!' } }),
    );
    expect(result.current.labels.pick).toBe('Pick!');
    expect(result.current.labels.recent).toBe('Recent folders'); // default kept

    act(() => result.current.toggle());
    act(() => result.current.pick());
    expect(onPickDirectory).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);

    act(() => result.current.toggle());
    act(() => result.current.selectRecent('/x/y'));
    expect(onSelectRecent).toHaveBeenCalledWith('/x/y');
    expect(result.current.open).toBe(false);

    act(() => result.current.toggle());
    act(() => result.current.clear());
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(result.current.open).toBe(false);
  });

  it('clear() tolerates a missing onClear handler (defensive guard)', () => {
    const { result } = renderHook(() =>
      useWorkingDirPicker({ onPickDirectory: vi.fn(), onSelectRecent: vi.fn() }),
    );
    act(() => result.current.toggle());
    expect(() => act(() => result.current.clear())).not.toThrow();
    expect(result.current.open).toBe(false);
  });

  it('exposes the recent-flyout controls', () => {
    const { result } = renderHook(() =>
      useWorkingDirPicker({ onPickDirectory: vi.fn(), onSelectRecent: vi.fn() }),
    );
    act(() => result.current.toggle());
    act(() => result.current.showRecent());
    expect(result.current.recentOpen).toBe(true);
    act(() => result.current.hideRecent());
    expect(result.current.recentOpen).toBe(false);
    act(() => result.current.toggleRecent());
    expect(result.current.recentOpen).toBe(true);
  });
});

// ── Component (dumb render) ───────────────────────────────────────────────
describe('WorkingDirPicker', () => {
  it('shows the default hint label + hint title when no directory is selected', () => {
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
      />,
    );
    const trigger = screen.getByTestId('working-dir-trigger');
    expect(trigger.textContent).toContain('Working directory');
    expect(trigger.getAttribute('title')).toBe('Select a working directory');
  });

  it('shows the basename of a selected directory and uses the full path as the title', () => {
    render(
      <WorkingDirPicker
        workingDir="/Users/me/projects/demo"
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
      />,
    );
    const trigger = screen.getByTestId('working-dir-trigger');
    expect(trigger.textContent).toContain('demo');
    expect(trigger.getAttribute('title')).toBe('/Users/me/projects/demo');
  });

  it('flags an invalid selection with the missing title + class, and applies className', () => {
    render(
      <WorkingDirPicker
        workingDir="/gone"
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
        invalid
        className="my-layout"
      />,
    );
    const trigger = screen.getByTestId('working-dir-trigger');
    expect(trigger.className).toContain('invalid');
    expect(trigger.getAttribute('title')).toBe('Directory no longer exists');
    expect(screen.getByTestId('working-dir-picker').className).toContain('my-layout');
  });

  it('opens the panel (showing "Choose folder") and fires onPickDirectory, then closes', async () => {
    const user = userEvent.setup();
    const onPickDirectory = vi.fn();
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={[]}
        onPickDirectory={onPickDirectory}
        onSelectRecent={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    expect(screen.getByTestId('working-dir-pick').textContent).toContain('Choose folder');
    expect(screen.getByTestId('working-dir-trigger')).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByTestId('working-dir-trigger')).toHaveAttribute(
      'aria-controls',
      screen.getByTestId('working-dir-panel').id,
    );
    expect(screen.getByTestId('working-dir-pick')).toHaveFocus();
    await user.click(screen.getByTestId('working-dir-pick'));
    expect(onPickDirectory).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('working-dir-panel')).toBeNull(); // picking closes
  });

  it('shows "Change folder" when a directory is already selected', async () => {
    const user = userEvent.setup();
    render(
      <WorkingDirPicker
        workingDir="/a/b"
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    expect(screen.getByTestId('working-dir-pick').textContent).toContain('Change folder');
  });

  it('shows recent directories in the recent submenu and selects one', async () => {
    const user = userEvent.setup();
    const onSelectRecent = vi.fn();
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={['/a/b', '/c/d']}
        onPickDirectory={vi.fn()}
        onSelectRecent={onSelectRecent}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    // The submenu opens on hover (matching the mouse's natural path onto the row).
    await user.hover(screen.getByTestId('working-dir-recent'));
    // Plain fireEvent here (not user.click): userEvent's click simulates a pointer
    // move onto the target first, and jsdom's zero-size layout boxes make that read
    // as leaving the hover-tracked row, closing the flyout before the click lands.
    fireEvent.click(screen.getByText('b'));
    expect(onSelectRecent).toHaveBeenCalledWith('/a/b');
    expect(screen.queryByTestId('working-dir-panel')).toBeNull(); // selecting closes
  });

  it('shows the empty-state label when there are no recent folders (toggled open)', async () => {
    const user = userEvent.setup();
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    // Hover opens the flyout via the row's onMouseEnter (showRecent). Clicking
    // the row button instead would toggle it shut, since the hover that
    // userEvent performs on the way in already opened it.
    await user.hover(screen.getByTestId('working-dir-recent'));
    expect(screen.getByTestId('working-dir-recent-list').textContent).toBe('No recent folders');
  });

  it('collapses the recent flyout on mouse-leave of the submenu row', async () => {
    const user = userEvent.setup();
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={['/a/b']}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    await user.hover(screen.getByTestId('working-dir-recent'));
    expect(screen.getByTestId('working-dir-recent-list')).toBeTruthy();
    await user.unhover(screen.getByTestId('working-dir-recent'));
    expect(screen.queryByTestId('working-dir-recent-list')).toBeNull();
  });

  it('renders both panel and flyout with the "up" class when placement="up"', async () => {
    const user = userEvent.setup();
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={['/a/b']}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
        placement="up"
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    expect(screen.getByTestId('working-dir-panel').className).toContain('up');
    await user.hover(screen.getByTestId('working-dir-recent')); // onMouseEnter -> showRecent
    expect(screen.getByTestId('working-dir-recent-list').className).toContain('up');
  });

  it('only shows the clear item when both workingDir and onClear are set, and clears', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();

    // workingDir set, but no onClear -> right operand falsy -> hidden.
    const { rerender } = render(
      <WorkingDirPicker
        workingDir="/a/b"
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    expect(screen.queryByTestId('working-dir-clear')).toBeNull();
    await user.click(screen.getByTestId('working-dir-trigger')); // close

    // workingDir null -> left operand falsy -> hidden even with onClear.
    rerender(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    expect(screen.queryByTestId('working-dir-clear')).toBeNull();
    await user.click(screen.getByTestId('working-dir-trigger')); // close

    // both set -> shown; clicking clears + closes.
    rerender(
      <WorkingDirPicker
        workingDir="/a/b"
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    await user.click(screen.getByTestId('working-dir-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('working-dir-panel')).toBeNull();
  });

  it('stays open on a pointer press inside the wrapper, closes on one outside', async () => {
    const user = userEvent.setup();
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    // Inside the wrapper -> contains() true -> stays open.
    fireEvent.mouseDown(screen.getByTestId('working-dir-panel'));
    expect(screen.getByTestId('working-dir-panel')).toBeTruthy();
    // Outside the wrapper -> contains() false -> closes.
    fireEvent.mouseDown(outside);
    expect(screen.queryByTestId('working-dir-panel')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('working-dir-trigger')).toHaveFocus();
    });
    outside.remove();
  });

  it('supports menu arrow navigation and returns trigger focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('working-dir-trigger'));
    expect(screen.getByTestId('working-dir-panel')).toBeTruthy();
    expect(screen.getByTestId('working-dir-pick')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('working-dir-pick'), { key: 'ArrowDown' });
    expect(screen.getByTestId('working-dir-recent')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('working-dir-recent'), { key: 'Home' });
    expect(screen.getByTestId('working-dir-pick')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('working-dir-pick'), { key: 'End' });
    expect(screen.getByTestId('working-dir-recent')).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('working-dir-recent'), { key: 'ArrowUp' });
    expect(screen.getByTestId('working-dir-pick')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('working-dir-panel')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('working-dir-trigger')).toHaveFocus();
    });
  });

  it('accepts label overrides', () => {
    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
        labels={{ trigger: 'Choisir un dossier' }}
      />,
    );
    expect(screen.getByTestId('working-dir-trigger').textContent).toContain('Choisir un dossier');
  });

  it('uses custom useWorkingDirPicker hook prop to render a forced open state (state 1)', () => {
    const mockPick = vi.fn();
    const customHook = () => ({
      open: true,
      recentOpen: false,
      wrapRef: { current: null },
      labels: { ...DEFAULT_WORKING_DIR_LABELS, pick: 'Choose Custom Folder' },
      toggle: vi.fn(),
      close: vi.fn(),
      pick: mockPick,
      selectRecent: vi.fn(),
      clear: vi.fn(),
      showRecent: vi.fn(),
      hideRecent: vi.fn(),
      toggleRecent: vi.fn(),
    });

    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={[]}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
        useWorkingDirPicker={customHook}
      />,
    );

    const panel = screen.getByTestId('working-dir-panel');
    expect(panel).toBeTruthy();
    expect(screen.getByTestId('working-dir-pick').textContent).toBe('Choose Custom Folder');
    expect(screen.queryByTestId('working-dir-recent-list')).toBeNull();

    fireEvent.click(screen.getByTestId('working-dir-pick'));
    expect(mockPick).toHaveBeenCalledTimes(1);
  });

  it('uses custom useWorkingDirPicker hook prop to render a forced open panel + open recent list (state 2)', () => {
    const mockSelectRecent = vi.fn();
    const customHook = () => ({
      open: true,
      recentOpen: true,
      wrapRef: { current: null },
      labels: DEFAULT_WORKING_DIR_LABELS,
      toggle: vi.fn(),
      close: vi.fn(),
      pick: vi.fn(),
      selectRecent: mockSelectRecent,
      clear: vi.fn(),
      showRecent: vi.fn(),
      hideRecent: vi.fn(),
      toggleRecent: vi.fn(),
    });

    render(
      <WorkingDirPicker
        workingDir={null}
        recentDirs={['/Users/test/project1', '/Users/test/project2']}
        onPickDirectory={vi.fn()}
        onSelectRecent={vi.fn()}
        useWorkingDirPicker={customHook}
      />,
    );

    expect(screen.getByTestId('working-dir-panel')).toBeTruthy();
    const flyout = screen.getByTestId('working-dir-recent-list');
    expect(flyout).toBeTruthy();
    expect(screen.getByText('project1')).toBeTruthy();
    expect(screen.getByText('project2')).toBeTruthy();

    fireEvent.click(screen.getByText('project1'));
    expect(mockSelectRecent).toHaveBeenCalledWith('/Users/test/project1');
  });
});
