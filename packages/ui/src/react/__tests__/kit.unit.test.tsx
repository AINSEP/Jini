import { createRef } from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SecretInput, UiKitProvider, useOverlayContainer, useSecretReveal } from '../kit.js';
import { fakeUiKit } from '../testing.js';
import { renderWithUiKit } from './render-with-ui-kit.js';

function Probe() {
  return <span data-testid="probe">{useOverlayContainer() === document.body ? 'body' : 'other'}</span>;
}

describe('UiKitProvider / facades', () => {
  it('throws a plain-words error when no provider is mounted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/need <UiKitProvider kit=\{\.\.\.\}>/);
    spy.mockRestore();
  });

  it('routes hooks to the mounted kit', () => {
    renderWithUiKit(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('body');
  });

  it('keeps the first kit when the prop changes', () => {
    const other = { ...fakeUiKit, hooks: { ...fakeUiKit.hooks, useOverlayContainer: () => null } };
    const { rerender } = render(<UiKitProvider kit={fakeUiKit}><Probe /></UiKitProvider>);
    rerender(<UiKitProvider kit={other}><Probe /></UiKitProvider>);
    expect(screen.getByTestId('probe').textContent).toBe('body');
  });

  it('SecretInput facade forwards ref to the kit input', () => {
    const ref = createRef<HTMLInputElement>();
    renderWithUiKit(<SecretInput label="API key" ref={ref} />);
    expect(ref.current).toBe(screen.getByLabelText('API key'));
  });
});


it('uses the injected input kit and forwards the same ref without leaking the hook', () => {
  const seen = vi.fn();
  const kit = { ...fakeUiKit, components: { SecretInput: (props: import('../kit.js').KitSecretInputProps) => {
    seen(props);
    return <input ref={props.ref} aria-label={props.label} />;
  } } };
  const ref = createRef<HTMLInputElement>();
  render(<SecretInput label="Injected key" ref={ref} useUiKitHook={() => kit} />);
  expect(ref.current).toBe(screen.getByLabelText('Injected key'));
  expect(seen.mock.calls[0]![0]).not.toHaveProperty('useUiKitHook');
});

describe('fakeUiKit', () => {
  it('starts hidden and flips type and label on each toggle, through the kit facade', () => {
    const labels = { show: 'Show key', hide: 'Hide key' };
    const hook = renderHook(() => useSecretReveal({ value: 'x', labels }), { wrapper: ({ children }) => <UiKitProvider kit={fakeUiKit}>{children}</UiKitProvider> });
    expect(hook.result.current).toMatchObject({ revealed: false, inputType: 'password', toggleLabel: 'Show key' });
    act(() => hook.result.current.toggle());
    expect(hook.result.current).toMatchObject({ revealed: true, inputType: 'text', toggleLabel: 'Hide key' });
    act(() => hook.result.current.toggle());
    expect(hook.result.current).toMatchObject({ revealed: false, inputType: 'password', toggleLabel: 'Show key' });
  });

  it('renders a password input that password managers will not autofill, wired to value and change', () => {
    const changes: string[] = [];
    const Input = fakeUiKit.components.SecretInput;
    render(<Input label="Token" value="tok-a" onChange={(e) => changes.push(e.target.value)} />);
    const input = screen.getByLabelText('Token');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    expect(input).toHaveValue('tok-a');
    fireEvent.change(input, { target: { value: 'tok-b' } });
    expect(changes).toEqual(['tok-b']);
  });
});
