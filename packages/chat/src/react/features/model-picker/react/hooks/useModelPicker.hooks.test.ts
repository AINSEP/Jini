import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelPicker } from './useModelPicker.hooks.js';
import type { ModelOption, ModelProvider } from '../../types.js';

const openai: ModelProvider = { id: 'openai', label: 'OpenAI', credentialsRequired: true };
const models: ModelOption[] = [
  { id: 'gpt-5', label: 'GPT-5', providerId: 'openai', default: true },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', providerId: 'openai' },
];

function setup(overrides: Partial<Parameters<typeof useModelPicker>[0]> = {}) {
  const onChange = vi.fn();
  const utils = renderHook(
    (props: Partial<Parameters<typeof useModelPicker>[0]>) =>
      useModelPicker({
        models,
        providers: [openai],
        statusByProviderId: { openai: 'configured' },
        value: 'gpt-5',
        onChange,
        ...props,
      }),
    { initialProps: overrides },
  );
  return { ...utils, onChange };
}

describe('useModelPicker', () => {
  it('starts closed with an empty query', () => {
    const { result } = setup();
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe('');
  });

  it('derives groups, filteredGroups, and the current selection from props', () => {
    const { result } = setup();
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.filteredGroups).toEqual(result.current.groups);
    expect(result.current.selection?.model.id).toBe('gpt-5');
  });

  it('reports no selection for a value not present in any group', () => {
    const { result } = setup({ value: 'unknown' });
    expect(result.current.selection).toBeNull();
  });

  it('hides the search affordance below the configured minimum option count', () => {
    const { result } = setup();
    expect(result.current.shouldShowSearch).toBe(false);
  });

  it('shows the search affordance once minSearchableOptions is met', () => {
    const { result } = setup({ minSearchableOptions: 2 });
    expect(result.current.shouldShowSearch).toBe(true);
  });

  it('toggle() flips open, and close() resets both open and query', () => {
    const { result } = setup();
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.setQuery('gpt'));
    expect(result.current.query).toBe('gpt');
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe('');
  });

  it('setQuery narrows filteredGroups', () => {
    const { result } = setup();
    act(() => result.current.setQuery('mini'));
    expect(result.current.filteredGroups[0]?.models).toEqual([models[1]]);
  });

  it('select() calls onChange with the model id and closes the picker', () => {
    const { result, onChange } = setup();
    act(() => result.current.toggle());
    act(() => result.current.select('gpt-5-mini'));
    expect(onChange).toHaveBeenCalledWith('gpt-5-mini');
    expect(result.current.open).toBe(false);
  });

  it('does not auto-select when autoSelectFirst is false (the default) and value matches nothing', () => {
    const { onChange } = setup({ value: 'unknown', autoSelectFirst: false });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('auto-selects the first available model when autoSelectFirst is true and value matches nothing', () => {
    const { onChange } = setup({ value: 'unknown', autoSelectFirst: true });
    expect(onChange).toHaveBeenCalledWith('gpt-5');
  });

  it('does not auto-select when a selection already exists, even with autoSelectFirst true', () => {
    const { onChange } = setup({ value: 'gpt-5', autoSelectFirst: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not auto-select when there are no groups to fall back to', () => {
    const onChange = vi.fn();
    renderHook(() =>
      useModelPicker({ models: [], providers: [], statusByProviderId: {}, value: 'unknown', onChange, autoSelectFirst: true }),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('dismisses via a mousedown outside the container while open', () => {
    const { result } = setup();
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.open).toBe(false);
  });

  it('does not dismiss on a mousedown inside the container', () => {
    const { result } = setup();
    act(() => result.current.toggle());
    const node = document.createElement('div');
    document.body.appendChild(node);
    result.current.containerRef.current = node;
    act(() => {
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(result.current.open).toBe(true);
    document.body.removeChild(node);
  });

  it('dismisses on Escape while open', () => {
    const { result } = setup();
    act(() => result.current.toggle());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(result.current.open).toBe(false);
  });

  it('ignores non-Escape keys while open', () => {
    const { result } = setup();
    act(() => result.current.toggle());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(result.current.open).toBe(true);
  });

  it('does not attach outside-click/Escape listeners while closed', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    setup();
    expect(addSpy).not.toHaveBeenCalledWith('mousedown', expect.anything());
    addSpy.mockRestore();
  });

  it('removes its listeners on unmount while open', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = setup();
    act(() => result.current.toggle());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.anything());
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.anything());
    removeSpy.mockRestore();
  });
});
