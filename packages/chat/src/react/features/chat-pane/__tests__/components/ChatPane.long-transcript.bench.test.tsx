/**
 * Local-only benchmark: renders a REAL long transcript (exported read-only from a site's chat.db,
 * mapped like `store/sql/store.ts`'s `toMessage`) and measures what one composer keystroke costs.
 * Skipped unless `JINI_CHAT_LONG_TRANSCRIPT` names that JSON file — the data is private and tens of
 * MB, so it never lives in the repo. Prints: mount time, transcript DOM size, and per keystroke the
 * wall time, React commit time and how many assistant rows re-rendered.
 */
import { Profiler } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '@jini-ai/chat';
import { clearExtEventRenderers, registerExtEventRenderer } from '../../../../ext-event-renderer-registry.js';
import { createFakeChatTransport } from '../../../../hooks/testing/fake-transport.js';
import { ChatPane } from '../../components/ChatPane.js';
import type { ChatPaneAgent } from '../../types.js';

const source = process.env.JINI_CHAT_LONG_TRANSCRIPT;
const agents: ChatPaneAgent[] = [{ id: 'codex', name: 'Codex CLI', available: true }];

describe.skipIf(!source || !existsSync(source))('ChatPane long-transcript benchmark (local data)', () => {
  afterEach(() => clearExtEventRenderers());

  it('measures per-keystroke cost', () => {
    const raw = JSON.parse(readFileSync(source!, 'utf8')) as ChatMessage[];
    // A probe ext event on each assistant reply: `MessageRow` calls its renderer on every render.
    const messages = raw.map((m) => (m.role === 'assistant' ? { ...m, events: [...(m.events ?? []), { kind: 'ext' as const, name: 'render-probe', data: {} }] } : m));
    let rowRenders = 0;
    registerExtEventRenderer({ name: 'render-probe', renderer: () => {
      rowRenders += 1;
      return null;
    } });
    let commitMs = 0;
    const mountStart = performance.now();
    render(
      <Profiler id="pane" onRender={(_id, _phase, actual) => { commitMs += actual; }}>
        <ChatPane transport={createFakeChatTransport()} agents={agents} initialMessages={messages} conversationId="c1" placeholder="Ask" />
      </Profiler>,
    );
    const mountMs = performance.now() - mountStart;
    const list = document.querySelector('.jini-message-list')!;
    const domNodes = list.querySelectorAll('*').length;
    const domChars = list.textContent?.length ?? 0;

    const textarea = screen.getByPlaceholderText('Ask');
    const keys = 'hello there, general kenobi';
    rowRenders = 0;
    commitMs = 0;
    let text = '';
    const start = performance.now();
    for (const ch of keys) {
      text += ch;
      fireEvent.change(textarea, { target: { value: text } });
    }
    const perKeyMs = (performance.now() - start) / keys.length;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      messages: messages.length,
      mountMs: Math.round(mountMs),
      transcriptDomNodes: domNodes,
      transcriptTextChars: domChars,
      perKeyWallMs: +perKeyMs.toFixed(2),
      perKeyCommitMs: +(commitMs / keys.length).toFixed(2),
      rowRendersPerKey: rowRenders / keys.length,
    }));
    expect(textarea).toHaveValue(text);
  }, 600_000);
});
