import { describe, expect, it } from 'vitest';
import { createExecuteDelegatedToolTool, createExecuteReadonlyDelegatedToolTool } from '../delegated-tool.js';
import type { McpToolContext } from '../../tool-protocol.js';

const FAMILY_TEXT = '"fam" is a group of tools, not one tool. Call one of: fam.a, fam.b.';
const FAMILY_ERROR = {
  code: 'UNKNOWN_TOOL',
  message: FAMILY_TEXT,
  details: { family: { id: 'fam', members: ['fam.a', 'fam.b'], selector: { keys: ['kind'], byValue: { a: 'fam.a', b: 'fam.b' } } } },
};

/** A daemon that answers each POST with the next queued answer and records every request body. */
function fakeDaemon(answers: ReadonlyArray<{ status: number; body: unknown }>) {
  const requests: Record<string, unknown>[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const answer = answers[Math.min(requests.length - 1, answers.length - 1)]!;
    return Response.json(answer.body, { status: answer.status });
  };
  return { requests, fetchImpl };
}

function ids() {
  let count = 0;
  return (_required: Record<string, never>) => `use-${++count}`;
}

const familyAnswer = { status: 404, body: { error: FAMILY_ERROR } };

describe('gateway call that names a group of tools', () => {
  it('today: one request, and the model reads the server\'s group sentence', async () => {
    const daemon = fakeDaemon([familyAnswer]);
    const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: daemon.fetchImpl };
    const tool = createExecuteDelegatedToolTool({ runId: 'run-1' }, { generateToolUseId: ids() });
    await expect(tool.handler({ args: { toolId: 'fam', input: { kind: 'a', q: 1 } }, ctx })).rejects.toThrow(`HTTP 404: UNKNOWN_TOOL: ${FAMILY_TEXT}`);
    expect(daemon.requests).toHaveLength(1);
  });

  it('today (read-only gateway): the same single request', async () => {
    const daemon = fakeDaemon([familyAnswer]);
    const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: daemon.fetchImpl };
    const tool = createExecuteReadonlyDelegatedToolTool({ runId: 'run-1' }, { generateToolUseId: ids() });
    await expect(tool.handler({ args: { toolId: 'fam', input: { kind: 'a', q: 1 } }, ctx })).rejects.toThrow(`HTTP 404: UNKNOWN_TOOL: ${FAMILY_TEXT}`);
    expect(daemon.requests).toHaveLength(1);
  });
});
