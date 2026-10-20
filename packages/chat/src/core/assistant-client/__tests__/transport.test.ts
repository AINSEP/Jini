import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '../../events.js';
import type { ChatMessage } from '../../messages.js';
import type { RunHandlers, StartRunInput } from '../../transport.js';
import { notices } from '../../run-events/__tests__/fixture.js';
import type { AgUiRunClient } from '../ag-ui-transport.js';
import { createAssistantTransportClient, type AssistantExecutionConfig, type AssistantTransportOptions, type AssistantTransportPorts } from '../transport.js';

const pluginState = vi.hoisted(() => ({
  capture: vi.fn<(required: { event: { kind: string; name?: string; data?: unknown } }) => void>(),
  read: vi.fn(() => ({ decision: { selected: ['saved-plugin'] }, excluded: [] as string[] })),
}));
vi.mock('../../agent-plugin-chat-state.js', () => ({
  captureAgentPluginUsage: pluginState.capture,
  readAgentPluginChatState: pluginState.read,
}));

beforeEach(() => { pluginState.capture.mockClear(); pluginState.read.mockClear(); });

type AcceptInput = Parameters<AssistantTransportPorts['acceptRun']>[0];
type FollowInput = Parameters<AssistantTransportPorts['followRun']>[0];
interface FetchCall { url: string; init: RequestInit | undefined }

/** One fake port set whose calls are recorded for assertion. */
function harness(overrides: Partial<AssistantTransportPorts> = {}) {
  const accepted: AcceptInput[] = [];
  const followed: FollowInput[] = [];
  const bound: Array<Parameters<AssistantTransportPorts['bindRun']>[0]> = [];
  const fetched: FetchCall[] = [];
  const agUiStarted: StartRunInput[] = [];
  const agUiStopped: string[] = [];
  const agUiReattached: RunHandlers[] = [];
  const agUi: AgUiRunClient = {
    isAgUiRunId: ({ runId }) => runId.startsWith('ag:'),
    handleAgUiEvent: () => {},
    startAgUiRun: async ({ input }) => { agUiStarted.push(input); return { runId: 'ag:1' }; },
    reattachAgUiRun: async ({ handlers }) => { agUiReattached.push(handlers); },
    fetchAgUiRunStatus: async () => null,
    stopAgUiRun: async ({ runId }) => { agUiStopped.push(runId); },
  };
  const ports: AssistantTransportPorts = {
    runsUrl: '/runs', byokTurnUrl: '/byok', byokRunIdPrefix: 'byok:', notices,
    mintId: () => 'minted',
    fetch: async (url, init) => { fetched.push({ url: String(url), init }); return new Response('event: end\ndata: {}\n\n'); },
    projectPrompt: ({ prompt }) => prompt,
    projectInput: ({ input }) => input,
    bindRun: (required) => { bound.push(required); },
    runBinding: () => undefined,
    followRun: (required) => { followed.push(required); },
    acceptRun: async (required) => { accepted.push(required); return new Response(JSON.stringify({ run: { id: 'run-1' } })); },
    agUi,
    ...overrides,
  };
  const client = createAssistantTransportClient({ ports }, {});
  const transport = (options: AssistantTransportOptions = {}) => client.createAssistantTransport({ options }, {});
  return { client, transport, accepted, followed, bound, fetched, agUiStarted, agUiStopped, agUiReattached };
}

/** Handlers that record every call and expose the turn's settlement as a promise. */
function recorder(extra: Partial<RunHandlers> = {}) {
  const events: AgentEvent[] = [];
  const errors: Error[] = [];
  const done: AgentEvent[][] = [];
  let resolveDone: () => void = () => {};
  const settled = new Promise<void>((resolve) => { resolveDone = resolve; });
  const handlers: RunHandlers = {
    onEvent: (event) => { events.push(event); },
    onError: (error) => { errors.push(error); },
    onDone: (final) => { done.push(final); resolveDone(); },
    ...extra,
  };
  return { events, errors, done, settled, handlers };
}

const user = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `u-${content}`, role: 'user', content, ...extra });
const assistant = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `a-${content}`, role: 'assistant', content, ...extra });
const input = (history: ChatMessage[], extra: Partial<StartRunInput> = {}): StartRunInput => ({ history, signal: new AbortController().signal, ...extra });
const contextRefOf = (call: AcceptInput | undefined) => JSON.parse((call?.body as { contextRef: string }).contextRef) as Record<string, unknown>;
const byokBodyOf = (call: FetchCall | undefined) => JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
const sse = (text: string) => new Response(text).body as ReadableStream<Uint8Array>;
const byokConfig = (byok: Partial<AssistantExecutionConfig['byok']> = {}): AssistantExecutionConfig => ({
  mode: 'byok', byok: { protocol: 'anthropic', apiKey: 'k', baseUrl: '', model: 'm', ...byok },
});
const pluginEvent = (conversationId: string, excluded: string[] = []): AgentEvent => ({
  kind: 'ext', name: 'agent_plugins', data: { conversationId, state: { decision: null, excluded }, plugins: [] },
});
const erroringBody = (reason: unknown) => new ReadableStream<Uint8Array>({ start(controller) { controller.error(reason); } });

