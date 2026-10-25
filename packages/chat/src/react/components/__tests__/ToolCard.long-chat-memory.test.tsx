import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { executePageCapability, type FindElementsResult } from '@jini-ai/agentic/core';
import { createDomPageDriver } from '@jini-ai/agentic/dom';
import type { AgentEvent, ChatMessage } from '../../../core/index.js';
import { MessageList } from '../MessageList.js';
import { ToolCard } from '../ToolCard.js';

const longInput = 'i'.repeat(20_000) + ' input-tail';
const longOutput = 'o'.repeat(20_000) + ' output-tail';

/** Reproduce the measured 38-message / 713-card shape without private production chat data. */
function longChat(): ChatMessage[] {
  return Array.from({ length: 19 }, (_, turn): ChatMessage[] => {
    const events = Array.from({ length: turn < 10 ? 38 : 37 }, (_, index): AgentEvent[] => {
      const id = `call-${turn}-${index}`;
      return [
        { kind: 'tool_use', id, name: 'page.fill', input: { element: 'name-input', payload: longInput } },
        { kind: 'tool_result', toolUseId: id, content: longOutput, isError: false },
      ];
    }).flat();
    return [
      { id: `user-${turn}`, role: 'user', content: `Request ${turn}` },
      { id: `assistant-${turn}`, role: 'assistant', content: '', events, runStatus: 'succeeded' },
    ];
  }).flat();
}

describe('tool-card memory in a restored chat', () => {
  it('bounds a 713-card transcript and unmounts expanded detail again on close', async () => {
    const messages = longChat();
    const { container } = render(<MessageList messages={messages} />);
    const list = container.querySelector('.jini-message-list')!;
    const nodes = list.querySelectorAll('*').length;
    expect(list.querySelectorAll('[data-message-id]')).toHaveLength(38);
    expect(list.querySelectorAll('.op-card')).toHaveLength(713);
    expect(list.querySelectorAll('pre, .accordion-collapsible-inner')).toHaveLength(0);
    // A structural budget, not a timing or heap claim: leave room for ordinary message chrome,
    // but fail if each collapsed card starts retaining its full panel again.
    expect(nodes).toBeLessThan(713 * 15 + 38 * 20);
    const summaries = Array.from(list.querySelectorAll('.op-card-reader-text'));
    expect(summaries).toHaveLength(713);
    expect(summaries.every(node => node.textContent?.length === 801)).toBe(true);
    expect(list.textContent!.length).toBeLessThan(713 * 900 + 38 * 100);

    const firstCard = list.querySelector('.op-card') as HTMLElement;
    const toggle = within(firstCard).getByRole('button');
    const panelId = toggle.getAttribute('aria-controls')!;
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(panelId)?.querySelector('.op-input')?.textContent)
      .toBe(JSON.stringify({ element: 'name-input', payload: longInput }, null, 2));
    expect(document.getElementById(panelId)?.querySelector('.op-output')?.textContent).toBe(longOutput);
    expect(list.querySelectorAll('pre')).toHaveLength(2);
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(list.querySelectorAll('pre, .accordion-collapsible-inner')).toHaveLength(0);
    expect(list.querySelectorAll('*')).toHaveLength(nodes);
    // Rendering never truncates the source events that the conversation store keeps.
    expect(messages[1]!.events![1]).toMatchObject({ content: longOutput });
    expect(messages[1]!.events![0]).toMatchObject({ input: { payload: longInput } });
  });

  it('lets the real page reader inspect a collapsed call and its live result without clicking', async () => {
    const use = { kind: 'tool_use' as const, id: 'reader', name: 'page.fill', input: { element: 'name-input' } };
    const { container, rerender } = render(<ToolCard use={use} runStreaming />);
    const driver = createDomPageDriver({ root: container, pages: {} });
    const read = async () => await executePageCapability({
      driver, capabilityId: 'page.find_elements', input: { query: 'tool-call-reader', withState: true },
    }) as FindElementsResult;

    const pending = await read();
    expect(pending.elements).toHaveLength(1);
    expect(pending.elements[0]!.state?.text).toContain('name-input');
    expect(pending.elements[0]!.state?.text).toContain('Waiting for the result or answer…');
    rerender(<ToolCard use={use} result={{ kind: 'tool_result', toolUseId: 'reader', content: 'Saved Ada', isError: false }} runSucceeded />);
    const completed = await read();
    expect(completed.elements[0]!.state?.text).toContain('name-input');
    expect(completed.elements[0]!.state?.text).toContain('Saved Ada');
    expect(completed.elements[0]!.state?.text).not.toContain('Waiting for the result or answer…');
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelectorAll('pre')).toHaveLength(0);
  });

  it('caps and redacts every collapsed error sink while expansion retains the complete safe text', async () => {
    const key = 'sk-' + 'AbCdEf0123456789'.repeat(2);
    const content = `failed ${key}: ${longOutput}`;
    const { container } = render(<ToolCard
      use={{ kind: 'tool_use', id: 'error', name: 'page.fill', input: { payload: longInput } }}
      result={{ kind: 'tool_result', toolUseId: 'error', content, isError: true }}
    />);
    const badge = container.querySelector('.op-status-error')!;
    expect(badge.getAttribute('title')).toHaveLength(400);
    expect(badge.getAttribute('title')).toContain('[token removed]');
    expect(container.querySelector('.op-output')?.textContent).toHaveLength(400);
    expect(container.querySelector('.op-output')?.textContent).toContain('[token removed]');
    expect(container.querySelector('.op-card-reader-text')?.textContent).toHaveLength(801);
    expect(container.innerHTML).not.toContain(key);
    expect(container.textContent!.length + badge.getAttribute('title')!.length).toBeLessThan(2_000);

    await userEvent.click(screen.getByRole('button'));
    expect(container.querySelector('.accordion-collapsible .op-output')?.textContent)
      .toBe(`failed [token removed]: ${longOutput}`);
    expect(container.querySelector('.op-input')?.textContent)
      .toBe(JSON.stringify({ payload: longInput }, null, 2));
    expect(container.innerHTML).not.toContain(key);
  });

  it('caps and redacts a collapsed head summary drawn from an arbitrary argument', () => {
    const key = 'sk-' + 'AbCdEf0123456789'.repeat(2);
    const { container } = render(<>
      <ToolCard use={{ kind: 'tool_use', id: 'jini', name: 'page.fill', input: { payload: `${key} ${longInput}` } }} />
      <ToolCard use={{ kind: 'tool_use', id: 'mcp', name: 'mcp__vendor__send', input: { body: `${key} ${longInput}` } }} />
    </>);
    const metas = Array.from(container.querySelectorAll('.op-meta'), node => node.textContent!);
    expect(metas).toHaveLength(2);
    for (const meta of metas) {
      expect(meta).toHaveLength(200);
      expect(meta).toContain('[token removed] iii');
    }
    expect(container.innerHTML).not.toContain(key);
  });
});
