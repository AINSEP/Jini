// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLanguageMenuDismissKey,
  isOutsideLanguageMenu,
  LanguageMenu,
  languageMenuItemClassName,
  languageMenuPillClassName,
  languageMenuPopoverClassName,
  resolveActiveLocaleLabel,
  useActiveLocaleLabel,
  useLanguageMenu,
  useLanguageMenuDisclosure,
  useLanguageMenuDismiss,
} from '../../components/LanguageMenu.js';

const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

// ---------------------------------------------------------------------------
// Pure helpers — no rendering required.
// ---------------------------------------------------------------------------

describe('LanguageMenu helpers', () => {
  it('resolveActiveLocaleLabel returns the matching label, else the raw code', () => {
    expect(resolveActiveLocaleLabel(LOCALES, 'ja')).toBe('日本語');
    // Unknown code falls back to the code itself.
    expect(resolveActiveLocaleLabel(LOCALES, 'fr')).toBe('fr');
    expect(resolveActiveLocaleLabel([], 'en')).toBe('en');
  });

  it('isLanguageMenuDismissKey is true only for Escape', () => {
    expect(isLanguageMenuDismissKey('Escape')).toBe(true);
    expect(isLanguageMenuDismissKey('Enter')).toBe(false);
    expect(isLanguageMenuDismissKey('a')).toBe(false);
  });

  it('isOutsideLanguageMenu treats a missing container as not-outside', () => {
    expect(isOutsideLanguageMenu(null, document.body)).toBe(false);
  });

  it('isOutsideLanguageMenu is false for a contained target and true for an outside one', () => {
    const container = document.createElement('div');
    const inner = document.createElement('span');
    container.appendChild(inner);
    document.body.appendChild(container);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    expect(isOutsideLanguageMenu(container, inner)).toBe(false);
    expect(isOutsideLanguageMenu(container, container)).toBe(false);
    expect(isOutsideLanguageMenu(container, outside)).toBe(true);
    expect(isOutsideLanguageMenu(container, null)).toBe(true);
    container.remove();
    outside.remove();
  });

  it('languageMenuPillClassName appends the compact modifier only when compact', () => {
    expect(languageMenuPillClassName(false)).toBe('foot-pill lang-pill');
    expect(languageMenuPillClassName(true)).toBe('foot-pill lang-pill lang-pill--compact');
  });

  it('languageMenuPopoverClassName reflects placement, compact, and align', () => {
    expect(languageMenuPopoverClassName('up', false, 'start')).toBe(
      'lang-menu-popover lang-menu-popover--up lang-menu-popover--align-start',
    );
    expect(languageMenuPopoverClassName('down', true, 'end')).toBe(
      'lang-menu-popover lang-menu-popover--down lang-menu-popover--compact lang-menu-popover--align-end',
    );
  });

  it('languageMenuItemClassName marks the active item', () => {
    expect(languageMenuItemClassName(false)).toBe('lang-menu-item');
    expect(languageMenuItemClassName(true)).toBe('lang-menu-item active');
  });
});

// ---------------------------------------------------------------------------
// Hooks — via renderHook, isolated from the rendered component.
// ---------------------------------------------------------------------------

describe('useLanguageMenuDisclosure', () => {
  it('starts closed and toggles/closes', () => {
    const { result } = renderHook(() => useLanguageMenuDisclosure());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });
});

describe('useActiveLocaleLabel', () => {
  it('derives the active label and recomputes when the locale changes', () => {
    const { result, rerender } = renderHook(({ locale }) => useActiveLocaleLabel(LOCALES, locale), {
      initialProps: { locale: 'en' },
    });
    expect(result.current).toBe('English');
    rerender({ locale: 'ja' });
    expect(result.current).toBe('日本語');
    rerender({ locale: 'de' });
    expect(result.current).toBe('de');
  });
});