describe('historyForTranscript', () => {
  it('drops an assistant turn whose run did not succeed', () => {
    const { client } = harness();
    expect(client.historyForTranscript({ history: [user('q'), assistant('partial', { runStatus: 'failed' })] }, {})).toEqual([user('q')]);
  });

  it('keeps a legacy assistant turn that carries no run status', () => {
    const { client } = harness();
    expect(client.historyForTranscript({ history: [user('q'), assistant('legacy')] }, {})).toEqual([user('q'), assistant('legacy')]);
  });
});

describe('undeliveredUserPrompt', () => {
  it('falls back to the newest user turn when the history ends in an answered turn', () => {
    const { client } = harness();
    expect(client.undeliveredUserPrompt({ history: [user('q'), assistant('a', { runStatus: 'succeeded' })] }, {})).toBe('q');
  });

  it('returns the bare newest turn when only one turn is pending', () => {
    const { client } = harness();
    expect(client.undeliveredUserPrompt({ history: [user('q'), assistant('a'), user('next')] }, {})).toBe('next');
  });

  it('joins every unanswered turn behind the undelivered-turns note', () => {
    const { client } = harness();
    const prompt = client.undeliveredUserPrompt({ history: [user('one'), assistant('x', { runStatus: 'failed' }), user('two')] }, {});
    expect(prompt).toBe("[Some of the messages below never reached you: the run that should have answered them failed before it could. Treat them as the user's own words, in order, and answer all of them.]\n\none\n\ntwo");
  });

  it('collapses a resend of the newest text carrying the same attachments into one request', () => {
    const { client } = harness();
    const file = { path: 'attachment:1', name: 'f', kind: 'file' as const };
    expect(client.undeliveredUserPrompt({ history: [user(' same ', { attachments: [file] }), user('same', { attachments: [file] })] }, {})).toBe('same');
  });

  it('collapses a plain resend of the newest text with no attachments into one request', () => {
    const { client } = harness();
    expect(client.undeliveredUserPrompt({ history: [user('again'), user('again')] }, {})).toBe('again');
  });

  it('keeps a resend of the newest text whose attachments differ', () => {
    const { client } = harness();
    const file = { path: 'attachment:1', name: 'f', kind: 'file' as const };
    expect(client.undeliveredUserPrompt({ history: [user('same', { attachments: [file] }), user('same')] }, {})).toContain('same\n\nsame');
  });
});

