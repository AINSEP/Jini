import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@jini-ai/chat/core';
import type { RunHandlers } from '@jini-ai/chat/react';
import { composeRunPrompt, createDaemonChatTransport, encodeRunContext, toAgentEvent } from './daemon-transport.js';

const handlers: RunHandlers = {
  onEvent: vi.fn(),
  onError: vi.fn(),
  onDone: vi.fn(),
};

it('starts a scoped run and delivers streamed text before the terminal callback', async () => {
  const calls: string[] = [];
  const events: unknown[] = [];
  let complete!: () => void;
  let fail!: (error: Error) => void;
  const finished = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (url === '/api/runs') {
      const body = JSON.parse(String(init?.body));
      expect(body.agentId).toBe('demo');
      expect(JSON.parse(Buffer.from(body.contextRef.slice('playground:'.length), 'base64url').toString())).toMatchObject({ project: 'bug-hunt', model: 'chosen', reasoning: 'high', workingDirectory: '/workspace' });
      return Response.json({ run: { id: 'run/1', state: 'running' } });
    }
    expect(url).toBe('/api/runs/run%2F1/events');
    return new Response('data: {"kind":"agent","payload":{"type":"text_delta","delta":"hello"}}\n\ndata: {"kind":"end","payload":{"status":"succeeded"}}\n\n');
  });
  vi.stubGlobal('fetch', fetch);
  try {
    expect(await createDaemonChatTransport().startRun({
      agentId: 'demo', history: [{ id: 'u', role: 'user', content: 'inspect' }],
      context: { project: 'bug-hunt', model: 'chosen', reasoning: 'high', workingDirectory: '/workspace' }, signal: new AbortController().signal,
    }, {
      onEvent(event) { calls.push('event'); events.push(event); },
      onError(error) { fail(error); },
      onDone(done) { calls.push('done'); expect(done).toEqual([{ kind: 'text', text: 'hello' }]); complete(); },
    })).toEqual({ runId: 'run/1' });
    await finished;
    expect(calls).toEqual(['event', 'done']);
    expect(events).toEqual([{ kind: 'text', text: 'hello' }]);
  } finally { vi.unstubAllGlobals(); }
});

describe('composeRunPrompt', () => {
  it('builds an ordered, sanitized multi-turn transcript without the synthetic welcome', () => {
    const history: ChatMessage[] = [
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Welcome to the playground.',
      },
      {
        id: 'user-1',
        role: 'user',
        content: 'Inspect the current project.',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        agentId: 'claude',
        content: [
          'I need one detail.',
          '<question-form><question>Which file?</question></question-form>',
        ].join('\n'),
      },
      {
        id: 'user-2',
        role: 'user',
        content: 'Start with package.json.',
      },
    ];

    const prompt = composeRunPrompt({ history, agentId: 'claude' });

    expect(prompt).toBe([
      '## user',
      'Inspect the current project.',
      '',
      '## assistant',
      'I need one detail.',
      '[question-form was emitted here on a prior turn; the user already answered, see their reply below.]',
      '',
      '## user',
      'Start with package.json.',
    ].join('\n'));
    expect(prompt).not.toContain('Welcome to the playground.');
    expect(prompt).not.toContain('<question-form>');
  });

  it('keeps only messages after the last assistant turn from another agent', () => {
    const history: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Use Claude for the first pass.',
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        agentId: 'claude',
        content: 'Claude analysis.',
      },
      {
        id: 'user-2',
        role: 'user',
        content: 'Now ask Codex to implement it.',
      },
    ];

    expect(composeRunPrompt({ history, agentId: 'codex' })).toBe([
      '## user',
      'Now ask Codex to implement it.',
    ].join('\n'));
  });
});

describe('encodeRunContext', () => {
  it('round-trips the selected runtime, directory, and attachments to the daemon context', () => {
    const attachment = {
      kind: 'image' as const,
      name: 'reference.png',
      path: '/tmp/jini-upload/reference.png',
      size: 128,
    };
    const encoded = encodeRunContext(
      'Inspect this project',
      'starter-site',
      'gpt-5.6-sol',
      'high',
      '/workspace/starter-site',
      [attachment],
    );
    const decoded = JSON.parse(
      Buffer.from(encoded.slice('playground:'.length), 'base64url').toString('utf8'),
    );

    expect(decoded).toEqual({
      prompt: 'Inspect this project',
      project: 'starter-site',
      model: 'gpt-5.6-sol',
      reasoning: 'high',
      workingDirectory: '/workspace/starter-site',
      attachments: [attachment],
    });
  });
});

describe('toAgentEvent', () => {
  it('does not render raw agent stdout as assistant text', () => {
    const claudeJsonl = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'I am Claude Code.' }],
      },
    });

    expect(
      toAgentEvent(
        { kind: 'stdout', payload: { chunk: `${claudeJsonl}\n` } },
        handlers,
      ),
    ).toBeNull();
  });

  it('renders the parsed text_delta agent event exactly once', () => {
    expect(
      toAgentEvent(
        {
          kind: 'agent',
          payload: { type: 'text_delta', delta: 'I am Claude Code.' },
        },
        handlers,
      ),
    ).toEqual({ kind: 'text', text: 'I am Claude Code.' });
  });

  it('keeps stderr available as diagnostic raw output', () => {
    expect(
      toAgentEvent(
        { kind: 'stderr', payload: { chunk: 'authentication warning' } },
        handlers,
      ),
    ).toEqual({ kind: 'raw', line: 'authentication warning' });
  });
});
