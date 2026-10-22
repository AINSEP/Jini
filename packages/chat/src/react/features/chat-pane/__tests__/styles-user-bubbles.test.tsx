import { cleanup, render, screen } from '@testing-library/react';
import type { CSSProperties } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../../core/index.js';
import { clearExtEventRenderers } from '../../../ext-event-renderer-registry.js';
import { MessageRow } from '../../../components/MessageRow.js';
import { registerMidRunUserMessageRenderer } from '../../../components/MidRunUserMessage.js';
import { CHAT_PANE_STYLES } from '../styles.js';

afterEach(() => { cleanup(); clearExtEventRenderers(); });

describe('sent user bubbles', () => {
  it.each([
    { label: 'short', text: 'short' },
    { label: 'long markdown/multiline', text: 'a long **markdown** message\n\nwith multiple lines '.repeat(20) },
  ])(
    'uses the same black and white bubble for ordinary and mid-run $label messages', ({ text }) => {
      registerMidRunUserMessageRenderer();
      const assistant: ChatMessage = {
        id: 'assistant', role: 'assistant', content: '', runId: 'run', runStatus: 'running',
        events: [{ kind: 'ext', name: 'user_message', data: { id: 'mid', text } }],
      };
      const { container } = render(<div className="jini-chat-pane">
        <style>{CHAT_PANE_STYLES}</style>
        <div className="jini-message-list">
          <MessageRow message={{ id: 'user', role: 'user', content: text }} />
          <MessageRow message={assistant} runStreaming />
        </div>
      </div>);
      const bubbles = container.querySelectorAll('.jini-message-user .jini-message-content');
      expect(bubbles).toHaveLength(2);
      // jsdom 25 does not resolve CSS variables. Assert the browser-facing declarations and
      // their applicability to both real renderer shapes rather than a fake variable resolver.
      const rules = Array.from(container.querySelector('style')!.sheet!.cssRules) as CSSStyleRule[];
      const rule = rules.find(rule => rule.selectorText === '.jini-chat-pane .jini-message-user .jini-message-content')!;
      expect(rule.style.getPropertyValue('background')).toBe('var(--jini-chat-user-bubble, #1a1b1c)');
      expect(rule.style.getPropertyValue('color')).toBe('var(--jini-chat-user-bubble-ink, #fff)');
      for (const bubble of bubbles) {
        expect(bubble.matches(rule.selectorText)).toBe(true);
      }
    },
  );

  it('exposes independent host colors without depending on the accent palette', () => {
    const { container } = render(<div className="jini-chat-pane" style={{
      '--jini-chat-user-bubble': '#123456', '--jini-chat-user-bubble-ink': '#fedcba',
      '--jini-chat-accent': '#ff0000',
    } as CSSProperties}>
      <style>{CHAT_PANE_STYLES}</style>
      <MessageRow message={{ id: 'user', role: 'user', content: 'Themed message' }} />
    </div>);
    const pane = container.querySelector('.jini-chat-pane')!;
    expect(getComputedStyle(pane).getPropertyValue('--jini-chat-user-bubble')).toBe('#123456');
    expect(getComputedStyle(pane).getPropertyValue('--jini-chat-user-bubble-ink')).toBe('#fedcba');
    const rules = Array.from(container.querySelector('style')!.sheet!.cssRules) as CSSStyleRule[];
    const bubble = container.querySelector('.jini-message-user .jini-message-content')!;
    const rule = rules.find(rule => rule.selectorText === '.jini-chat-pane .jini-message-user .jini-message-content')!;
    expect(bubble.matches(rule.selectorText)).toBe(true);
    expect(rule.style.getPropertyValue('background')).toBe('var(--jini-chat-user-bubble, #1a1b1c)');
    expect(rule.style.getPropertyValue('color')).toBe('var(--jini-chat-user-bubble-ink, #fff)');
  });

  it.each(['tools', 'text'] as const)('separates a mid-run bubble from preceding %s by the ordinary turn spacing', preceding => {
    registerMidRunUserMessageRenderer();
    const assistant: ChatMessage = {
      id: 'assistant', role: 'assistant', content: '', runId: 'run', runStatus: 'running',
      events: [
        ...(preceding === 'tools' ? [
          { kind: 'tool_use' as const, id: 'tool', name: 'site_guide', input: {} },
          { kind: 'tool_result' as const, toolUseId: 'tool', content: 'done', isError: false },
        ] : [{ kind: 'text' as const, text: 'Working on the page.' }]),
        { kind: 'ext', name: 'user_message', data: { id: 'mid', text: 'use sqlite' } },
      ],
    };
    const { container } = render(<div className="jini-chat-pane"><style>{CHAT_PANE_STYLES}</style>
      <MessageRow message={assistant} runStreaming />
    </div>);
    const bubble = screen.getByText('use sqlite').closest('.jini-message-user')!;
    const row = container.querySelector('.jini-message-assistant')!;
    expect(getComputedStyle(bubble).marginTop).toBe(getComputedStyle(row).marginBottom);
    expect(getComputedStyle(bubble).marginTop).toBe('20px');
    if (preceding === 'tools') expect(container.querySelector('.jini-message-tools')).not.toBeNull();
  });
});