describe('buildLocalCliContextRef', () => {
  it('forwards every optional context field that is present and well-formed', () => {
    const { client } = harness();
    const ref = client.buildLocalCliContextRef({
      input: input([user('q')], {
        assistantMessageId: 'am',
        attachments: [{ path: 'attachment:1', name: 'f', kind: 'file' }],
        context: { frontendBindToken: 'tok', model: 'opus', reasoning: 'high', pluginRefIds: ['p1', '', 3], agentPluginState: 's', userPrompt: 'q', conversationId: 'c1', pageContext: { path: '/x' } },
      }),
      prompt: 'q',
    }, {});
    expect(ref).toEqual({
      prompt: 'q', coldStartContext: '## user\nq', assistantMessageId: 'am', frontendBindToken: 'tok', model: 'opus', reasoning: 'high',
      attachmentIds: ['attachment:1'], pluginRefIds: ['p1'], agentPluginState: 's', userPrompt: 'q', conversationId: 'c1', pageContext: { path: '/x' },
    });
  });

  it('omits every optional field that is empty or malformed', () => {
    const { client } = harness();
    const ref = client.buildLocalCliContextRef({
      input: input([user('q')], { attachments: [], context: { frontendBindToken: '', model: '', reasoning: 7, pluginRefIds: [''], conversationId: '', pageContext: ['x'] } }),
      prompt: 'q',
    }, {});
    expect(Object.keys(ref).sort()).toEqual(['agentPluginState', 'assistantMessageId', 'coldStartContext', 'prompt', 'userPrompt']);
  });

  it('omits plugin refs that are not an array', () => {
    const { client } = harness();
    expect(client.buildLocalCliContextRef({ input: input([user('q')], { context: { pluginRefIds: 'p1', pageContext: null } }), prompt: 'q' }, {})).not.toHaveProperty('pluginRefIds');
  });

  it('prefers the resolved conversation id over the context one', () => {
    const { client } = harness();
    expect(client.buildLocalCliContextRef({ input: input([user('q')], { context: { conversationId: 'old' } }), prompt: 'q', resolvedConversationId: 'new' }, {})).toMatchObject({ conversationId: 'new' });
  });

  it('labels an unanswered assistant turn with its agent name and status detail in the cold-start transcript', () => {
    const { client } = harness();
    const failed = assistant('', { agentName: 'Claude', runStatus: 'failed', events: [{ kind: 'status', label: 'Run failed', detail: 'exit 1' }, { kind: 'text', text: 'ignored' }] });
    const ref = client.buildLocalCliContextRef({ input: input([user('q'), failed, user('again')]), prompt: 'again' }, {});
    expect(ref['coldStartContext']).toContain('[Claude run failed; not a completed answer]\nRun failed: exit 1');
  });

  it('labels an unanswered assistant turn with no output and no events as producing no reply', () => {
    const { client } = harness();
    const ref = client.buildLocalCliContextRef({ input: input([user('q'), assistant('', { agentId: 'codex', runStatus: 'canceled' }), user('again')]), prompt: 'again' }, {});
    expect(ref['coldStartContext']).toContain('[codex run canceled; not a completed answer]\nNo assistant reply was produced.');
  });

  it('labels an unanswered assistant turn with no agent identity as the Assistant', () => {
    const { client } = harness();
    const ref = client.buildLocalCliContextRef({ input: input([user('q'), assistant('half', { runStatus: 'running' }), user('again')]), prompt: 'again' }, {});
    expect(ref['coldStartContext']).toContain('[Assistant run running; not a completed answer]\nhalf');
  });
});

describe('handleByokFrame', () => {
  const frameCtx = () => { const r = recorder(); const collected: AgentEvent[] = []; const finish = vi.fn(); return { r, collected, finish, ctx: { collected, handlers: r.handlers, finish } }; };

  it('collects and emits a translated agent frame', () => {
    const { client } = harness();
    const { r, collected, ctx } = frameCtx();
    client.handleByokFrame({ frame: { event: 'agent', data: JSON.stringify({ type: 'text_delta', delta: 'hi' }) }, ctx }, {});
    expect([collected, r.events]).toEqual([[{ kind: 'text', text: 'hi' }], [{ kind: 'text', text: 'hi' }]]);
  });

  it('ignores an agent frame whose payload type is not translatable', () => {
    const { client } = harness();
    const { r, ctx } = frameCtx();
    client.handleByokFrame({ frame: { event: 'agent', data: JSON.stringify({ type: 'thinking_start' }) }, ctx }, {});
    expect(r.events).toEqual([]);
  });

  it('reports an error frame with its message', () => {
    const { client } = harness();
    const { r, ctx } = frameCtx();
    client.handleByokFrame({ frame: { event: 'error', data: JSON.stringify({ message: 'quota' }) }, ctx }, {});
    expect(r.errors.map((error) => error.message)).toEqual(['quota']);
  });

  it('reports an error frame with no message as a generic BYOK failure', () => {
    const { client } = harness();
    const { r, ctx } = frameCtx();
    client.handleByokFrame({ frame: { event: 'error', data: '{}' }, ctx }, {});
    expect(r.errors.map((error) => error.message)).toEqual(['BYOK turn failed']);
  });

  it('emits the step-limit notice and finishes on an end frame with the tool-turn reason', () => {
    const { client } = harness();
    const { r, collected, finish, ctx } = frameCtx();
    client.handleByokFrame({ frame: { event: 'end', data: JSON.stringify({ reason: 'max_tool_turns' }) }, ctx }, {});
    expect([r.events, collected, finish.mock.calls.length]).toEqual([[notices.toolStepLimit], [notices.toolStepLimit], 1]);
  });

  it('finishes without a notice on a plain end frame', () => {
    const { client } = harness();
    const { r, finish, ctx } = frameCtx();
    client.handleByokFrame({ frame: { event: 'end', data: '{}' }, ctx }, {});
    expect([r.events, finish.mock.calls.length]).toEqual([[], 1]);
  });

  it('ignores a frame of any other event name', () => {
    const { client } = harness();
    const { r, finish, ctx } = frameCtx();
    client.handleByokFrame({ frame: { event: 'ping', data: 'x' }, ctx }, {});
    expect([r.events, r.errors, finish.mock.calls.length]).toEqual([[], [], 0]);
  });
});

