import { describe, expect, it } from 'vitest';
import {
  providerTurnAdapters,
  runProviderToolTurn,
  type ProviderChatMessage,
  type ProviderToolCall,
  type ProviderToolDescriptor,
  type ProviderToolResult,
  type ProviderTurnAdapters,
  type ProviderTurnEvent,
} from '../tool-turn.js';

type Adapter<K extends keyof ProviderTurnAdapters> = ProviderTurnAdapters[K];
type Required<K extends keyof ProviderTurnAdapters> = Parameters<Adapter<K>>[0];
type Optional<K extends keyof ProviderTurnAdapters> = NonNullable<Parameters<Adapter<K>>[1]>;
type ToolOutcome<K extends keyof ProviderTurnAdapters> = Awaited<ReturnType<NonNullable<Optional<K>['executeTool']>>>;
type AdapterEvent<K extends keyof ProviderTurnAdapters> = Parameters<Required<K>['onEvent']>[0];

const PLAIN_MESSAGES: ProviderChatMessage[] = [{ role: 'user', content: 'hi' }];
const IMAGE_MESSAGES: ProviderChatMessage[] = [
  { role: 'assistant', content: 'earlier' },
  { role: 'user', content: 'look', images: [{ mimeType: 'image/png', data: 'AAAA' }] },
];
const BARE_TOOL: ProviderToolDescriptor = { id: 'bare', inputSchema: 'not an object' };
const DESCRIBED_TOOL: ProviderToolDescriptor = { id: 'described', description: 'does things', inputSchema: { type: 'object', properties: {} } };
const DEFAULT_SCHEMA = { type: 'object', additionalProperties: false, required: [], properties: {} };

/**
 * A fake adapter that records its arguments, runs one tool call, then replays `events`.
 * Each fake is checked against its protocol's real adapter signature at the call site
 * (`result`/`events` are typed per protocol); the casts inside are only TypeScript's
 * inability to call through a generic indexed function type, not a widened contract.
 */
function fake<K extends keyof ProviderTurnAdapters>(
  protocol: K,
  { call, events = () => [], result }: {
    call?: ProviderToolCall;
    events?: (outcome: ToolOutcome<K> | undefined) => AdapterEvent<K>[];
    result: Awaited<ReturnType<Adapter<K>>>;
  },
) {
  const seen: { required?: Required<K>; optional?: Optional<K>; outcome?: ToolOutcome<K> } = {};
  const adapter = (async (required: Required<K>, optional: Optional<K>) => {
    seen.required = required;
    seen.optional = optional;
    const outcome = call ? ((await optional.executeTool!(call as never)) as ToolOutcome<K>) : undefined;
    if (outcome) seen.outcome = outcome;
    for (const event of events(outcome)) (required.onEvent as (e: AdapterEvent<K>) => void)(event);
    return result;
  }) as unknown as Adapter<K>;
  return { adapters: { ...providerTurnAdapters, [protocol]: adapter } as ProviderTurnAdapters, seen };
}

function run(
  protocol: keyof ProviderTurnAdapters,
  adapters: ProviderTurnAdapters,
  {
    messages = PLAIN_MESSAGES,
    tools = [BARE_TOOL],
    toolResult = { content: 'done' },
    ...optional
  }: {
    messages?: ProviderChatMessage[];
    tools?: ProviderToolDescriptor[];
    toolResult?: ProviderToolResult;
    baseUrl?: string;
    maxTokens?: number;
    maxToolTurns?: number;
    signal?: AbortSignal;
  } = {},
) {
  const events: ProviderTurnEvent[] = [];
  const calls: ProviderToolCall[] = [];
  const turn = runProviderToolTurn(
    {
      protocol,
      adapters,
      apiKey: 'key',
      model: 'model-x',
      system: 'be brief',
      messages,
      tools,
      executeTool: async (c) => { calls.push(c); return toolResult; },
      onEvent: (e) => events.push(e),
    },
    optional,
  );
  return { turn, events, calls };
}

const CALL: ProviderToolCall = { id: 'call-1', name: 'described', input: { a: 1 } };
const signal = new AbortController().signal;

