import { render, renderHook, screen } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AdminKitProvider, Button, useAdminThemeKit, useDirtyGuard, useFetchQuery, useMediaProviderRules } from '../kit.js';
import { fakeAdminKit, fixtureQuery } from '../testing-kit.js';
import { renderWithAdminKit } from './render-with-admin-kit.js';

describe('admin kit contract', () => {
  it('throws a plain-words error when a facade renders outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Button>x</Button>)).toThrow(/need <AdminKitProvider kit=/);
    spy.mockRestore();
  });

  it('keeps the first kit when the provider re-renders with another', () => {
    const second = vi.fn(() => <span>second</span>);
    const first = fakeAdminKit();
    const other = fakeAdminKit({ components: { Button: second } });
    const view = render(<AdminKitProvider kit={first}><Button>one</Button></AdminKitProvider>);
    view.rerender(<AdminKitProvider kit={other}><Button>one</Button></AdminKitProvider>);
    expect(second).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'one' })).toBeTruthy();
  });

  it('forwards props and the ref to the kit component', () => {
    const received = vi.fn();
    const kit = fakeAdminKit({ components: { Button: (p) => <button ref={p.ref} onClick={() => p.onPress?.({})}>{p.children}</button> } });
    const ref = createRef<HTMLButtonElement>();
    renderWithAdminKit(<Button ref={ref} onPress={received}>go</Button>, { kit });
    screen.getByRole('button', { name: 'go' }).click();
    expect(received).toHaveBeenCalledWith({});
    expect(ref.current).toBe(screen.getByRole('button', { name: 'go' }));
  });

  it('hook facades return the kit values', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdminKitProvider kit={fakeAdminKit({ query: fixtureQuery({ data: 'rows' }) })}>{children}</AdminKitProvider>
    );
    expect(renderHook(() => useDirtyGuard({ current: 1, original: 2 }), { wrapper }).result.current.isDirty).toBe(true);
    expect(renderHook(() => useFetchQuery({ key: ['a'], fetch: async () => 'x' }), { wrapper }).result.current.data).toBe('rows');
    expect(renderHook(() => useMediaProviderRules(), { wrapper }).result.current.maskedKeyLabel({ entry: undefined })).toBeNull();
    expect(renderHook(() => useAdminThemeKit(), { wrapper }).result.current.resolveColorScheme({ preference: 'dark' })).toBe('dark');
  });
});


it('uses an injected kit and forwards the original button ref without the hook prop', () => {
  const received = vi.fn();
  const kit = fakeAdminKit({ components: { Button: (props) => {
    received(props);
    return <button ref={props.ref}>{props.children}</button>;
  } } });
  const ref = createRef<HTMLButtonElement>();
  render(<Button ref={ref} useAdminKitHook={() => kit}>Injected button</Button>);
  expect(ref.current).toBe(screen.getByRole('button', { name: 'Injected button' }));
  expect(received.mock.calls[0]![0]).not.toHaveProperty('useAdminKitHook');
});