describe('consumeByokStream', () => {
  const streamCtx = (aborted = false) => {
    const r = recorder();
    const controller = new AbortController();
    if (aborted) controller.abort();
    const finish = vi.fn();
    return { r, finish, ctx: { runId: 'byok:x', collected: [] as AgentEvent[], handlers: r.handlers, finish, controller } };
  };

  it('finishes once the stream drains', async () => {
    const { client } = harness();
    const { finish, ctx } = streamCtx();
    await client.consumeByokStream({ body: sse('event: agent\ndata: {"type":"text_delta","delta":"a"}\n\n'), ctx }, {});
    expect([ctx.collected, finish.mock.calls.length]).toEqual([[{ kind: 'text', text: 'a' }], 1]);
  });

  it('finishes silently when the stream fails after a deliberate abort', async () => {
    const { client } = harness();
    const { r, finish, ctx } = streamCtx(true);
    await client.consumeByokStream({ body: erroringBody(new Error('aborted')), ctx }, {});
    expect([r.errors, finish.mock.calls.length]).toEqual([[], 1]);
  });

  it('reports a real stream failure before finishing', async () => {
    const { client } = harness();
    const order: string[] = [];
    const { ctx } = streamCtx();
    const handlers: RunHandlers = { ...ctx.handlers, onError: (error) => { order.push(`error:${error.message}`); } };
    await client.consumeByokStream({ body: erroringBody(new Error('net down')), ctx: { ...ctx, handlers, finish: () => { order.push('finish'); } } }, {});
    expect(order).toEqual(['error:net down', 'finish']);
  });

  it('wraps a non-Error stream failure in an Error', async () => {
    const { client } = harness();
    const { r, ctx } = streamCtx();
    await client.consumeByokStream({ body: erroringBody('boom'), ctx }, {});
    expect(r.errors.map((error) => error.message)).toEqual(['boom']);
  });
});

describe('startRun guard and identity', () => {
  it('refuses a history with no user message', async () => {
    const { transport } = harness();
    await expect(transport().startRun(input([assistant('a')]), recorder().handlers)).rejects.toThrow('no user message to send');
  });

  it('adopts a conversation and its saved plugin state when the context names none', async () => {
    const h = harness();
    await h.transport({ ensureConversationId: async () => 'adopted' }).startRun(input([user('q')]), recorder().handlers);
    expect(contextRefOf(h.accepted[0])).toMatchObject({ conversationId: 'adopted', agentPluginState: { decision: { selected: ['saved-plugin'] }, excluded: [] }, userPrompt: 'q' });
  });

  it('keeps the context conversation without asking for a new one', async () => {
    const h = harness();
    const ensure = vi.fn(async () => 'adopted');
    await h.transport({ ensureConversationId: ensure }).startRun(input([user('q')], { context: { conversationId: 'given' } }), recorder().handlers);
    expect([ensure.mock.calls.length, h.accepted[0]?.conversationId]).toEqual([0, 'given']);
  });

  it('sends the turn without a conversation when adoption resolves null', async () => {
    const h = harness();
    await h.transport({ ensureConversationId: async () => null }).startRun(input([user('q')]), recorder().handlers);
    expect([h.accepted[0]?.conversationId, contextRefOf(h.accepted[0])['conversationId']]).toEqual([undefined, undefined]);
  });

  it('sends the turn without a conversation when adoption rejects', async () => {
    const h = harness();
    await h.transport({ ensureConversationId: async () => { throw new Error('offline'); } }).startRun(input([user('q')]), recorder().handlers);
    expect(h.accepted[0]?.conversationId).toBeUndefined();
  });

  it('sends the turn without a conversation when adoption resolves an empty id', async () => {
    const h = harness();
    await h.transport({ ensureConversationId: async () => '' }).startRun(input([user('q')]), recorder().handlers);
    expect(h.accepted[0]?.conversationId).toBeUndefined();
  });
});