describe('runProviderToolTurn (anthropic adapter mapping)', () => {
  it('sends defaults when no optional settings are given', async () => {
    const { adapters, seen } = fake('anthropic', { result: { stopReason: 'end_turn', toolTurns: 0 } });
    await run('anthropic', adapters).turn;
    expect(seen.required).toMatchObject({ apiKey: 'key', model: 'model-x', maxTokens: 8192, messages: [{ role: 'user', content: 'hi' }] });
    expect(seen.optional).toMatchObject({ system: 'be brief', tools: [{ name: 'bare', input_schema: DEFAULT_SCHEMA }] });
    expect(seen.optional).not.toHaveProperty('baseUrl');
    expect(seen.optional).not.toHaveProperty('maxToolTurns');
    expect(seen.optional).not.toHaveProperty('signal');
  });

  it('forwards optional settings, tool descriptions and image messages', async () => {
    const { adapters, seen } = fake('anthropic', { result: { stopReason: 'end_turn', toolTurns: 0 } });
    await run('anthropic', adapters, { baseUrl: 'https://a.example', maxTokens: 10, maxToolTurns: 2, signal, tools: [DESCRIBED_TOOL], messages: IMAGE_MESSAGES }).turn;
    expect(seen.required).toMatchObject({ maxTokens: 10 });
    expect(seen.optional).toMatchObject({ baseUrl: 'https://a.example', maxToolTurns: 2, signal, tools: [{ name: 'described', description: 'does things' }] });
    expect(seen.required!.messages[1]!.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ]);
  });

  it('passes a string tool result through without an isError flag', async () => {
    const { adapters, seen } = fake('anthropic', { call: CALL, result: { stopReason: 'end_turn', toolTurns: 1 } });
    const { turn, calls } = run('anthropic', adapters);
    await turn;
    expect(calls).toEqual([CALL]);
    expect(seen.outcome).toEqual({ content: 'done' });
  });

  it('maps block tool results and keeps isError', async () => {
    const { adapters, seen } = fake('anthropic', { call: CALL, result: { stopReason: 'end_turn', toolTurns: 1 } });
    await run('anthropic', adapters, { toolResult: { content: [{ type: 'text', text: 't' }, { type: 'image', mimeType: 'image/gif', data: 'B' }], isError: true } }).turn;
    expect(seen.outcome).toEqual({
      content: [{ type: 'text', text: 't' }, { type: 'image', source: { type: 'base64', media_type: 'image/gif', data: 'B' } }],
      isError: true,
    });
  });

  it('drops fabricated role markers, forwards other events and lets the end event set the stop reason', async () => {
    const { adapters } = fake('anthropic', {
      events: () => [
        { type: 'fabricated_role_marker', marker: 'Human:', messageId: 'm' },
        { type: 'text_delta', delta: 'x' },
        { type: 'end', reason: 'max_tool_turns' },
      ],
      result: { stopReason: 'end_turn', toolTurns: 0 },
    });
    const { turn, events } = run('anthropic', adapters);
    expect(await turn).toEqual({ stopReason: 'max_tool_turns', toolTurns: 0 });
    expect(events).toEqual([{ type: 'text_delta', delta: 'x' }, { type: 'end', reason: 'max_tool_turns' }]);
  });

  it('describes tool_result block content as text', async () => {
    const { adapters } = fake('anthropic', {
      events: () => [{
        type: 'tool_result',
        toolUseId: 'call-1',
        content: [{ type: 'text', text: 'line' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A' } }],
        isError: false,
      }],
      result: { stopReason: 'end_turn', toolTurns: 1 },
    });
    const { turn, events } = run('anthropic', adapters);
    await turn;
    expect(events).toEqual([{ type: 'tool_result', toolUseId: 'call-1', content: 'line\n[image: image/png]', isError: false }]);
  });
});

describe('runProviderToolTurn (openai adapter mapping)', () => {
  it('prepends the system message and omits unset settings', async () => {
    const { adapters, seen } = fake('openai', { result: { finishReason: 'stop', toolTurns: 0 } });
    expect(await run('openai', adapters).turn).toEqual({ stopReason: 'stop', toolTurns: 0 });
    expect(seen.required!.messages).toEqual([{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }]);
    expect(seen.optional).toMatchObject({ tools: [{ type: 'function', function: { name: 'bare', parameters: DEFAULT_SCHEMA } }] });
    expect(seen.optional).not.toHaveProperty('maxTokens');
    expect(seen.optional).not.toHaveProperty('baseUrl');
  });

  it('forwards optional settings and image messages as data URLs', async () => {
    const { adapters, seen } = fake('openai', { result: { finishReason: 'stop', toolTurns: 0 } });
    await run('openai', adapters, { baseUrl: 'https://o.example', maxTokens: 5, maxToolTurns: 3, signal, tools: [DESCRIBED_TOOL], messages: IMAGE_MESSAGES }).turn;
    expect(seen.optional).toMatchObject({ baseUrl: 'https://o.example', maxTokens: 5, maxToolTurns: 3, signal, tools: [{ function: { description: 'does things' } }] });
    expect(seen.required!.messages[2]!.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('prefixes a failed string tool result', async () => {
    const { adapters, seen } = fake('openai', { call: CALL, result: { finishReason: 'stop', toolTurns: 1 } });
    await run('openai', adapters, { toolResult: { content: 'boom', isError: true } }).turn;
    expect(seen.outcome).toEqual({ content: '[tool error] boom' });
  });

  it('leads a failed block tool result with an error text part', async () => {
    const { adapters, seen } = fake('openai', { call: CALL, result: { finishReason: 'stop', toolTurns: 1 } });
    await run('openai', adapters, { toolResult: { content: [{ type: 'text', text: 'boom' }], isError: true } }).turn;
    expect(seen.outcome).toEqual({ content: [{ type: 'text', text: '[tool error]' }, { type: 'text', text: 'boom' }] });
  });

  it('flags a prefixed tool_result as an error and names image parts by mime type', async () => {
    const { adapters } = fake('openai', {
      events: () => [
        { type: 'fabricated_role_marker', marker: 'User:', messageId: 'm' },
        { type: 'tool_result', toolUseId: 'c', content: '[tool error] bad', isError: false },
        { type: 'tool_result', toolUseId: 'd', content: [{ type: 'image_url', image_url: { url: 'data:image/webp;base64,Z' } }, { type: 'image_url', image_url: { url: 'https://img.example/x.png' } }], isError: false },
        { type: 'end', reason: 'max_tool_turns' },
      ],
      result: { finishReason: 'stop', toolTurns: 1 },
    });
    const { turn, events } = run('openai', adapters);
    expect(await turn).toEqual({ stopReason: 'max_tool_turns', toolTurns: 1 });
    expect(events.slice(0, 2)).toEqual([
      { type: 'tool_result', toolUseId: 'c', content: '[tool error] bad', isError: true },
      { type: 'tool_result', toolUseId: 'd', content: '[image: image/webp]\n[image: url]', isError: false },
    ]);
  });

  it('reports a null stop reason when the adapter gives none', async () => {
    const { adapters } = fake('openai', { result: { finishReason: null, toolTurns: 0 } });
    expect(await run('openai', adapters).turn).toEqual({ stopReason: null, toolTurns: 0 });
  });
});

describe('runProviderToolTurn (azure adapter mapping)', () => {
  it('refuses a missing base URL before calling the adapter', async () => {
    const { adapters, seen } = fake('azure', { result: { finishReason: 'stop', toolTurns: 0 } });
    const { turn, events } = run('azure', adapters);
    expect(await turn).toEqual({ stopReason: 'error', toolTurns: 0 });
    expect(events).toEqual([
      { type: 'error', message: 'the azure protocol requires a base URL (each Azure OpenAI resource has its own endpoint)' },
      { type: 'end', reason: 'error' },
    ]);
    expect(seen.required).toBeUndefined();
  });

  it('omits unset settings', async () => {
    const { adapters, seen } = fake('azure', { result: { finishReason: 'stop', toolTurns: 0 } });
    await run('azure', adapters, { baseUrl: 'https://z.example' }).turn;
    expect(seen.required).toMatchObject({ baseUrl: 'https://z.example', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }] });
    expect(seen.optional).toMatchObject({ tools: [{ function: { name: 'bare', parameters: DEFAULT_SCHEMA } }] });
    expect(seen.optional).not.toHaveProperty('maxTokens');
    expect(seen.optional).not.toHaveProperty('signal');
  });

  it('forwards optional settings and image messages', async () => {
    const { adapters, seen } = fake('azure', { result: { finishReason: 'stop', toolTurns: 0 } });
    await run('azure', adapters, { baseUrl: 'https://z.example', maxTokens: 7, maxToolTurns: 1, signal, tools: [DESCRIBED_TOOL], messages: IMAGE_MESSAGES }).turn;
    expect(seen.optional).toMatchObject({ maxTokens: 7, maxToolTurns: 1, signal, tools: [{ function: { description: 'does things' } }] });
    expect(seen.required!.messages[2]!.content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('folds tool errors and forwards tool_result and end events', async () => {
    const { adapters, seen } = fake('azure', {
      call: CALL,
      events: () => [
        { type: 'fabricated_role_marker', marker: 'User:', messageId: 'm' },
        { type: 'tool_result', toolUseId: 'c', content: 'fine', isError: true },
        { type: 'usage', usage: null },
        { type: 'end', reason: 'max_tool_turns' },
      ],
      result: { finishReason: 'stop', toolTurns: 1 },
    });
    const { turn, events } = run('azure', adapters, { baseUrl: 'https://z.example', toolResult: { content: 'boom', isError: true } });
    expect(await turn).toEqual({ stopReason: 'max_tool_turns', toolTurns: 1 });
    expect(seen.outcome).toEqual({ content: '[tool error] boom' });
    expect(events).toEqual([
      { type: 'tool_result', toolUseId: 'c', content: 'fine', isError: true },
      { type: 'usage', usage: null },
      { type: 'end', reason: 'max_tool_turns' },
    ]);
  });
});

describe('runProviderToolTurn (google adapter mapping)', () => {
  it('maps roles and omits unset settings', async () => {
    const { adapters, seen } = fake('google', { result: { finishReason: 'STOP', toolTurns: 0 } });
    await run('google', adapters, { messages: IMAGE_MESSAGES }).turn;
    expect(seen.required!.contents).toEqual([
      { role: 'model', parts: [{ text: 'earlier' }] },
      { role: 'user', parts: [{ text: 'look' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
    ]);
    expect(seen.optional).not.toHaveProperty('maxOutputTokens');
    expect(seen.optional).not.toHaveProperty('baseUrl');
  });

  it('forwards optional settings and tool descriptions', async () => {
    const { adapters, seen } = fake('google', { result: { finishReason: 'STOP', toolTurns: 0 } });
    await run('google', adapters, { baseUrl: 'https://g.example', maxTokens: 9, maxToolTurns: 4, signal, tools: [DESCRIBED_TOOL] }).turn;
    expect(seen.optional).toMatchObject({ baseUrl: 'https://g.example', maxOutputTokens: 9, maxToolTurns: 4, signal });
    expect(seen.optional!.tools![0]!.functionDeclarations[0]).toMatchObject({ name: 'described', description: 'does things' });
  });

  it('coerces numeric enum strings for a known tool', async () => {
    const enumTool: ProviderToolDescriptor = { id: 'status', inputSchema: { type: 'object', properties: { code: { type: 'integer', enum: [301, 302] } } } };
    const { adapters } = fake('google', { call: { id: 'g1', name: 'status', input: { code: '302' } }, result: { finishReason: 'STOP', toolTurns: 1 } });
    const { turn, calls } = run('google', adapters, { tools: [enumTool] });
    await turn;
    expect(calls[0]!.input).toEqual({ code: 302 });
  });

  it('leaves the input of an unknown tool untouched', async () => {
    const { adapters } = fake('google', { call: { id: 'g1', name: 'nope', input: { code: '302' } }, result: { finishReason: 'STOP', toolTurns: 1 } });
    const { turn, calls } = run('google', adapters);
    await turn;
    expect(calls[0]!.input).toEqual({ code: '302' });
  });

  it('maps block tool results and keeps isError', async () => {
    const { adapters, seen } = fake('google', { call: CALL, result: { finishReason: 'STOP', toolTurns: 1 } });
    await run('google', adapters, { toolResult: { content: [{ type: 'text', text: 't' }, { type: 'image', mimeType: 'image/png', data: 'P' }], isError: false } }).turn;
    expect(seen.outcome).toEqual({ content: [{ text: 't' }, { inlineData: { mimeType: 'image/png', data: 'P' } }], isError: false });
  });

  it('passes a string tool result through without an isError flag', async () => {
    const { adapters, seen } = fake('google', { call: CALL, result: { finishReason: 'STOP', toolTurns: 1 } });
    await run('google', adapters).turn;
    expect(seen.outcome).toEqual({ content: 'done' });
  });

  it('describes inline image parts, falls back to JSON for unknown parts and captures the end reason', async () => {
    const { adapters } = fake('google', {
      events: () => [
        { type: 'fabricated_role_marker', marker: 'User:', messageId: 'm' },
        // `{ other: 1 }` is a malformed part the wire type forbids — the JSON fallback is runtime defence.
        { type: 'tool_result', toolUseId: 'g', content: [{ inlineData: { mimeType: 'image/jpeg', data: 'J' } }, { other: 1 } as never], isError: false },
        { type: 'end', reason: 'max_tool_turns' },
      ],
      result: { finishReason: 'STOP', toolTurns: 1 },
    });
    const { turn, events } = run('google', adapters);
    expect(await turn).toEqual({ stopReason: 'max_tool_turns', toolTurns: 1 });
    expect(events[0]).toEqual({ type: 'tool_result', toolUseId: 'g', content: '[image: image/jpeg]\n{"other":1}', isError: false });
  });
});
