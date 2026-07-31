// @vitest-environment jsdom
import { useState } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  computeCustomSelectMenuPosition,
  CustomSelect,
  CustomSelectOptionButton,
  CUSTOM_SELECT_MAX_MENU_HEIGHT,
  CUSTOM_SELECT_MIN_MENU_HEIGHT,
  flattenCustomSelectOptions,
  isCustomSelectEventInside,
  isCustomSelectGroup,
  nextCustomSelectActiveValue,
  reconcileCustomSelectActiveValue,
  resolveInitialCustomSelectActiveValue,
  useCustomSelect,
  type CustomSelectFlatOption,
  type CustomSelectItem,
} from '../../components/CustomSelect.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma', disabled: true },
];

const OPTIONS3 = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

const ALL_DISABLED = [
  { value: 'a', label: 'Alpha', disabled: true },
  { value: 'b', label: 'Beta', disabled: true },
];

const optionButton = (label: string) =>
  screen.getAllByRole('option').find((button) => button.textContent?.includes(label))!;

describe('CustomSelect', () => {
  it('shows the selected option label on the trigger', () => {
    render(<CustomSelect value="b" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    expect(screen.getByRole('combobox').textContent).toContain('Beta');
  });

  it('opens the listbox and calls onChange when an option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomSelect value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick" portal={false} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('does not select a disabled option', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomSelect value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick" portal={false} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Gamma'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('groups options under their group label', async () => {
    const user = userEvent.setup();
    const grouped = [{ label: 'Greek letters', options: OPTIONS.slice(0, 2) }];
    render(<CustomSelect value="a" options={grouped} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('Greek letters')).toBeTruthy();
  });

  it('closes on Escape without changing the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomSelect value="a" options={OPTIONS} onChange={onChange} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder when the value matches no option', () => {
    render(
      <CustomSelect
        value="missing"
        options={OPTIONS}
        onChange={vi.fn()}
        ariaLabel="Pick"
        placeholder="Choose one"
        portal={false}
      />,
    );
    expect(screen.getByRole('combobox').textContent).toContain('Choose one');
  });

  it('falls back to the raw value when there is no match and no placeholder', () => {
    render(<CustomSelect value="mystery" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    expect(screen.getByRole('combobox').textContent).toContain('mystery');
  });

  it('renders custom class names and honors disabled/title/labelledBy props', () => {
    render(
      <CustomSelect
        value="a"
        options={OPTIONS}
        onChange={vi.fn()}
        ariaLabel="Pick"
        className="my-select"
        triggerClassName="my-trigger"
        menuClassName="my-menu"
        labelledBy="ext-label"
        title="Tooltip"
        disabled
        portal={false}
      />,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger.className).toContain('my-trigger');
    expect(trigger.getAttribute('title')).toBe('Tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe('ext-label');
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(trigger.closest('.jini-select')?.className).toContain('my-select');
  });

  it('calls onFocus when the trigger is focused', () => {
    const onFocus = vi.fn();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" onFocus={onFocus} portal={false} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('toggles the menu open and closed on click', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('applies the custom menu class and the inline class when not portaled', async () => {
    const user = userEvent.setup();
    render(
      <CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" menuClassName="my-menu" portal={false} />,
    );
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox').className).toContain('my-menu');
    expect(screen.getByRole('listbox').className).toContain('inline');
  });
});

describe('CustomSelect keyboard navigation', () => {
  const open = (trigger: HTMLElement) => act(() => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); });

  it('opens with ArrowDown when closed', () => {
    render(<CustomSelect value="a" options={OPTIONS3} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    open(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('moves the active option down (ArrowDown) and wraps around', () => {
    render(<CustomSelect value="a" options={OPTIONS3} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    open(trigger); // active = a
    act(() => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); }); // -> b
    expect(optionButton('Beta').id).toBe(trigger.getAttribute('aria-activedescendant'));
    act(() => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); }); // -> c
    expect(optionButton('Gamma').id).toBe(trigger.getAttribute('aria-activedescendant'));
    act(() => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); }); // wrap -> a
    expect(optionButton('Alpha').id).toBe(trigger.getAttribute('aria-activedescendant'));
  });

  it('moves the active option up (ArrowUp) with wrap-around', () => {
    render(<CustomSelect value="a" options={OPTIONS3} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    open(trigger); // active = a
    act(() => { fireEvent.keyDown(trigger, { key: 'ArrowUp' }); }); // wrap up -> c
    expect(optionButton('Gamma').id).toBe(trigger.getAttribute('aria-activedescendant'));
  });

  it('opens with ArrowUp when closed', () => {
    render(<CustomSelect value="a" options={OPTIONS3} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    act(() => { fireEvent.keyDown(trigger, { key: 'ArrowUp' }); });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('opens with Enter when closed', () => {
    render(<CustomSelect value="a" options={OPTIONS3} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    act(() => { fireEvent.keyDown(trigger, { key: 'Enter' }); });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('chooses the active option on Enter when open', () => {
    const onChange = vi.fn();
    render(<CustomSelect value="a" options={OPTIONS3} onChange={onChange} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    open(trigger); // active = a
    act(() => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); }); // active = b
    act(() => { fireEvent.keyDown(trigger, { key: 'Enter' }); });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('chooses on Space when open', () => {
    const onChange = vi.fn();
    render(<CustomSelect value="a" options={OPTIONS3} onChange={onChange} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    open(trigger); // active = a
    act(() => { fireEvent.keyDown(trigger, { key: ' ' }); });
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('falls back to the current value when Enter is pressed with no active option', () => {
    const onChange = vi.fn();
    render(<CustomSelect value="a" options={ALL_DISABLED} onChange={onChange} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    open(trigger); // all disabled -> active = ''
    expect(trigger.getAttribute('aria-activedescendant')).toBeNull();
    act(() => { fireEvent.keyDown(trigger, { key: 'Enter' }); });
    // value 'a' is disabled, so choose() bails: no onChange, but the `activeValue || value` branch ran.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not move the active option when every option is disabled', () => {
    render(<CustomSelect value="a" options={ALL_DISABLED} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    open(trigger);
    act(() => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); });
    expect(trigger.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('ignores Escape when closed and ignores unrelated keys', () => {
    render(<CustomSelect value="a" options={OPTIONS3} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    act(() => { fireEvent.keyDown(trigger, { key: 'Escape' }); }); // closed + Escape -> no-op
    act(() => { fireEvent.keyDown(trigger, { key: 'a' }); }); // unrelated key -> no-op
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('CustomSelect outside interaction & portal', () => {
  it('closes when a mousedown lands outside the trigger and menu', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    act(() => { fireEvent.mouseDown(document.body); });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('stays open on mousedown inside the trigger', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    act(() => { fireEvent.mouseDown(trigger); });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('stays open on mousedown inside the menu', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    await user.click(screen.getByRole('combobox'));
    act(() => { fireEvent.mouseDown(screen.getByText('Beta')); });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('renders the menu in a portal and repositions on scroll/resize', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" />); // portal defaults true
    await user.click(screen.getByRole('combobox'));
    const menu = screen.getByRole('listbox');
    expect(menu.className).toContain('portal');
    // Portal menus render under document.body, not inside the .jini-select wrapper.
    expect(menu.closest('.jini-select')).toBeNull();
    act(() => { window.dispatchEvent(new Event('scroll')); });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('does not reposition on scroll when not portaled', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    await user.click(screen.getByRole('combobox'));
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('hovering an option makes it the active descendant', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS3} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    fireEvent.mouseEnter(optionButton('Gamma'));
    expect(optionButton('Gamma').id).toBe(trigger.getAttribute('aria-activedescendant'));
  });
});

// Pure helpers — directly unit-testable without rendering.
describe('CustomSelect pure helpers', () => {
  it('isCustomSelectGroup distinguishes groups from leaf options', () => {
    expect(isCustomSelectGroup({ label: 'g', options: [] })).toBe(true);
    expect(isCustomSelectGroup({ value: 'a', label: 'A' })).toBe(false);
  });

  it('flattenCustomSelectOptions flattens groups and tags group labels', () => {
    const items: CustomSelectItem[] = [
      { label: 'Group', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      { value: 'c', label: 'C' },
    ];
    const flat = flattenCustomSelectOptions(items);
    expect(flat.map((o) => o.value)).toEqual(['a', 'b', 'c']);
    expect(flat[0]?.group).toBe('Group');
    expect(flat[2]?.group).toBeUndefined();
  });

  it('computeCustomSelectMenuPosition drops below the trigger when there is room', () => {
    expect(
      computeCustomSelectMenuPosition(
        { top: 100, bottom: 130, left: 100, width: 200 },
        { width: 1000, height: 768 },
      ),
    ).toEqual({ top: 134, left: 100, width: 200, maxHeight: CUSTOM_SELECT_MAX_MENU_HEIGHT });
  });

  it('computeCustomSelectMenuPosition flips above the trigger when space below is tight', () => {
    expect(
      computeCustomSelectMenuPosition(
        { top: 700, bottom: 730, left: 100, width: 200 },
        { width: 1000, height: 768 },
      ),
    ).toEqual({ top: 396, left: 100, width: 200, maxHeight: CUSTOM_SELECT_MAX_MENU_HEIGHT });
  });

  it('computeCustomSelectMenuPosition keeps below when tight but with no more room above', () => {
    expect(
      computeCustomSelectMenuPosition(
        { top: 10, bottom: 40, left: 100, width: 200 },
        { width: 1000, height: 150 },
      ),
    ).toEqual({ top: 44, left: 100, width: 200, maxHeight: CUSTOM_SELECT_MIN_MENU_HEIGHT });
  });

  it('computeCustomSelectMenuPosition clamps the left edge into the viewport', () => {
    const pos = computeCustomSelectMenuPosition(
      { top: 100, bottom: 130, left: 5000, width: 200 },
      { width: 1000, height: 768 },
    );
    expect(pos.left).toBe(788);
  });

  it('nextCustomSelectActiveValue returns null when nothing is enabled', () => {
    expect(nextCustomSelectActiveValue([], 'a', 1)).toBeNull();
  });

  it('nextCustomSelectActiveValue wraps forward and backward', () => {
    const enabled: CustomSelectFlatOption[] = OPTIONS3;
    expect(nextCustomSelectActiveValue(enabled, 'c', 1)).toBe('a'); // wrap forward
    expect(nextCustomSelectActiveValue(enabled, 'a', -1)).toBe('c'); // wrap backward
  });

  it('nextCustomSelectActiveValue starts at the first option when the active value is unknown', () => {
    expect(nextCustomSelectActiveValue(OPTIONS3, 'zzz', -1)).toBe('a');
  });

  it('resolveInitialCustomSelectActiveValue prefers the enabled selected value', () => {
    expect(resolveInitialCustomSelectActiveValue(OPTIONS3, OPTIONS3, 'b')).toBe('b');
  });

  it('resolveInitialCustomSelectActiveValue falls back to the first enabled option', () => {
    const flat: CustomSelectFlatOption[] = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B' },
    ];
    const enabled = flat.filter((o) => !o.disabled);
    expect(resolveInitialCustomSelectActiveValue(flat, enabled, 'a')).toBe('b'); // 'a' disabled
  });

  it('resolveInitialCustomSelectActiveValue returns empty string when nothing is selectable', () => {
    const flat: CustomSelectFlatOption[] = [{ value: 'a', label: 'A', disabled: true }];
    expect(resolveInitialCustomSelectActiveValue(flat, [], 'x')).toBe('');
  });

  it('isCustomSelectEventInside detects the trigger, the menu, and outside targets', () => {
    const button = document.createElement('button');
    const inButton = document.createElement('span');
    button.appendChild(inButton);
    const menu = document.createElement('div');
    const inMenu = document.createElement('span');
    menu.appendChild(inMenu);
    const outside = document.createElement('div');

    expect(isCustomSelectEventInside(inButton, button, menu)).toBe(true); // in trigger
    expect(isCustomSelectEventInside(inMenu, null, menu)).toBe(true); // trigger absent, in menu
    expect(isCustomSelectEventInside(outside, button, menu)).toBe(false); // neither
    expect(isCustomSelectEventInside(outside, null, null)).toBe(false); // both absent
  });
});

// The pure reconciler — covers the guard the effect's [open, value] flow can't reach.
describe('reconcileCustomSelectActiveValue', () => {
  const flat: CustomSelectFlatOption[] = OPTIONS3;
  const enabled = flat;

  it('resets tracking refs and leaves the active value alone while closed', () => {
    const result = reconcileCustomSelectActiveValue({
      open: false, value: 'a', wasOpen: true, activeSourceValue: 'a', flatOptions: flat, enabledOptions: enabled,
    });
    expect(result).toEqual({ wasOpen: false, activeSourceValue: 'a' });
    expect(result.nextActiveValue).toBeUndefined();
  });

  it('does nothing when already reconciled for the same open value', () => {
    const result = reconcileCustomSelectActiveValue({
      open: true, value: 'a', wasOpen: true, activeSourceValue: 'a', flatOptions: flat, enabledOptions: enabled,
    });
    expect(result).toEqual({ wasOpen: true, activeSourceValue: 'a' });
    expect(result.nextActiveValue).toBeUndefined();
  });

  it('initializes the active value on a fresh open', () => {
    const result = reconcileCustomSelectActiveValue({
      open: true, value: 'b', wasOpen: false, activeSourceValue: 'a', flatOptions: flat, enabledOptions: enabled,
    });
    expect(result).toEqual({ wasOpen: true, activeSourceValue: 'b', nextActiveValue: 'b' });
  });

  it('re-initializes the active value when the value changes while open', () => {
    const result = reconcileCustomSelectActiveValue({
      open: true, value: 'c', wasOpen: true, activeSourceValue: 'a', flatOptions: flat, enabledOptions: enabled,
    });
    expect(result.nextActiveValue).toBe('c');
  });
});

// The hook in isolation — covers the defensive updatePosition guard and the
// choose path where the trigger button ref is null (no rendered DOM).
describe('useCustomSelect', () => {
  it('starts closed with the value as the active option and no position', () => {
    const { result } = renderHook(() =>
      useCustomSelect({ value: 'a', options: OPTIONS, onChange: vi.fn(), portal: true }),
    );
    expect(result.current.open).toBe(false);
    expect(result.current.activeValue).toBe('a');
    expect(result.current.position).toBeNull();
    expect(result.current.activeOptionId).toBeUndefined();
    expect(result.current.selectedLabel).toBe('Alpha');
  });

  it('updatePosition is a no-op when the trigger ref is not mounted', () => {
    const { result } = renderHook(() =>
      useCustomSelect({ value: 'a', options: OPTIONS, onChange: vi.fn(), portal: true }),
    );
    act(() => { result.current.updatePosition(); });
    expect(result.current.position).toBeNull();
  });

  it('choose commits an enabled value even with no mounted trigger to refocus', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useCustomSelect({ value: 'a', options: OPTIONS, onChange, portal: false }),
    );
    act(() => { result.current.choose('b'); });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('choose ignores unknown and disabled values', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useCustomSelect({ value: 'a', options: OPTIONS, onChange, portal: false }),
    );
    act(() => { result.current.choose('zzz'); }); // unknown
    act(() => { result.current.choose('c'); }); // disabled
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggleOpen opens and closes, driving the portal position effect', () => {
    const { result } = renderHook(() =>
      useCustomSelect({ value: 'a', options: OPTIONS, onChange: vi.fn(), portal: true }),
    );
    act(() => { result.current.toggleOpen(); });
    expect(result.current.open).toBe(true);
    act(() => { result.current.toggleOpen(); });
    expect(result.current.open).toBe(false);
    expect(result.current.position).toBeNull();
  });

  it('uses the placeholder for the trigger label when the value has no match', () => {
    const { result } = renderHook(() =>
      useCustomSelect({ value: 'nope', options: OPTIONS, onChange: vi.fn(), portal: false, placeholder: 'Pick one' }),
    );
    expect(result.current.selectedLabel).toBe('Pick one');
  });
});

// The listbox row leaf, rendered directly to pin its class-name branches.
describe('CustomSelectOptionButton', () => {
  it('marks a selected + active option and reports hover and click', () => {
    const onChoose = vi.fn();
    const onActive = vi.fn();
    render(
      <CustomSelectOptionButton
        option={{ value: 'x', label: 'Ex' }}
        selected
        active
        id="opt-x"
        onChoose={onChoose}
        onActive={onActive}
      />,
    );
    const button = screen.getByRole('option');
    expect(button.className).toContain('selected');
    expect(button.className).toContain('active');
    expect(button.id).toBe('opt-x');
    fireEvent.mouseEnter(button);
    expect(onActive).toHaveBeenCalledWith('x');
    fireEvent.click(button);
    expect(onChoose).toHaveBeenCalledWith('x');
  });

  it('omits selected/active classes and disables a disabled option', () => {
    render(
      <CustomSelectOptionButton
        option={{ value: 'y', label: 'Why', disabled: true }}
        selected={false}
        active={false}
        id={undefined}
        onChoose={vi.fn()}
        onActive={vi.fn()}
      />,
    );
    const button = screen.getByRole('option') as HTMLButtonElement;
    expect(button.className).not.toContain('selected');
    expect(button.className).not.toContain('active');
    expect(button.disabled).toBe(true);
  });
});

describe('CustomSelect with hook override prop', () => {
  it('uses useCustomSelect hook prop to render a forced closed state (state 1)', () => {
    const mockToggleOpen = vi.fn();
    const customHook = () => ({
      idBase: 'test-select',
      buttonRef: { current: null },
      menuRef: { current: null },
      open: false,
      activeValue: '',
      position: null,
      selectedLabel: 'Injected Label A',
      optionIdByValue: new Map([['opt1', 'opt1-id']]),
      activeOptionId: undefined,
      updatePosition: vi.fn(),
      toggleOpen: mockToggleOpen,
      setActiveValue: vi.fn(),
      choose: vi.fn(),
      onButtonKeyDown: vi.fn(),
      onMenuKeyDown: vi.fn(),
    });

    render(
      <CustomSelect
        value="opt1"
        options={[{ value: 'opt1', label: 'Option 1' }]}
        onChange={vi.fn()}
        ariaLabel="Select Option"
        useCustomSelect={customHook}
      />,
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Injected Label A')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger);
    expect(mockToggleOpen).toHaveBeenCalledTimes(1);
  });

  it('uses useCustomSelect hook prop to render a forced open state with active option (state 2)', () => {
    const mockChoose = vi.fn();
    const mockSetActiveValue = vi.fn();
    const customHook = () => ({
      idBase: 'test-select',
      buttonRef: { current: null },
      menuRef: { current: null },
      open: true,
      activeValue: 'opt2',
      position: null,
      selectedLabel: 'Option 1',
      optionIdByValue: new Map([
        ['opt1', 'opt1-id'],
        ['opt2', 'opt2-id'],
      ]),
      activeOptionId: 'opt2-id',
      updatePosition: vi.fn(),
      toggleOpen: vi.fn(),
      setActiveValue: mockSetActiveValue,
      choose: mockChoose,
      onButtonKeyDown: vi.fn(),
      onMenuKeyDown: vi.fn(),
    });

    render(
      <CustomSelect
        value="opt1"
        options={[
          { value: 'opt1', label: 'Option 1' },
          { value: 'opt2', label: 'Option 2' },
        ]}
        onChange={vi.fn()}
        ariaLabel="Select Option"
        portal={false}
        useCustomSelect={customHook}
      />,
    );

    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[1]!.className).toContain('active');
    expect(options[0]!.className).not.toContain('active');

    fireEvent.click(options[1]!);
    expect(mockChoose).toHaveBeenCalledWith('opt2');
  });

  it('renders menuHeader inside the open menu, above the options', async () => {
    const user = userEvent.setup();
    render(
      <CustomSelect
        value="a"
        options={OPTIONS}
        onChange={vi.fn()}
        ariaLabel="Pick"
        portal={false}
        menuHeader={<input aria-label="Filter" data-testid="menu-header-input" />}
      />,
    );
    // Not rendered until the menu opens — it lives inside the listbox.
    expect(screen.queryByTestId('menu-header-input')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox'));
    const header = screen.getByTestId('menu-header-input');
    expect(header).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toContainElement(header);
  });

  it('omitting menuHeader changes nothing about the menu contents', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox').firstElementChild).not.toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
  });

  it('reports open/close transitions via onOpenChange', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} onOpenChange={onOpenChange} />,
    );
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onOpenChange.mockClear();

    await user.click(screen.getByRole('combobox'));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByText('Beta'));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('does not error when onOpenChange is omitted and the menu opens and closes', async () => {
    const user = userEvent.setup();
    render(<CustomSelect value="a" options={OPTIONS} onChange={vi.fn()} ariaLabel="Pick" portal={false} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Beta'));
    // Reaching here without throwing is the assertion — the ref-based
    // `onOpenChangeRef.current?.()` call must tolerate `undefined`.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('an unmemoized onOpenChange prop does not re-fire on every render, only on real open/close transitions', async () => {
    const user = userEvent.setup();
    const calls: boolean[] = [];
    function Wrapper() {
      const [, setTick] = useState(0);
      return (
        <CustomSelect
          value="a"
          options={OPTIONS}
          onChange={vi.fn()}
          ariaLabel="Pick"
          portal={false}
          // A fresh closure every render — this is the case the ref exists to guard.
          onOpenChange={(open) => calls.push(open)}
          onFocus={() => setTick((n) => n + 1)}
        />
      );
    }
    render(<Wrapper />);
    expect(calls).toEqual([false]);
    screen.getByRole('combobox').focus();
    await user.click(screen.getByRole('combobox'));
    expect(calls).toEqual([false, true]);
  });
});