describe('startRun Local CLI path', () => {
  it('posts the context ref, agent id and idempotency key to acceptance', async () => {
    const h = harness();
    const message = user('q');
    await h.transport().startRun(input([message], { agentId: 'claude', assistantMessageId: 'am' }), recorder().handlers);
    const call = h.accepted[0];
    expect([(call?.body as { agentId: string }).agentId, (call?.body as { idempotencyKey: string }).idempotencyKey, call?.messageId, contextRefOf(call)['userMessage']]).toEqual(['claude', 'am', 'am', message]);
  });

  it('passes the cancel signal as both the acceptance and request signal', async () => {
    const h = harness();
    const cancelSignal = new AbortController().signal;
    await h.transport().startRun(input([user('q')], { cancelSignal }), recorder().handlers);
    expect([h.accepted[0]?.signal, h.accepted[0]?.requestSignal]).toEqual([cancelSignal, cancelSignal]);
  });

  it('falls back to the subscription signal for the request when no cancel signal is given', async () => {
    const h = harness();
    const turn = input([user('q')]);
    await h.transport().startRun(turn, recorder().handlers);
    expect([Object.hasOwn(h.accepted[0] ?? {}, 'signal'), h.accepted[0]?.requestSignal]).toEqual([false, turn.signal]);
  });

  it('sends a stateless agent the full transcript', async () => {
    const h = harness();
    await h.transport({ getResumeCapableAgentIds: () => new Set(['claude']) }).startRun(input([user('a'), assistant('b'), user('c')], { agentId: 'qwen' }), recorder().handlers);
    expect(contextRefOf(h.accepted[0])['prompt']).toBe('## user\na\n\n## assistant\nb\n\n## user\nc');
  });

  it('sends the full transcript when no agent id is given', async () => {
    const h = harness();
    await h.transport({ getResumeCapableAgentIds: () => new Set(['claude']) }).startRun(input([user('a'), assistant('b'), user('c')]), recorder().handlers);
    expect(contextRefOf(h.accepted[0])['prompt']).toContain('## assistant\nb');
  });

  it('sends a resume-capable agent only the newest turn after its own legacy answer', async () => {
    const h = harness();
    await h.transport({ getResumeCapableAgentIds: () => new Set(['claude']) }).startRun(input([user('a'), assistant('b'), user('c')], { agentId: 'claude' }), recorder().handlers);
    expect(contextRefOf(h.accepted[0])['prompt']).toBe('c');
  });

  it('persists the newest user turn into the resolved conversation before acceptance', async () => {
    const order: string[] = [];
    const h = harness({ acceptRun: async () => { order.push('accept'); return new Response(JSON.stringify({ run: { id: 'r' } })); } });
    const newest = user('c');
    await h.transport({ persistUserTurn: async ({ conversationId, message }) => { order.push(`persist:${conversationId}:${message.id}`); } })
      .startRun(input([user('a'), newest], { context: { conversationId: 'conv' } }), recorder().handlers);
    expect(order).toEqual(['persist:conv:u-c', 'accept']);
  });

  it('still dispatches when persisting the user turn rejects', async () => {
    const h = harness();
    await h.transport({ persistUserTurn: async () => { throw new Error('disk full'); } }).startRun(input([user('q')], { context: { conversationId: 'conv' } }), recorder().handlers);
    expect(h.accepted).toHaveLength(1);
  });

  it('skips persisting when no conversation could be resolved', async () => {
    const h = harness();
    const persist = vi.fn(async () => {});
    await h.transport({ persistUserTurn: persist }).startRun(input([user('q')]), recorder().handlers);
    expect(persist).not.toHaveBeenCalled();
  });

  it('binds and follows the accepted run when acceptance names its message and conversation', async () => {
    const h = harness({ acceptRun: async () => new Response(JSON.stringify({ run: { id: 'r9' }, messageId: 'm', conversationId: 'c' })) });
    const turn = input([user('q')]);
    const result = await h.transport().startRun(turn, recorder().handlers);
    expect([result, h.bound, h.followed[0]?.runId, h.followed[0]?.signal]).toEqual([{ runId: 'r9' }, [{ runId: 'r9', binding: { messageId: 'm', conversationId: 'c' } }], 'r9', turn.signal]);
  });

  it('follows without binding when acceptance omits the conversation', async () => {
    const h = harness({ acceptRun: async () => new Response(JSON.stringify({ run: { id: 'r9' }, messageId: 'm' })) });
    await h.transport().startRun(input([user('q')]), recorder().handlers);
    expect([h.bound, h.followed.length]).toEqual([[], 1]);
  });

  it('throws the status and truncated detail when acceptance is refused', async () => {
    const h = harness({ acceptRun: async () => new Response('x'.repeat(400), { status: 503 }) });
    await expect(h.transport().startRun(input([user('q')]), recorder().handlers)).rejects.toThrow(/^agent run failed to start \(503\): x{300}$/);
  });

  it('throws the bare status when a refused acceptance has no body', async () => {
    const h = harness({ acceptRun: async () => new Response(null, { status: 500 }) });
    await expect(h.transport().startRun(input([user('q')]), recorder().handlers)).rejects.toThrow(/^agent run failed to start \(500\)$/);
  });

  it('throws the bare status when reading a refused acceptance body fails', async () => {
    const h = harness({ acceptRun: async () => new Response(erroringBody(new Error('reset')), { status: 502 }) });
    await expect(h.transport().startRun(input([user('q')]), recorder().handlers)).rejects.toThrow(/^agent run failed to start \(502\)$/);
  });
});

