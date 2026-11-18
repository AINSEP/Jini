import { createElement as h, createRef } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { NativeBadge, NativeButton, NativeNotice, NativeSpinner, NativeToast } from '../native/Controls.js';
import { NativeTooltip, NativeTabs } from '../native/Navigation.js';
import { NativeConfirmDialog, NativeDialog, defaultNativeDialogHooks, defaultNativeConfirmDialogHooks } from '../native/Dialog.js';
import { KitProvider, ToastRegion } from '../KitProvider.js';
import { useKitContext } from '../context.js';
import { SecretInput } from '../SecretInput.js';
import type { useNativeBadge, useNativeButton, useNativeNotice, useNativeSpinner, useNativeToast } from '../native/Controls.hooks.js';
import type { useNativeTabs, useNativeTooltip } from '../native/Navigation.hooks.js';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => cleanup());

/** A fake view-model hook: the component must render exactly what it returns. */
const fakeHook = <T>(vm: unknown) => vi.fn(() => vm) as unknown as T;

it('NativeButton renders the view-model of the injected hook and forwards its props to it', () => {
  const useFake = vi.fn(() => ({ props: { 'data-vm': 'button' }, children: 'from fake' }));
  render(h(NativeButton, { useNativeButtonHook: useFake as unknown as typeof useNativeButton, label: 'x' } as never));
  expect(screen.getByRole('button', { name: 'from fake' }).getAttribute('data-vm')).toBe('button');
  expect(useFake).toHaveBeenCalledWith(expect.objectContaining({ label: 'x' }));
});

it('NativeBadge, NativeNotice, NativeSpinner and NativeToast render their injected view-models', () => {
  render(h('div', { 'data-testid': 'row' },
    h(NativeBadge, { useNativeBadgeHook: fakeHook<typeof useNativeBadge>({ props: { 'data-vm': 'badge' }, children: 'badge text' }) } as never),
    h(NativeNotice, { useNativeNoticeHook: fakeHook<typeof useNativeNotice>({ props: { 'data-vm': 'notice' }, children: 'notice text' }) } as never),
    h(NativeSpinner, { useNativeSpinnerHook: fakeHook<typeof useNativeSpinner>({ props: { 'data-vm': 'spinner' } }) } as never),
    h(NativeToast, { useNativeToastHook: fakeHook<typeof useNativeToast>({ props: { 'data-vm': 'toast' }, message: 'toast text', dismiss: null }) } as never)));
  for (const vm of ['badge', 'notice', 'spinner', 'toast']) expect(document.querySelector(`[data-vm="${vm}"]`)).not.toBeNull();
  expect(screen.getByText('badge text')).toBeTruthy();
  expect(screen.getByText('toast text')).toBeTruthy();
});

it('NativeTooltip and NativeTabs render their injected view-models', () => {
  render(h('div', null,
    h(NativeTooltip, { useNativeTooltipHook: fakeHook<typeof useNativeTooltip>({ triggerProps: {}, tooltipProps: {}, children: 'trigger text', content: 'tip text' }) } as never),
    h(NativeTabs, { useNativeTabsHook: fakeHook<typeof useNativeTabs>({ root: createRef(), className: 'fake-tabs', label: 'Fake tabs', tabs: 'tab-strip', panels: 'tab-panels' }) } as never)));
  expect(screen.getByText('tip text')).toBeTruthy();
  expect(screen.getByRole('tablist', { name: 'Fake tabs' }).textContent).toBe('tab-strip');
  expect(screen.getByText('tab-panels')).toBeTruthy();
});

it('NativeDialog takes its kit context and view-model from the injected hooks', () => {
  const useKitContext = vi.fn(() => undefined);
  const useNativeDialog = vi.fn(() => ({ props: { 'data-vm': 'dialog' }, titleId: 't', title: 'fake title', children: 'body', closeProps: {}, closeLabel: 'Fake close' }));
  render(h(NativeDialog, { hooks: { ...defaultNativeDialogHooks, useKitContext, useNativeDialog } as never } as never));
  expect(useKitContext).toHaveBeenCalled();
  expect(document.querySelector('dialog[data-vm="dialog"]')).not.toBeNull();
  expect(screen.getByText('Fake close', { selector: 'button', exact: true })).toBeTruthy();
});

it('NativeConfirmDialog asks the injected kit-context hook for its Button', () => {
  const useKitContext = vi.fn(() => undefined);
  const useNativeConfirm = vi.fn(() => { throw new Error('stop after the context lookup'); });
  expect(() => render(h(NativeConfirmDialog, { hooks: { ...defaultNativeConfirmDialogHooks, useKitContext, useNativeConfirm } as never } as never))).toThrow('stop after');
  expect(useKitContext).toHaveBeenCalled();
});

it('KitProvider publishes the value of the injected provider hook', () => {
  const value = { marker: 'fake-kit' };
  const useKitProvider = vi.fn(() => value);
  let seen: unknown;
  const Probe = () => { seen = useKitContext({}); return null; };
  render(h(KitProvider, { useKitProviderHook: useKitProvider as never, children: h(Probe) } as never));
  expect(seen).toBe(value);
});

it('ToastRegion renders the messages of the injected region hook', () => {
  const dismiss = vi.fn();
  const useToastRegion = vi.fn(() => ({ container: null, attrs: { 'data-vm': 'region' }, messages: [{ id: 'a', message: 'fake toast' }], service: { dismiss } }));
  render(h(ToastRegion, { useToastRegionHook: useToastRegion as never } as never));
  expect(document.querySelector('[data-vm="region"]')).not.toBeNull();
  expect(screen.getByText('fake toast')).toBeTruthy();
});

it('SecretInput reflects the reveal state of the injected hook', () => {
  const useSecretReveal = vi.fn(() => ({ inputType: 'text', toggleLabel: 'Fake hide', toggle: vi.fn() }));
  render(h(SecretInput, { label: 'Key', value: 'abc', onChange: vi.fn(), useSecretRevealHook: useSecretReveal as never }));
  expect(screen.getByRole('button', { name: 'Fake hide' })).toBeTruthy();
  expect(document.querySelector('input')?.getAttribute('type')).toBe('text');
});