describe('useLanguageMenuDismiss', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const setup = (open: boolean) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onDismiss = vi.fn();
    const ref = { current: container as HTMLElement | null };
    renderHook(() => useLanguageMenuDismiss({ open, onDismiss, containerRef: ref }));
    return { container, onDismiss };
  };

  it('does nothing while closed', () => {
    const { onDismiss } = setup(false);
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on an outside mousedown but not an inside one', () => {
    const { container, onDismiss } = setup(true);
    act(() => container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onDismiss).not.toHaveBeenCalled(); // inside
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onDismiss).toHaveBeenCalledTimes(1); // outside
  });

  it('dismisses on Escape but ignores other keys', () => {
    const { onDismiss } = setup(true);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('useLanguageMenu', () => {
  it('exposes disclosure, a container ref, and the active label', () => {
    const { result } = renderHook(() => useLanguageMenu(LOCALES, 'ja'));
    expect(result.current.open).toBe(false);
    expect(result.current.activeLabel).toBe('日本語');
    expect(result.current.containerRef.current).toBeNull();
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Component — the dumb render.
// ---------------------------------------------------------------------------

describe('LanguageMenu', () => {
  it('shows the active locale label on the trigger', () => {
    render(<LanguageMenu locales={LOCALES} locale="en" onLocaleChange={vi.fn()} />);
    expect(screen.getByTitle('English')).toBeTruthy();
  });

  it('opens the popover and lists every supplied locale', async () => {
    const user = userEvent.setup();
    render(<LanguageMenu locales={LOCALES} locale="en" onLocaleChange={vi.fn()} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByText('日本語')).toBeTruthy();
  });

  it('renders a check glyph on the active option and none on the others', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LanguageMenu locales={LOCALES} locale="en" onLocaleChange={vi.fn()} />,
    );
    await user.click(screen.getByRole('button'));
    expect(container.querySelectorAll('.lang-menu-check')).toHaveLength(1);
    // "English" also shows on the trigger, so scope the lookup to the menu.
    const menu = screen.getByRole('menu');
    const active = within(menu).getByText('English').closest('button')!;
    expect(active).toHaveAttribute('aria-checked', 'true');
    const inactive = within(menu).getByText('日本語').closest('button')!;
    expect(inactive).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onLocaleChange and closes when an option is picked', async () => {
    const user = userEvent.setup();
    const onLocaleChange = vi.fn();
    render(<LanguageMenu locales={LOCALES} locale="en" onLocaleChange={onLocaleChange} />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('日本語'));
    expect(onLocaleChange).toHaveBeenCalledWith('ja');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<LanguageMenu locales={LOCALES} locale="en" onLocaleChange={vi.fn()} />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stays open on a non-Escape key and on an inside mousedown', () => {
    const { container } = render(
      <LanguageMenu locales={LOCALES} locale="en" onLocaleChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /english/i }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByRole('menu')).toBeTruthy();
    // mousedown inside the wrap must not close it.
    fireEvent.mouseDown(container.querySelector('.lang-menu-wrap')!);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on an outside mousedown', () => {
    render(
      <div>
        <button data-testid="outside" type="button">
          outside
        </button>
        <LanguageMenu locales={LOCALES} locale="en" onLocaleChange={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getAllByRole('button')[1]!);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders the compact variant: an aria-labelled icon pill with no inline label or chevron', () => {
    const { container } = render(
      <LanguageMenu
        locales={LOCALES}
        locale="ja"
        onLocaleChange={vi.fn()}
        compact
        placement="down"
        align="end"
      />,
    );
    const trigger = screen.getByRole('button');
    expect(trigger.className).toContain('lang-pill--compact');
    expect(trigger).toHaveAttribute('aria-label', '日本語');
    // Compact hides the inline label span + chevron.
    expect(container.querySelector('.lang-menu-wrap > button > span')).toBeNull();
    // The popover reflects the down/compact/end modifiers.
    fireEvent.click(trigger);
    const popover = container.querySelector('.lang-menu-popover')!;
    expect(popover.className).toBe(
      'lang-menu-popover lang-menu-popover--down lang-menu-popover--compact lang-menu-popover--align-end',
    );
  });
});

describe('LanguageMenu with hook override prop', () => {
  it('uses useLanguageMenu hook prop to render a forced closed state (state 1)', () => {
    const mockToggle = vi.fn();
    const customHook = () => ({
      open: false,
      containerRef: { current: null },
      activeLabel: 'Français (Injected)',
      toggle: mockToggle,
      close: vi.fn(),
    });

    render(
      <LanguageMenu
        locales={LOCALES}
        locale="fr"
        onLocaleChange={vi.fn()}
        useLanguageMenu={customHook}
      />,
    );

    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Français (Injected)')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('uses useLanguageMenu hook prop to render a forced open state with items (state 2)', () => {
    const mockClose = vi.fn();
    const customHook = () => ({
      open: true,
      containerRef: { current: null },
      activeLabel: 'English',
      toggle: vi.fn(),
      close: mockClose,
    });

    const onLocaleChange = vi.fn();
    render(
      <LanguageMenu
        locales={LOCALES}
        locale="en"
        onLocaleChange={onLocaleChange}
        useLanguageMenu={customHook}
      />,
    );

    expect(screen.getByRole('button', { name: /english/i }).getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu');
    expect(menu).toBeTruthy();

    const jaOption = screen.getByText('日本語');
    expect(jaOption).toBeTruthy();

    fireEvent.click(jaOption);
    expect(onLocaleChange).toHaveBeenCalledWith('ja');
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