describe('startRun AG-UI path', () => {
  it('hands the AG-UI client only the history a transcript may be built from', async () => {
    const h = harness();
    const result = await h.transport({ getAgUiEnabled: () => true }).startRun(input([user('q'), assistant('dead', { runStatus: 'failed' }), user('again')]), recorder().handlers);
    expect([result, h.agUiStarted[0]?.history.map((message) => message.content), h.accepted]).toEqual([{ runId: 'ag:1' }, ['q', 'again'], []]);
  });

  it('is bypassed by BYOK mode', async () => {
    const h = harness();
    await h.transport({ getAgUiEnabled: () => true, getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), recorder().handlers);
    expect([h.agUiStarted, h.fetched[0]?.url]).toEqual([[], '/byok']);
  });
});

describe('startRun BYOK path', () => {
  it('posts the non-empty answered history with credentials and every present field', async () => {
    const h = harness();
    const history = [user('q', { secretRedaction: { secretRedacted: true, count: 1 } }), assistant('  '), assistant('dead', { runStatus: 'failed' }), assistant('ok'), user('next')];
    const result = await h.transport({ getExecutionConfig: () => byokConfig({ baseUrl: 'https://p', maxTokens: 5 }) }).startRun(input(history, {
      attachments: [{ path: 'attachment:1', name: 'f', kind: 'file' }],
      context: { conversationId: 'c', agentPluginState: 'ps', pluginRefIds: ['p'], pageContext: { path: '/x' } },
    }), recorder().handlers);
    expect(result).toEqual({ runId: 'byok:minted' });
    expect(byokBodyOf(h.fetched[0])).toEqual({
      messages: [{ role: 'user', content: 'q', secretRedacted: true }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'next' }],
      attachmentIds: ['attachment:1'], conversationId: 'c', agentPluginState: { decision: { selected: ['saved-plugin'] }, excluded: [] }, userPrompt: 'next', pluginRefIds: ['p'], pageContext: { path: '/x' },
      byok: { protocol: 'anthropic', apiKey: 'k', baseUrl: 'https://p', model: 'm', maxTokens: 5 },
    });
  });

  it('omits an empty base URL and an unset token cap from the credential block', async () => {
    const h = harness();
    await h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), recorder().handlers);
    expect(byokBodyOf(h.fetched[0])['byok']).toEqual({ protocol: 'anthropic', apiKey: 'k', model: 'm' });
  });

  it('sends the request as a same-origin JSON POST', async () => {
    const h = harness();
    await h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), recorder().handlers);
    expect([h.fetched[0]?.init?.method, h.fetched[0]?.init?.headers, h.fetched[0]?.init?.credentials]).toEqual(['POST', { 'Content-Type': 'application/json' }, 'same-origin']);
  });

  it('settles the turn with the streamed events', async () => {
    const h = harness({ fetch: async () => new Response('event: agent\ndata: {"type":"text_delta","delta":"hi"}\n\nevent: end\ndata: {}\n\n') });
    const r = recorder();
    await h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), r.handlers);
    await r.settled;
    expect(r.done).toEqual([[{ kind: 'text', text: 'hi' }]]);
  });

  it('aborts the in-flight request when the turn signal aborts', async () => {
    const h = harness();
    const turnSignal = new AbortController();
    await h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')], { signal: turnSignal.signal }), recorder().handlers);
    turnSignal.abort();
    expect(h.fetched[0]?.init?.signal?.aborted).toBe(true);
  });

  it('rethrows a network failure as the same Error', async () => {
    const failure = new Error('offline');
    const h = harness({ fetch: async () => { throw failure; } });
    await expect(h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), recorder().handlers)).rejects.toBe(failure);
  });

  it('wraps a non-Error network failure in an Error', async () => {
    const h = harness({ fetch: async () => { throw 'dns'; } });
    await expect(h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), recorder().handlers)).rejects.toThrow(/^dns$/);
  });

  it('throws the status and truncated detail when the turn is refused', async () => {
    const h = harness({ fetch: async () => new Response('y'.repeat(400), { status: 400 }) });
    await expect(h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), recorder().handlers)).rejects.toThrow(/^BYOK turn failed to start \(400\): y{300}$/);
  });

  it('throws the bare status when the refused turn body cannot be read', async () => {
    const h = harness({ fetch: async () => new Response(erroringBody(new Error('reset')), { status: 502 }) });
    await expect(h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), recorder().handlers)).rejects.toThrow(/^BYOK turn failed to start \(502\)$/);
  });

  it('throws when an accepted turn has no body to stream', async () => {
    const h = harness({ fetch: async () => new Response(null, { status: 200 }) });
    await expect(h.transport({ getExecutionConfig: () => byokConfig() }).startRun(input([user('q')]), recorder().handlers)).rejects.toThrow(/^BYOK turn failed to start \(200\)$/);
  });
});

