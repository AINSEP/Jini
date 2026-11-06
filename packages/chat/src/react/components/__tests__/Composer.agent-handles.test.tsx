import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDomPageDriver } from '@jini-ai/agentic/dom';
import { Composer, type ComposerProps } from '../Composer.js';
import { useComposer } from '../../hooks/useComposer.js';

function Harness(props: Partial<Omit<ComposerProps, 'composer' | 'onSend'>> & { onSend?: () => void }) {
  const composer = useComposer();
  return <Composer composer={composer} onSend={props.onSend ?? (() => {})} {...props} />;
}

describe('Composer agent handles', () => {
  it('defaults to distinct stable handles for separate instances and preserves rerenders', () => {
    const { container, rerender } = render(<><Harness /><Harness /></>);
    const before = [...container.querySelectorAll('textarea')].map(field => field.getAttribute('data-agent-element'));
    expect(before[0]).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*-draft$/);
    expect(before[1]).not.toBe(before[0]);
    rerender(<><Harness placeholder="Changed label" /><Harness /></>);
    expect([...container.querySelectorAll('textarea')].map(field => field.getAttribute('data-agent-element'))).toEqual(before);
  });

  it('forwards an explicit base to draft, attachment, directory, send and stop leaves', () => {
    render(<Harness agentHandle="support-chat" running attachmentPicker={{ onFiles: vi.fn() }} onChangeWorkingDirectory={vi.fn()} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('data-agent-element', 'support-chat-draft');
    expect(screen.getByRole('button', { name: 'Attach files' })).toHaveAttribute('data-agent-element', 'support-chat-attach');
    expect(screen.getByRole('button', { name: 'Stop run' })).toHaveAttribute('data-agent-element', 'support-chat-stop');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('data-agent-element', 'support-chat-send');
    fireEvent.click(screen.getByTestId('composer-workdir-trigger'));
    expect(screen.getByRole('textbox', { name: 'Working directory path' })).toHaveAttribute('data-agent-element', 'support-chat-workdir-path');
    expect(screen.getByTestId('composer-workdir-confirm')).toHaveAttribute('data-agent-element', 'support-chat-workdir-set');
  });

  it('keeps opt-out through opened discovery and directory controls', () => {
    const { container } = render(<Harness agentHandle={false} onChangeWorkingDirectory={vi.fn()} attachmentPicker={{ onFiles: vi.fn() }}
      slots={{ discoveryGroups: [{ id: 'tools', label: 'Tools', items: [{ id: 'plugin/one', label: 'Insert plugin', insertText: 'plugin' }] }],
        plusMenuItems: [{ id: 'extra', label: 'Extra', onSelect: vi.fn() }] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
    expect(screen.getByRole('menuitem', { name: 'Insert plugin' })).not.toHaveAttribute('data-agent-element');
    fireEvent.click(screen.getByTestId('composer-workdir-trigger'));
    expect(screen.getByRole('textbox', { name: 'Working directory path' })).not.toHaveAttribute('data-agent-element');
    expect(container.querySelector('[data-agent-element]')).toBeNull();
  });

  it('lets a scoped driver fill the ordinary draft while an outside root refuses send', async () => {
    const onSend = vi.fn();
    const { container } = render(<main data-agent-page="chat"><Harness agentHandle="assistant" onSend={onSend} /></main>);
    const driver = createDomPageDriver({ root: container, pages: { chat: { label: 'Chat', navigate: () => {} } } });
    await act(async () => driver.fill({ handle: 'assistant-draft', text: 'Typed through driver' }));
    expect(screen.getByRole('textbox')).toHaveValue('Typed through driver');
    const restricted = document.createElement('main');
    document.body.append(restricted);
    try {
      const outside = createDomPageDriver({ root: restricted, pages: { chat: { label: 'Chat', navigate: () => {} } } });
      await expect(outside.click({ handle: 'assistant-send' })).rejects.toThrow();
      expect(onSend).not.toHaveBeenCalled();
    } finally { restricted.remove(); }
    expect(within(container).getByRole('button', { name: 'Send' })).toBeEnabled();
  });
});
