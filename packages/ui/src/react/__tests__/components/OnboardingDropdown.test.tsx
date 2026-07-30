import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import { I18nProvider } from '../../../features/i18n/index.js';
import {
  OnboardingDropdown,
  ONBOARDING_DROPDOWN_OPEN_EVENT,
  ONBOARDING_MENU_FALLBACK_VIEWPORT,
  ONBOARDING_MENU_MAX_HEIGHT,
  ONBOARDING_MENU_MIN_HEIGHT,
  filterOnboardingOptions,
  onboardingEmptyMessageKey,
  readOnboardingViewportHeight,
  resolveOnboardingMenuMetrics,
  resolveOnboardingSelectedValues,
  resolveOnboardingTriggerLabel,
  useOnboardingDropdown,
  useOnboardingDropdownPlacement,
  type OnboardingDropdownOption,
  type OnboardingDropdownProps,
  type UseOnboardingDropdownResult,
} from '../../components/OnboardingDropdown.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function mockRect(rect: Partial<DOMRect>) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {
      return this;
    },
    ...rect,
  } as DOMRect);
}

describe('OnboardingDropdown', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 500, writable: true, configurable: true });
    mockRect({ top: 10, bottom: 30 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the label and placeholder as the trigger label when unselected', () => {
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="" onChange={() => {}} />,
    );
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('Choose a team');
    expect(screen.getByRole('button')).not.toHaveClass('has-value');
  });

  it('shows the selected option label and the has-value class', () => {
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="b" onChange={() => {}} />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Beta');
    expect(screen.getByRole('button')).toHaveClass('has-value');
  });

  it('joins multiple selected labels in multiple mode', () => {
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose teams"
        options={OPTIONS}
        value={['a', 'c']}
        onChange={() => {}}
        multiple
      />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Alpha, Gamma');
  });

  it('applies data-source-tone from the sourceTone prop', () => {
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose a team"
        options={OPTIONS}
        value=""
        onChange={() => {}}
        sourceTone="amr"
      />,
    );
    expect(screen.getByText('Team')).toHaveAttribute('data-source-tone', 'amr');
  });

  it('opens the menu on trigger click and lists every option', async () => {
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="" onChange={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    for (const option of OPTIONS) {
      expect(screen.getByRole('option', { name: option.label })).toBeInTheDocument();
    }
  });

  it('single-select: picks an option, calls onChange, and closes the menu', async () => {
    const onChange = vi.fn();
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('multi-select: toggles a value on and stays open', async () => {
    const onChange = vi.fn();
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose teams"
        options={OPTIONS}
        value={['a']}
        onChange={onChange}
        multiple
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('multi-select: toggles a selected value off', async () => {
    const onChange = vi.fn();
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose teams"
        options={OPTIONS}
        value={['a', 'b']}
        onChange={onChange}
        multiple
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('marks the selected option with a checkmark icon and aria-selected', async () => {
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="b" onChange={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'false');
  });

  it('closes on outside pointerdown', async () => {
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="" onChange={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="" onChange={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('searchable: filters options by query and resets the query when reopened', async () => {
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose a team"
        options={OPTIONS}
        value=""
        onChange={() => {}}
        searchable
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    const search = screen.getByRole('searchbox');
    await userEvent.type(search, 'gam');
    expect(screen.getByRole('option', { name: 'Gamma' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Alpha' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('searchable: shows "No matches" when the query matches nothing', async () => {
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose a team"
        options={OPTIONS}
        value=""
        onChange={() => {}}
        searchable
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('non-searchable: shows "No options available" when there are no options', async () => {
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={[]} value="" onChange={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('No options available')).toBeInTheDocument();
  });

  it('uses a custom searchPlaceholder for the search input', async () => {
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose a team"
        options={OPTIONS}
        value=""
        onChange={() => {}}
        searchable
        searchPlaceholder="Search teams…"
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByPlaceholderText('Search teams…')).toBeInTheDocument();
  });

  it('flips to top placement when there is more room above than below', async () => {
    mockRect({ top: 400, bottom: 420 });
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="" onChange={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Team').closest('[data-placement]')).toHaveAttribute('data-placement', 'top');
  });

  it('falls back to document.documentElement.clientHeight when window.innerHeight is falsy', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 500,
      configurable: true,
    });
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="" onChange={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Team').closest('[data-placement]')).toHaveAttribute('data-placement', 'bottom');
  });

  it('falls back to a 720px viewport when neither innerHeight nor clientHeight are available', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 0, configurable: true });
    mockRect({ top: 400, bottom: 420 });
    render(
      <OnboardingDropdown label="Team" placeholder="Choose a team" options={OPTIONS} value="" onChange={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button'));
    // viewportHeight falls back to 720 → spaceBelow = 720-420 = 300 (>=260) → bottom.
    expect(screen.getByText('Team').closest('[data-placement]')).toHaveAttribute('data-placement', 'bottom');
  });

  it('honors an explicit top placement regardless of available space', async () => {
    render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose a team"
        options={OPTIONS}
        value=""
        onChange={() => {}}
        placement="top"
      />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Team').closest('[data-placement]')).toHaveAttribute('data-placement', 'top');
  });

  it('closes a peer dropdown when a second one opens', async () => {
    render(
      <>
        <OnboardingDropdown label="First" placeholder="Pick" options={OPTIONS} value="" onChange={() => {}} />
        <OnboardingDropdown label="Second" placeholder="Pick" options={OPTIONS} value="" onChange={() => {}} />
      </>,
    );
    const [first, second] = screen.getAllByRole('button');
    await userEvent.click(first!);
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
    await userEvent.click(second!);
    expect(screen.getAllByRole('listbox')).toHaveLength(1);
  });

  it('appends a caller-supplied className', () => {
    const { container } = render(
      <OnboardingDropdown
        label="Team"
        placeholder="Choose a team"
        options={OPTIONS}
        value=""
        onChange={() => {}}
        className="extra"
      />,
    );
    expect(container.firstChild).toHaveClass('onboarding-view__select-field');
    expect(container.firstChild).toHaveClass('extra');
  });

  it('renders translated empty-state copy when mounted under an I18nProvider', async () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'No options available': 'Aucune option disponible' } }} initialLocale="fr">
        <OnboardingDropdown label="Team" placeholder="Choose a team" options={[]} value="" onChange={() => {}} />
      </I18nProvider>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Aucune option disponible')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pure helpers — tested directly at their seam.
// ---------------------------------------------------------------------------

describe('resolveOnboardingSelectedValues', () => {
  it('passes an array through unchanged', () => {
    const input = ['a', 'b'];
    expect(resolveOnboardingSelectedValues(input)).toBe(input);
  });

  it('wraps a non-empty string in a singleton array', () => {
    expect(resolveOnboardingSelectedValues('a')).toEqual(['a']);
  });

  it('returns an empty array for an empty string', () => {
    expect(resolveOnboardingSelectedValues('')).toEqual([]);
  });
});

describe('resolveOnboardingTriggerLabel', () => {
  const options: OnboardingDropdownOption[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('joins every selected label in multiple mode', () => {
    expect(resolveOnboardingTriggerLabel(options, true, 'Pick')).toBe('Alpha, Beta');
  });

  it('uses the first selected label in single mode', () => {
    expect(resolveOnboardingTriggerLabel(options, false, 'Pick')).toBe('Alpha');
  });

  it('falls back to the placeholder when nothing is selected (single)', () => {
    expect(resolveOnboardingTriggerLabel([], false, 'Pick')).toBe('Pick');
  });

  it('falls back to the placeholder when nothing is selected (multiple)', () => {
    expect(resolveOnboardingTriggerLabel([], true, 'Pick')).toBe('Pick');
  });
});

describe('filterOnboardingOptions', () => {
  const options: OnboardingDropdownOption[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];

  it('returns every option when not searchable', () => {
    expect(filterOnboardingOptions(options, 'alp', false)).toBe(options);
  });

  it('returns every option when the query is blank whitespace', () => {
    expect(filterOnboardingOptions(options, '   ', true)).toBe(options);
  });

  it('matches case-insensitively against the label', () => {
    expect(filterOnboardingOptions(options, 'ALP', true)).toEqual([{ value: 'a', label: 'Alpha' }]);
  });

  it('matches against the value as well as the label', () => {
    expect(filterOnboardingOptions(options, 'c', true)).toEqual([{ value: 'c', label: 'Gamma' }]);
  });
});

describe('onboardingEmptyMessageKey', () => {
  it('returns the no-matches key when searchable', () => {
    expect(onboardingEmptyMessageKey(true)).toBe('No matches');
  });

  it('returns the no-options key when not searchable', () => {
    expect(onboardingEmptyMessageKey(false)).toBe('No options available');
  });
});

describe('resolveOnboardingMenuMetrics', () => {
  it('honors an explicit top placement regardless of space', () => {
    const metrics = resolveOnboardingMenuMetrics({ top: 10, bottom: 30 }, 500, 'top');
    expect(metrics.placement).toBe('top');
    // availableSpace = spaceAbove = 10 → clamped up to the minimum height.
    expect(metrics.maxHeight).toBe(ONBOARDING_MENU_MIN_HEIGHT);
  });

  it('flips to top when space below is tight and there is more room above', () => {
    const metrics = resolveOnboardingMenuMetrics({ top: 400, bottom: 420 }, 500, 'bottom');
    expect(metrics.placement).toBe('top');
  });

  it('stays at the bottom when there is ample room below', () => {
    const metrics = resolveOnboardingMenuMetrics({ top: 10, bottom: 30 }, 500, 'bottom');
    expect(metrics.placement).toBe('bottom');
    // availableSpace = 500 - 30 = 470 → clamped down to the maximum height.
    expect(metrics.maxHeight).toBe(ONBOARDING_MENU_MAX_HEIGHT);
  });

  it('stays at the bottom when space below is tight but not larger above', () => {
    // spaceBelow = 250 (< 260) but spaceAbove = 100 is NOT greater → no flip.
    const metrics = resolveOnboardingMenuMetrics({ top: 100, bottom: 250 }, 500, 'bottom');
    expect(metrics.placement).toBe('bottom');
  });

  it('returns an intermediate clamped height between the min and max', () => {
    // spaceBelow = 200 → availableSpace - 16 = 184, within [48, 240].
    const metrics = resolveOnboardingMenuMetrics({ top: 10, bottom: 100 }, 300, 'bottom');
    expect(metrics.maxHeight).toBe(184);
  });
});

describe('readOnboardingViewportHeight', () => {
  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 500, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 500, configurable: true });
  });

  it('prefers window.innerHeight', () => {
    Object.defineProperty(window, 'innerHeight', { value: 640, writable: true, configurable: true });
    expect(readOnboardingViewportHeight()).toBe(640);
  });

  it('falls back to documentElement.clientHeight', () => {
    Object.defineProperty(window, 'innerHeight', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 480, configurable: true });
    expect(readOnboardingViewportHeight()).toBe(480);
  });

  it('falls back to the fixed fallback viewport when both are unavailable', () => {
    Object.defineProperty(window, 'innerHeight', { value: 0, writable: true, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 0, configurable: true });
    expect(readOnboardingViewportHeight()).toBe(ONBOARDING_MENU_FALLBACK_VIEWPORT);
  });
});

// ---------------------------------------------------------------------------
// Hooks — tested via renderHook / a mounted harness at their seam.
// ---------------------------------------------------------------------------

describe('useOnboardingDropdownPlacement', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 500, writable: true, configurable: true });
    mockRect({ top: 10, bottom: 30 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function attachedRef(): RefObject<HTMLDivElement | null> {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return { current: el };
  }

  it('starts at the requested placement and the max height while closed', () => {
    const rootRef = attachedRef();
    const { result } = renderHook(() => useOnboardingDropdownPlacement(rootRef, false, 'bottom', 3));
    expect(result.current.placement).toBe('bottom');
    expect(result.current.maxHeight).toBe(ONBOARDING_MENU_MAX_HEIGHT);
  });

  it('measures the trigger once open and resolves the placement', () => {
    mockRect({ top: 400, bottom: 420 });
    const rootRef = attachedRef();
    const { result } = renderHook(() => useOnboardingDropdownPlacement(rootRef, true, 'bottom', 3));
    // spaceBelow = 500 - 420 = 80 (< 260), spaceAbove = 400 > 80 → flips to top.
    expect(result.current.placement).toBe('top');
  });

  it('re-measures when a resize event fires', () => {
    const rootRef = attachedRef();
    const { result } = renderHook(() => useOnboardingDropdownPlacement(rootRef, true, 'bottom', 3));
    expect(result.current.placement).toBe('bottom');
    mockRect({ top: 400, bottom: 420 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.placement).toBe('top');
  });

  it('is a graceful no-op when the ref is unattached', () => {
    const detached: RefObject<HTMLDivElement | null> = { current: null };
    const { result } = renderHook(() => useOnboardingDropdownPlacement(detached, true, 'top', 3));
    // No node to measure → the initial metrics stand and nothing throws.
    expect(result.current.placement).toBe('top');
    expect(result.current.maxHeight).toBe(ONBOARDING_MENU_MAX_HEIGHT);
  });

  it('tears down its resize/scroll listeners on unmount', () => {
    const rootRef = attachedRef();
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useOnboardingDropdownPlacement(rootRef, true, 'bottom', 3));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  });
});

describe('useOnboardingDropdown', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: 500, writable: true, configurable: true });
    mockRect({ top: 10, bottom: 30 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const OPTS: OnboardingDropdownOption[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  function baseProps(overrides: Partial<OnboardingDropdownProps> = {}): OnboardingDropdownProps {
    return {
      label: 'Team',
      placeholder: 'Pick',
      options: OPTS,
      value: '',
      onChange: () => {},
      ...overrides,
    } as OnboardingDropdownProps;
  }

  // Render the hook inside a real host so its internal `rootRef` is attached
  // to a mounted node — the placement layout-effect measures that node when
  // the menu opens.
  function renderDropdownHook(props: OnboardingDropdownProps) {
    const result = { current: null as unknown as UseOnboardingDropdownResult };
    function Harness() {
      const value = useOnboardingDropdown(props);
      result.current = value;
      return <div ref={value.rootRef} />;
    }
    const utils = render(<Harness />);
    return { result, ...utils };
  }

  it('toggles open and broadcasts the single-open peer event only when opening', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { result } = renderDropdownHook(baseProps());

    expect(result.current.open).toBe(false);
    act(() => result.current.toggleOpen());
    expect(result.current.open).toBe(true);
    const openEvents = dispatchSpy.mock.calls.filter(
      ([event]) => (event as Event).type === ONBOARDING_DROPDOWN_OPEN_EVENT,
    );
    expect(openEvents).toHaveLength(1);
    expect((openEvents[0]![0] as CustomEvent<string>).detail).toMatch(/^onboarding-dropdown-/);

    act(() => result.current.toggleOpen());
    expect(result.current.open).toBe(false);
    // Closing must not broadcast another open event.
    const afterCloseOpenEvents = dispatchSpy.mock.calls.filter(
      ([event]) => (event as Event).type === ONBOARDING_DROPDOWN_OPEN_EVENT,
    );
    expect(afterCloseOpenEvents).toHaveLength(1);
  });

  it('resets the query whenever the menu closes', () => {
    const { result } = renderDropdownHook(baseProps({ searchable: true }));
    act(() => result.current.toggleOpen());
    act(() => result.current.setQuery('alp'));
    expect(result.current.query).toBe('alp');
    act(() => result.current.toggleOpen());
    expect(result.current.query).toBe('');
  });

  it('single-select: selectOption calls onChange with the raw value and closes', () => {
    const onChange = vi.fn();
    const { result } = renderDropdownHook(baseProps({ value: '', onChange }));
    act(() => result.current.toggleOpen());
    act(() => result.current.selectOption({ value: 'b', label: 'Beta' }, false));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(result.current.open).toBe(false);
  });

  it('multi-select: selectOption adds an unselected value and stays open', () => {
    const onChange = vi.fn();
    const { result } = renderDropdownHook(baseProps({ multiple: true, value: ['a'], onChange }));
    act(() => result.current.toggleOpen());
    act(() => result.current.selectOption({ value: 'b', label: 'Beta' }, false));
    expect(onChange).toHaveBeenCalledWith(['a', 'b']);
    expect(result.current.open).toBe(true);
  });

  it('multi-select: selectOption removes an already-selected value', () => {
    const onChange = vi.fn();
    const { result } = renderDropdownHook(baseProps({ multiple: true, value: ['a', 'b'], onChange }));
    act(() => result.current.selectOption({ value: 'a', label: 'Alpha' }, true));
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('closes when a peer dropdown broadcasts a different id', () => {
    const { result } = renderDropdownHook(baseProps());
    act(() => result.current.toggleOpen());
    expect(result.current.open).toBe(true);
    act(() => {
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_DROPDOWN_OPEN_EVENT, { detail: 'some-other-dropdown' }),
      );
    });
    expect(result.current.open).toBe(false);
  });

  it('derives selection-driven state (values, hasValue, trigger label)', () => {
    const { result } = renderDropdownHook(baseProps({ value: 'b' }));
    expect(result.current.selectedValues).toEqual(['b']);
    expect(result.current.hasValue).toBe(true);
    expect(result.current.triggerLabel).toBe('Beta');
  });
});

describe('OnboardingDropdown with hook override prop', () => {
  it('uses useOnboardingDropdown hook prop to render a forced closed state (state 1)', () => {
    const mockToggleOpen = vi.fn();
    const customHook = () => ({
      rootRef: { current: null },
      open: false,
      query: '',
      setQuery: vi.fn(),
      resolvedPlacement: 'bottom' as const,
      menuMaxHeight: 240,
      visibleOptions: OPTIONS,
      selectedValues: ['a'],
      hasValue: true,
      triggerLabel: 'Custom Injected Label',
      emptyMessage: 'No options',
      toggleOpen: mockToggleOpen,
      selectOption: vi.fn(),
    });

    render(
      <OnboardingDropdown
        label="Select Item"
        placeholder="Choose..."
        options={OPTIONS}
        value="a"
        onChange={vi.fn()}
        useOnboardingDropdown={customHook}
      />,
    );

    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Custom Injected Label')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger);
    expect(mockToggleOpen).toHaveBeenCalledTimes(1);
  });

  it('uses useOnboardingDropdown hook prop to render a forced open state with items (state 2)', () => {
    const mockSelectOption = vi.fn();
    const mockSetQuery = vi.fn();
    const customHook = () => ({
      rootRef: { current: null },
      open: true,
      query: 'gam',
      setQuery: mockSetQuery,
      resolvedPlacement: 'top' as const,
      menuMaxHeight: 180,
      visibleOptions: [OPTIONS[2]!],
      selectedValues: ['c'],
      hasValue: true,
      triggerLabel: 'Gamma',
      emptyMessage: 'No options',
      toggleOpen: vi.fn(),
      selectOption: mockSelectOption,
    });

    render(
      <OnboardingDropdown
        label="Select Item"
        placeholder="Choose..."
        options={OPTIONS}
        value="c"
        searchable
        onChange={vi.fn()}
        useOnboardingDropdown={customHook}
      />,
    );

    const trigger = screen.getByRole('button', { name: /gamma/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox')).toBeTruthy();

    const searchInput = screen.getByRole('searchbox') as HTMLInputElement;
    expect(searchInput.value).toBe('gam');

    fireEvent.change(searchInput, { target: { value: 'gamm' } });
    expect(mockSetQuery).toHaveBeenCalledWith('gamm');

    const gammaOption = screen.getByRole('option', { name: /gamma/i });
    expect(gammaOption.className).toContain('is-selected');

    fireEvent.click(gammaOption);
    expect(mockSelectOption).toHaveBeenCalledWith(OPTIONS[2], true);
  });
});
