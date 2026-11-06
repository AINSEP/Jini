import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isValidElementHandle } from '@jini-ai/agentic';
import { useAgentHandle } from '../useAgentHandle.js';

function Control({ name, agentHandle }: { name: string; agentHandle?: string | false | undefined }) {
  return <button data-agent-element={useAgentHandle({ agentHandle })}>{name}</button>;
}

describe('useAgentHandle', () => {
  it('generates valid distinct handles across roots and keeps keyed identity after reordering', () => {
    const { rerender } = render(<>{['first', 'second'].map(name => <Control key={name} name={name} />)}</>);
    const first = screen.getByRole('button', { name: 'first' }).getAttribute('data-agent-element')!;
    const second = screen.getByRole('button', { name: 'second' }).getAttribute('data-agent-element')!;
    expect(isValidElementHandle({ handle: first })).toBe(true);
    expect(isValidElementHandle({ handle: second })).toBe(true);
    expect(first).not.toBe(second);
    render(<Control name="other root" />);
    expect(screen.getByRole('button', { name: 'other root' }).getAttribute('data-agent-element')).not.toBe(first);
    rerender(<>{['second', 'first'].map(name => <Control key={name} name={name} />)}</>);
    expect(screen.getByRole('button', { name: 'first' })).toHaveAttribute('data-agent-element', first);
    expect(screen.getByRole('button', { name: 'second' })).toHaveAttribute('data-agent-element', second);
  });

  it('preserves explicit names and removes the handle on explicit opt-out', () => {
    const { rerender } = render(<Control name="save" agentHandle="durable-save" />);
    expect(screen.getByRole('button')).toHaveAttribute('data-agent-element', 'durable-save');
    rerender(<Control name="save" agentHandle={false} />);
    expect(screen.getByRole('button')).not.toHaveAttribute('data-agent-element');
  });
});