describe('plugin usage capture', () => {
  const followedHandlers = async (extra: Partial<RunHandlers> = {}) => {
    const h = harness();
    const r = recorder(extra);
    await h.transport().reattachRun('run-1', r.handlers);
    return { r, wrapped: h.followed[0]?.handlers as RunHandlers };
  };

  it('captures a plugin usage event before delivering it', async () => {
    const order: string[] = [];
    pluginState.capture.mockImplementationOnce(() => { order.push('capture'); });
    const { wrapped } = await followedHandlers({ onEvent: () => { order.push('deliver'); } });
    wrapped.onEvent(pluginEvent('c'));
    expect(order).toEqual(['capture', 'deliver']);
  });

  it('captures an unchanged plugin state only once per conversation', async () => {
    const { wrapped } = await followedHandlers();
    wrapped.onEvent(pluginEvent('c'));
    wrapped.onEvent(pluginEvent('c'));
    wrapped.onEvent(pluginEvent('c', ['x']));
    expect(pluginState.capture).toHaveBeenCalledTimes(2);
  });

  it('delivers without capturing events that are not well-formed plugin usage', async () => {
    const { r, wrapped } = await followedHandlers();
    const ignored: AgentEvent[] = [
      { kind: 'text', text: 't' },
      { kind: 'ext', name: 'other', data: {} },
      { kind: 'ext', name: 'agent_plugins', data: undefined },
      { kind: 'ext', name: 'agent_plugins', data: { conversationId: 'c' } },
      { kind: 'ext', name: 'agent_plugins', data: { conversationId: 'c', state: { excluded: 'x' } } },
    ];
    for (const event of ignored) wrapped.onEvent(event);
    expect([pluginState.capture.mock.calls.length, r.events]).toEqual([0, ignored]);
  });

  it('delivers without capturing a well-formed usage payload under another extension name', async () => {
    const { wrapped } = await followedHandlers();
    wrapped.onEvent({ kind: 'ext', name: 'other_plugins', data: { conversationId: 'c', state: { decision: null, excluded: [] }, plugins: [] } });
    expect(pluginState.capture).not.toHaveBeenCalled();
  });

  it('adds no checkpoint handler when the caller supplied none', async () => {
    const { wrapped } = await followedHandlers();
    expect(wrapped.onCheckpoint).toBeUndefined();
  });

  it('captures only the latest well-formed plugin state per conversation from a checkpoint, then delivers it', async () => {
    const checkpoints: ChatMessage[] = [];
    const { wrapped } = await followedHandlers({ onCheckpoint: (message) => { checkpoints.push(message); } });
    const latest = pluginEvent('c', ['new']);
    const message = assistant('saved', { events: [pluginEvent('c', ['old']), { kind: 'text', text: 't' }, { kind: 'ext', name: 'agent_plugins', data: { conversationId: 'c' } }, latest] });
    wrapped.onCheckpoint?.(message);
    expect([pluginState.capture.mock.calls.map(([required]) => required.event), checkpoints]).toEqual([[latest], [message]]);
  });

  it('delivers a checkpoint that carries no events', async () => {
    const checkpoints: ChatMessage[] = [];
    const { wrapped } = await followedHandlers({ onCheckpoint: (message) => { checkpoints.push(message); } });
    wrapped.onCheckpoint?.(assistant('saved'));
    expect([pluginState.capture.mock.calls.length, checkpoints.length]).toEqual([0, 1]);
  });
});

describe('reattachRun', () => {
  it('reports a BYOK run as already over', async () => {
    const h = harness();
    const r = recorder();
    await h.transport().reattachRun('byok:1', r.handlers);
    expect([r.done, h.followed]).toEqual([[[]], []]);
  });

  it('delegates an AG-UI run to the AG-UI client', async () => {
    const h = harness();
    const r = recorder();
    await h.transport().reattachRun('ag:1', r.handlers);
    expect(h.agUiReattached).toEqual([r.handlers]);
  });

  it('follows a daemon run with the caller signal', async () => {
    const h = harness();
    const signal = new AbortController().signal;
    await h.transport().reattachRun('run-1', recorder().handlers, { signal });
    expect([h.followed[0]?.runId, h.followed[0]?.signal]).toEqual(['run-1', signal]);
  });

  it('follows a daemon run without a signal key when none is given', async () => {
    const h = harness();
    await h.transport().reattachRun('run-1', recorder().handlers);
    expect(Object.hasOwn(h.followed[0] ?? {}, 'signal')).toBe(false);
  });
});

