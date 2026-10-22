import { expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { writePromptToStdin } from '../events.js';

it('writes exact image pixels in the initial structured user message', () => {
  const write = vi.fn();
  const child = { stdin: { write } } as unknown as ChildProcess;
  writePromptToStdin({ promptInputFormat: 'stream-json' } as RuntimeAgentDef, child, 'what colours?', {
    imageContents: [{ mimeType: 'image/png', data: 'iVBORw==' }, { mimeType: 'image/png', data: 'iVBOSA==' }],
    closeStdinOnce: vi.fn(), recordSentBytes: vi.fn(), sendUserMessage: vi.fn(),
  });
  expect(write.mock.calls).toEqual([[JSON.stringify({ type: 'user', message: { role: 'user', content: [
    { type: 'text', text: 'what colours?' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw==' } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOSA==' } },
  ] } }) + '\n', 'utf8']]);
});
