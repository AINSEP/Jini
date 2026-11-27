import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CodeWrapToggle } from '../../../react/components/CodeWrapToggle.js';
import { useCodeWrap } from '../../../react/hooks/useCodeWrap.js';

const t = (key: string) => `tr:${key}`;

/** The toggle wired to the hook it is designed for, as a code viewer composes them. */
function Harness() {
  const { wrap, toggleWrap } = useCodeWrap();
  return <CodeWrapToggle wrap={wrap} onToggle={toggleWrap} t={t} agentHandleId="code-wrap" className="wrap-btn" />;
}

describe('CodeWrapToggle', () => {
  it('shows the translated pressed state and flips it on every click', () => {
    render(<Harness />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('wrap-btn');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('tr:Wrap: on');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('tr:Wrap: off');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('tr:Wrap: on');
  });

  it('carries its agent handle, role and label', () => {
    render(<CodeWrapToggle wrap={false} onToggle={() => undefined} t={t} agentHandleId="viewer-wrap" />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('data-agent-element', 'viewer-wrap');
    expect(button).toHaveAttribute('data-agent-role', 'button');
    expect(button).toHaveAttribute('data-agent-label', 'Toggle line wrapping for this file');
  });

  it('rejects a handle that is not a valid element handle', () => {
    expect(() => render(<CodeWrapToggle wrap onToggle={() => undefined} t={t} agentHandleId=".css > selector" />)).toThrow(/invalid element handle/);
  });
});

describe('useCodeWrap', () => {
  it('starts wrapped, toggles, and a remount resets to wrapped', () => {
    const first = renderHook(() => useCodeWrap());
    expect(first.result.current.wrap).toBe(true);
    act(() => first.result.current.toggleWrap());
    expect(first.result.current.wrap).toBe(false);
    act(() => first.result.current.toggleWrap());
    expect(first.result.current.wrap).toBe(true);
    act(() => first.result.current.toggleWrap());
    first.unmount();
    expect(renderHook(() => useCodeWrap()).result.current.wrap).toBe(true);
  });
});
