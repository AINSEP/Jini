import { createElement, useId, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent } from 'react';
import type { TabsProps, MenuProps, TooltipProps } from '../types.js';
export function useNativeTabs(required: TabsProps, _optional: Record<string, never> = {}) {
  const prefix = useId(), root = useRef<HTMLDivElement>(null);
  const enabled = required.items.filter(item => !item.disabled);
  const active = enabled.find(item => item.id === required.value) ?? enabled[0];
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = enabled.findIndex(item => item.id === event.currentTarget.dataset.tabId);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
      event.key === 'ArrowRight' ? (index + 1) % enabled.length : event.key === 'ArrowLeft' ? (index - 1 + enabled.length) % enabled.length : undefined;
    if (next === undefined || !enabled[next]) return;
    event.preventDefault(); required.onValueChange({ value: enabled[next].id });
    root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[required.items.findIndex(item => item.id === enabled[next]!.id)]?.focus();
  }
  const tabs = required.items.map((item, index) => createElement('button', {
    key: item.id, type: 'button', role: 'tab', id: `${prefix}-tab-${index}`, 'data-jini-part': 'kit.tab', className: 'jini-tab-bar-item',
    ...item.attrs, ...(item.id === active?.id ? required.attrs : {}),
    'data-tab-id': item.id, 'aria-controls': `${prefix}-panel-${index}`, 'aria-selected': item.id === active?.id,
    disabled: item.disabled, tabIndex: item.id === active?.id ? 0 : -1,
    onClick: () => { if (!item.disabled) required.onValueChange({ value: item.id }); }, onKeyDown,
  }, item.label));
  const panels = required.items.map((item, index) => createElement('div', { key: item.id, role: 'tabpanel', tabIndex: 0,
    'data-jini-part': 'kit.tab-panel', className: 'jini-tab-panel', id: `${prefix}-panel-${index}`, 'aria-labelledby': `${prefix}-tab-${index}`, hidden: item.id !== active?.id }, item.content));
  return { root, className: `jini-tabs ${required.className ?? ''}`.trim(), label: required.label, tabs, panels };
}
export function useNativeMenu(required: MenuProps, _optional: Record<string, never> = {}) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), id = useId();
  const [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    // Portals escape the preview card's overflow clipping. Follow the anchor on scroll/resize.
    const update = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const box = menu.current!.getBoundingClientRect();
      setPosition({ top: anchor.bottom + box.height + 4 > window.innerHeight ? Math.max(4, anchor.top - box.height - 4) : anchor.bottom + 4,
        left: Math.max(4, Math.min(anchor.right - box.width, window.innerWidth - box.width - 4)) });
    };
    update(); window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open]);
  const enabled = required.items.filter(item => !item.disabled);
  function close() { setOpen(false); trigger.current?.focus(); }
  function focus(index: number) { menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')[index]?.focus(); }
  useEffect(() => {
    if (!open) return;
    focus(0);
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  // `current` is the item's position among enabled items, the same order focus() walks, so no DOM lookup is needed.
  function onKeyDown(event: KeyboardEvent<HTMLElement>, current: number) {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 :
      event.key === 'ArrowDown' ? (current + 1) % enabled.length : event.key === 'ArrowUp' ? (current - 1 + enabled.length) % enabled.length : undefined;
    if (next !== undefined) { event.preventDefault(); focus(next); }
  }
  const items = required.items.map(item => createElement('button', { key: item.id, role: 'menuitem', type: 'button', tabIndex: -1,
    'data-jini-part': 'kit.menu-item', ...item.attrs, className: `jini-row-menu-item ${item.attrs?.['data-jini-variant'] === 'danger' ? 'jini-btn-danger' : ''}`.trim(), disabled: item.disabled,
    onClick: () => { if (!item.disabled) { close(); item.onPress({}); } }, onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, enabled.indexOf(item)) }, item.label));
  const menuProps = { ref: menu, id, role: 'menu', 'aria-label': required.label, hidden: !open, className: 'jini-row-menu-popup', 'data-jini-part': 'kit.menu', style: { position: 'fixed' as const, ...position } };
  return { label: '⋮', items, popup: open ? createPortal(createElement('div', menuProps, items), document.body) : null,
    triggerProps: { 'data-jini-part': 'kit.menu-trigger', ...required.attrs, ref: trigger, type: 'button' as const,
      className: `jini-row-menu-trigger ${required.className ?? ''}`.trim(), disabled: required.disabled, 'aria-label': required.label, 'aria-haspopup': 'menu' as const, 'aria-expanded': open, 'aria-controls': id,
      onClick: () => { if (!required.disabled) setOpen(!open); }, onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!required.disabled && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); }
      } },
    menuProps: { ref: menu, id, role: 'menu', 'aria-label': required.label, hidden: !open, className: 'jini-row-menu-popup', 'data-jini-part': 'kit.menu' } };
}
export function useNativeTooltip(required: TooltipProps, _optional: Record<string, never> = {}) {
  const [open, setOpen] = useState(false), id = useId();
  return { children: required.children, content: required.content,
    triggerProps: { 'data-jini-part': 'kit.tooltip-trigger', ...required.attrs, className: `jini-tooltip-trigger ${required.className ?? ''}`.trim(), tabIndex: 0,
      'aria-label': required.label, 'aria-describedby': open ? id : undefined,
      onFocus: () => setOpen(true), onBlur: () => setOpen(false), onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false),
      onKeyDown: (event: KeyboardEvent<HTMLSpanElement>) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); } } },
    tooltipProps: { id, role: 'tooltip', hidden: !open, className: 'jini-tooltip', 'data-jini-part': 'kit.tooltip' } };
}
