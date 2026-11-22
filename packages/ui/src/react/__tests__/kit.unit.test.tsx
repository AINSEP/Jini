import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SecretInput, UiKitProvider, useOverlayContainer } from '../kit.js';
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
