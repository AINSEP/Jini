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

const MEMBER_OK = { status: 200, body: { result: { executionId: 'e1', status: 'completed', output: { content: [{ type: 'text', text: 'member result' }] } } } };
const NOTE = '"fam" is a group; ran fam.a';

async function callGateway({ answers, args, readOnly = false, signal }: { answers: ReadonlyArray<{ status: number; body: unknown }>; args: Record<string, unknown>; readOnly?: boolean; signal?: AbortSignal }) {
  const daemon = fakeDaemon(answers);
  const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: daemon.fetchImpl, ...(signal === undefined ? {} : { signal }) };
  const factory = readOnly ? createExecuteReadonlyDelegatedToolTool : createExecuteDelegatedToolTool;
  const tool = factory({ runId: 'run-1' }, { generateToolUseId: ids() });
  const outcome = await Promise.resolve(tool.handler({ args, ctx })).then((value: unknown) => ({ value }), (error: unknown) => ({ error: error as Error }));
  return { ...daemon, outcome };
}

describe('gateway call that names a group of tools and selects one member', () => {
  it('sends a second ordinary request for the member and returns the member\'s result with the note', async () => {
    const run = await callGateway({ answers: [familyAnswer, MEMBER_OK], args: { toolId: 'fam', input: { kind: 'a', q: 1 } } });
    expect(run.requests).toEqual([
      { runId: 'run-1', toolUseId: 'use-1', toolId: 'fam', input: { kind: 'a', q: 1 } },
      { runId: 'run-1', toolUseId: 'use-2', toolId: 'fam.a', input: { q: 1 } },
    ]);
    expect(run.outcome).toEqual({ value: { content: [{ type: 'text', text: 'member result' }, { type: 'text', text: `normalized: ${NOTE}` }], normalizationNotes: [NOTE] } });
  });

  it('the read-only gateway retries with requireReadOnly true, as the first request had', async () => {
    const run = await callGateway({ answers: [familyAnswer, MEMBER_OK], args: { toolId: 'fam', input: { kind: 'a' } }, readOnly: true });
    expect(run.requests.map(request => request.requireReadOnly)).toEqual([true, true]);
    expect(run.requests[1]).toMatchObject({ toolId: 'fam.a', input: {}, requireReadOnly: true });
  });

  it('the unconstrained gateway sends no requireReadOnly on either request', async () => {
    const run = await callGateway({ answers: [familyAnswer, MEMBER_OK], args: { toolId: 'fam', input: { kind: 'a' } } });
    expect(run.requests.map(request => 'requireReadOnly' in request)).toEqual([false, false]);
  });

  it('a member the server refuses on the read-only gateway comes back with the server\'s refusal text unchanged', async () => {
    const refusal = { status: 403, body: { error: { code: 'TOOL_OPERATION_DENIED', message: 'tool "fam.a" is not registered as read-only' } } };
    const run = await callGateway({ answers: [familyAnswer, refusal], args: { toolId: 'fam', input: { kind: 'a' } }, readOnly: true });
    expect(run.outcome).toEqual({ error: expect.objectContaining({ message: 'HTTP 403: TOOL_OPERATION_DENIED: tool "fam.a" is not registered as read-only' }) });
    expect(run.requests).toHaveLength(2);
  });

  it('the second request\'s failure is its own: nothing of the first answer is in it', async () => {
    const failure = { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'q must be a string' } } };
    const run = await callGateway({ answers: [familyAnswer, failure], args: { toolId: 'fam', input: { kind: 'a', q: 1 } } });
    expect(run.outcome).toEqual({ error: expect.objectContaining({ message: 'HTTP 400: BAD_REQUEST: q must be a string' }) });
  });

  it('a second answer that is itself UNKNOWN_TOOL ends the chain: never a third request', async () => {
    const run = await callGateway({ answers: [familyAnswer, familyAnswer], args: { toolId: 'fam', input: { kind: 'a' } } });
    expect(run.requests).toHaveLength(2);
    expect(run.outcome).toEqual({ error: expect.objectContaining({ message: `HTTP 404: UNKNOWN_TOOL: ${FAMILY_TEXT}` }) });
  });
});

describe('gateway call that names a group of tools and does not select exactly one member', () => {
  const CASES: ReadonlyArray<{ name: string; input: unknown; family?: unknown; signal?: AbortSignal }> = [
    { name: 'no selector key in the input', input: { q: 1 } },
    { name: 'two selector keys present', input: { kind: 'a', type: 'b' }, family: { id: 'fam', members: ['fam.a', 'fam.b'], selector: { keys: ['kind', 'type'], byValue: { a: 'fam.a', b: 'fam.b' } } } },
    { name: 'the value is not a string', input: { kind: 1 } },
    { name: 'the value is not an own key of byValue', input: { kind: 'toString' } },
    { name: 'the mapped member is not in the family members', input: { kind: 'a' }, family: { id: 'fam', members: ['fam.b'], selector: { keys: ['kind'], byValue: { a: 'fam.a' } } } },
    { name: 'the call was already cancelled', input: { kind: 'a' }, signal: AbortSignal.abort() },
    { name: 'the input is absent', input: undefined },
  ];

  it.each(CASES)('$name: no retry, the original error comes back unchanged', async ({ input, family, signal }) => {
    const answer = family === undefined ? familyAnswer : { status: 404, body: { error: { ...FAMILY_ERROR, details: { family } } } };
    const run = await callGateway({ answers: [answer], args: { toolId: 'fam', ...(input === undefined ? {} : { input }) }, ...(signal === undefined ? {} : { signal }) });
    expect(run.requests.length).toBeLessThanOrEqual(1);
    expect(run.outcome).toEqual({ error: expect.objectContaining({ message: expect.stringContaining('HTTP 404') }) });
    if (signal === undefined) expect(run.outcome).toEqual({ error: expect.objectContaining({ message: `HTTP 404: UNKNOWN_TOOL: ${FAMILY_TEXT}` }) });
  });

  it('an error that is not UNKNOWN_TOOL is never retried, even with a family in its details', async () => {
    const other = { status: 404, body: { error: { ...FAMILY_ERROR, code: 'NOT_FOUND' } } };
    const run = await callGateway({ answers: [other], args: { toolId: 'fam', input: { kind: 'a' } } });
    expect(run.requests).toHaveLength(1);
  });

  it('the decision reads the code and details, never the message text', async () => {
    const reworded = { status: 404, body: { error: { ...FAMILY_ERROR, message: 'a differently worded sentence' } } };
    const run = await callGateway({ answers: [reworded, MEMBER_OK], args: { toolId: 'fam', input: { kind: 'a' } } });
    expect(run.requests).toHaveLength(2);
  });
});
