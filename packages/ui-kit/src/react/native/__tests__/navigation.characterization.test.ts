import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeKit } from '../index.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('native keyboard navigation characterization', () => {
  const tabs = [{ id: 'a', label: 'Alpha', content: 'One' }, { id: 'b', label: 'Blocked', disabled: true, content: 'Two' }, { id: 'c', label: 'Charlie', content: 'Three' }];
  it.each([
    ['Home', 'Charlie', 'a', 'Alpha'], ['End', 'Alpha', 'c', 'Charlie'],
    ['ArrowRight', 'Alpha', 'c', 'Charlie'], ['ArrowRight', 'Charlie', 'a', 'Alpha'],
    ['ArrowLeft', 'Alpha', 'c', 'Charlie'], ['ArrowLeft', 'Charlie', 'a', 'Alpha'],
  ])('tabs: %s from %s selects %s and focuses %s', (key, from, value, focused) => {
    const onValueChange = vi.fn();
    render(createElement(nativeKit.Tabs, { label: 'Sections', value: 'a', items: tabs, onValueChange }));
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('tab', { name: from }), event);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith({ value });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: focused }));
    expect(event.defaultPrevented).toBe(true);
  });

  it.each(['Home', 'End', 'ArrowRight', 'ArrowLeft', 'x'])('tabs ignore %s when all items are disabled', key => {
    const onValueChange = vi.fn();
    render(createElement(nativeKit.Tabs, { label: 'Sections', value: 'a', items: tabs.map(item => ({ ...item, disabled: true })), onValueChange }));
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('tab', { name: 'Alpha' }), event);
    expect(onValueChange).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
  });

  it('tabs leave unsupported keys alone', () => {
    const onValueChange = vi.fn();
    render(createElement(nativeKit.Tabs, { label: 'Sections', value: 'a', items: tabs, onValueChange }));
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('tab', { name: 'Alpha' }), event);
    expect(event.defaultPrevented).toBe(false); expect(onValueChange).not.toHaveBeenCalled();
  });

  it.each([
    ['Home', 'Charlie', 'Alpha'], ['End', 'Alpha', 'Charlie'],
    ['ArrowDown', 'Alpha', 'Charlie'], ['ArrowDown', 'Charlie', 'Alpha'],
    ['ArrowUp', 'Alpha', 'Charlie'], ['ArrowUp', 'Charlie', 'Alpha'],
  ])('menu: %s from %s focuses %s', (key, from, focused) => {
    const onPress = vi.fn();
    render(createElement(nativeKit.Menu, { label: 'Actions', items: tabs.map(item => ({ ...item, onPress })) }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('menuitem', { name: from }), event);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: focused }));
    expect(event.defaultPrevented).toBe(true); expect(onPress).not.toHaveBeenCalled();
  });

  it.each(['Escape', 'Tab', 'x'])('menu keeps dismissal and default handling for %s', key => {
    render(createElement(nativeKit.Menu, { label: 'Actions', items: [{ id: 'a', label: 'Alpha', onPress() {} }] }));
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    fireEvent(screen.getByRole('menuitem'), event);
    expect(event.defaultPrevented).toBe(key === 'Escape');
    if (key === 'x') { expect(screen.getByRole('menuitem').textContent).toBe('Alpha'); return; }
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement === trigger).toBe(key === 'Escape');
  });
});