describe('fetchRunStatus', () => {
  const statusFor = async (state: string) => {
    const h = harness({ fetch: async () => new Response(JSON.stringify({ run: { state } })) });
    return h.transport().fetchRunStatus('run-1');
  };

  it('has no status for a BYOK run', async () => {
    const h = harness();
    expect([await h.transport().fetchRunStatus('byok:1'), h.fetched]).toEqual([null, []]);
  });

  it('delegates an AG-UI run to the AG-UI client', async () => {
    const h = harness();
    expect([await h.transport().fetchRunStatus('ag:1'), h.fetched]).toEqual([null, []]);
  });

  it('reads a daemon run status from its encoded run URL', async () => {
    const h = harness({ fetch: async (url, init) => { h.fetched.push({ url: String(url), init }); return new Response(JSON.stringify({ run: { state: 'running' } })); } });
    expect([await h.transport().fetchRunStatus('r/1'), h.fetched[0]?.url, h.fetched[0]?.init?.credentials]).toEqual(['running', '/runs/r%2F1', 'same-origin']);
  });

  it.each([['pending', 'queued'], ['succeeded', 'succeeded'], ['failed', 'failed'], ['cancelled', 'canceled'], ['exploded', null]])('maps protocol state %s to %s', async (state, expected) => {
    expect(await statusFor(state)).toBe(expected);
  });

  it('has no status when the daemon refuses the lookup', async () => {
    const h = harness({ fetch: async () => new Response('', { status: 404 }) });
    expect(await h.transport().fetchRunStatus('run-1')).toBeNull();
  });
});

describe('stopRun', () => {
  it('aborts an in-flight BYOK turn and settles it without an error', async () => {
    let close: (reason: unknown) => void = () => {};
    const body = new ReadableStream<Uint8Array>({ start(controller) { close = (reason) => controller.error(reason); } });
    const h = harness({ fetch: async (url, init) => { h.fetched.push({ url: String(url), init }); return new Response(body); } });
    const r = recorder();
    const transport = h.transport({ getExecutionConfig: () => byokConfig() });
    const { runId } = await transport.startRun(input([user('q')]), r.handlers);
    await transport.stopRun(runId);
    close(new Error('aborted'));
    await r.settled;
    expect([h.fetched[0]?.init?.signal?.aborted, r.errors, r.done]).toEqual([true, [], [[]]]);
  });

  it('ignores a BYOK run id with no in-flight turn', async () => {
    const h = harness();
    await expect(h.transport().stopRun('byok:gone')).resolves.toBeUndefined();
  });

  it('delegates an AG-UI run to the AG-UI client', async () => {
    const h = harness();
    await h.transport().stopRun('ag:1');
    expect([h.agUiStopped, h.fetched]).toEqual([['ag:1'], []]);
  });

  it('posts a daemon cancel carrying the bound message id', async () => {
    const h = harness({ runBinding: () => ({ messageId: 'm', conversationId: 'c' }), fetch: async (url, init) => { h.fetched.push({ url: String(url), init }); return new Response('{}'); } });
    await h.transport().stopRun('r/1');
    expect([h.fetched[0]?.url, h.fetched[0]?.init?.method, byokBodyOf(h.fetched[0])]).toEqual(['/runs/r%2F1/cancel', 'POST', { runId: 'r/1', messageId: 'm' }]);
  });

  it('treats a cancel for a run the daemon no longer knows as done', async () => {
    const h = harness({ fetch: async () => new Response('gone', { status: 404 }) });
    await expect(h.transport().stopRun('run-1')).resolves.toBeUndefined();
  });

  it('throws the status and truncated detail when the cancel is refused', async () => {
    const h = harness({ fetch: async () => new Response('z'.repeat(400), { status: 403 }) });
    await expect(h.transport().stopRun('run-1')).rejects.toThrow(/^cancelling agent run failed \(403\): z{300}$/);
  });

  it('throws the bare status when a refused cancel has no body', async () => {
    const h = harness({ fetch: async () => new Response('', { status: 500 }) });
    await expect(h.transport().stopRun('run-1')).rejects.toThrow(/^cancelling agent run failed \(500\)$/);
  });
});
