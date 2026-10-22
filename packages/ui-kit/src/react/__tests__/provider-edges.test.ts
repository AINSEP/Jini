/** Provider configuration, hook preconditions and kit composition edges, through the public React surface. */
import { createElement as h } from 'react';
import { render, renderHook, fireEvent, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as publicApi from '../index.js';
import { KitProvider, ToastRegion, ConfirmDialog, createKit, createStrictKit, extendKit, useToast, Button } from '../index.js';
import { useToastRegion } from '../Kit.hooks.js';
import { isDevelopment } from '../context.js';
import { nativeKit } from '../native/index.js';
import { KitConfigError } from '../../needs.js';
import { createToastService } from '../../toast.js';
import type { ReactKit } from '../types.js';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('KitProvider needs', () => {
  it('accepts declared needs the kit implements', () => {
    render(h(KitProvider, { needs: [{ id: 'composer', contract: '^1', components: ['Button', 'TextArea'] }], children: h(Button, {}, 'Send') }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('refuses a planned component and an incompatible contract before rendering children', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(h(KitProvider, { needs: [{ id: 'grid', contract: '^1', components: ['Table'] }], children: 'never' })))
      .toThrow(new KitConfigError({ issues: ['grid: Table is not implemented'] }));
    expect(() => render(h(KitProvider, { needs: [{ id: 'next', contract: '^2', components: ['Button'] }], children: 'never' })))
      .toThrow(/incompatible/);
  });
});

describe('hook preconditions', () => {
  it('useToast and a service-less ToastRegion require a provider or an injected service', () => {
    expect(() => renderHook(() => useToast())).toThrow('useToast requires a KitProvider or an injected toast service');
    expect(() => renderHook(() => useToastRegion({}))).toThrow('ToastRegion requires a KitProvider or a service');
  });

  it('useToast returns the provider service', () => {
    const service = createToastService({});
    const { result } = renderHook(() => useToast(), { wrapper: ({ children }) => h(KitProvider, { toast: service, children }) });
    expect(result.current).toBe(service);
    service.dispose({});
  });
});

describe('ToastRegion', () => {
  it('passes a toast tone through to the rendered notification', () => {
    const service = createToastService({}, { durationMs: 0 });
    service.push({ message: 'Disk full', tone: 'danger' });
    service.push({ message: 'Saved' });
    const overlay = document.createElement('div'); document.body.append(overlay);
    render(h(KitProvider, { toast: service, overlayContainer: overlay, children: h(ToastRegion) }));
    expect(overlay.querySelector('[role="alert"]')?.textContent).toContain('Disk full');
    expect(overlay.querySelector('[role="status"]')?.textContent).toContain('Saved');
    cleanup(); overlay.remove(); service.dispose({});
  });
});

describe('ConfirmDialog cancel', () => {
  it('the cancel button dismisses through the caller onCancel', () => {
    const onCancel = vi.fn(), onConfirm = vi.fn();
    render(h(KitProvider, { children: h(ConfirmDialog, { open: true, title: 'Delete record?', confirmLabel: 'Delete', onCancel, onConfirm }) }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('kit composition', () => {
  it('createStrictKit names every missing component and accepts a complete kit', () => {
    // An untyped (JavaScript) caller's incomplete map: the strict builder's runtime check is its only guard.
    const incomplete = { Button: nativeKit.Button } as Partial<ReactKit> as ReactKit;
    expect(() => createStrictKit({ components: incomplete })).toThrow(KitConfigError);
    try { createStrictKit({ components: incomplete }); } catch (error) {
      expect((error as KitConfigError).message).toContain('missing ConfirmDialog');
      expect((error as KitConfigError).message).not.toContain('missing Button');
    }
    expect(createStrictKit({ components: { ...nativeKit } }, { id: 'complete' }).id).toBe('complete');
  });

  it('extendKit inherits the base id, contract and guard unless overridden', () => {
    const base = createKit({ components: { Button: nativeKit.Button } }, { id: 'house', guard: 'off' });
    const extended = extendKit({ base, components: { Badge: nativeKit.Badge } });
    expect([extended.id, extended.contract, extended.guard]).toEqual(['house', base.contract, 'off']);
    expect(extended.overrides).toEqual(['Button', 'Badge']);
  });
});

describe('development detection', () => {
  it('treats a runtime without process (a browser with no NODE_ENV shim) as development', () => {
    vi.stubGlobal('process', undefined);
    const detected = isDevelopment({});
    vi.unstubAllGlobals();
    expect(detected).toBe(true);
  });
});

describe('public React entry', () => {
  it('re-exports the provider, kit builders, hooks and facades', () => {
    for (const name of ['KitProvider', 'Overlay', 'ToastRegion', 'createKit', 'createStrictKit', 'extendKit', 'describeKit', 'useKit', 'useKitComponent', 'useOverlayContainer', 'useToast', 'ConfirmDialog', 'useConfirmController']) {
      expect(typeof Reflect.get(publicApi, name), name).toBe('function');
    }
    // Facades are ref-forwarding components, so they render through the kit like any element type.
    render(h(publicApi.Notice, { children: 'Facade rendered' }));
    expect(screen.getByText('Facade rendered')).toBeTruthy();
  });
});
