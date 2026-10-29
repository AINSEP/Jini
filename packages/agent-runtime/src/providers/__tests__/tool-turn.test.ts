import assert from 'node:assert/strict';
import { describe, test, expect, vi } from 'vitest';
import type { ProviderToolDescriptor as ToolDescriptor, ProviderToolTurnInput, ProviderToolTurnOptions, ProviderProtocol as ByokProtocol, ProviderTurnAdapters, ProviderToolCall, ProviderToolSnapshotOptions, ProviderTurnEvent } from '../tool-turn.js';
import { runProviderToolTurn, providerTurnAdapters, ProviderToolProjectionError } from '../tool-turn.js';
import { startStubProviderServer, runFixtureTurn as runByokProviderTurn } from './transport-fixture.js';
type ByokProviderTurnInput = Omit<ProviderToolTurnInput, 'adapters'> & ProviderToolTurnOptions;
function numericEnumCatalog() { return [{ name: 'status_tool', inputSchema: { type: 'object', properties: { statusCode: { type: 'integer', enum: [301, 302, 307, 308] } } } }]; }
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertEveryNodeHasATypeUnlessItIsAnyOf(node: unknown, path: string): void {
    if (Array.isArray(node)) {
        node.forEach((entry, index) => {
            assertEveryNodeHasATypeUnlessItIsAnyOf(entry, `${path}[${index}]`);
        });
        return;
    }
    if (!isPlainObject(node))
        return;
    const hasType = typeof node.type === "string";
    const hasAnyOf = Array.isArray(node.anyOf);
    assert.ok(hasType || hasAnyOf, `${path}: schema node has neither "type" nor "anyOf" — Gemini requires one: ${JSON.stringify(node)}`);
    if (isPlainObject(node.properties)) {
        for (const [name, propSchema] of Object.entries(node.properties))
            assertEveryNodeHasATypeUnlessItIsAnyOf(propSchema, `${path}.properties.${name}`);
    }
    if (node.items !== undefined)
        assertEveryNodeHasATypeUnlessItIsAnyOf(node.items, `${path}.items`);
    if (Array.isArray(node.anyOf))
        assertEveryNodeHasATypeUnlessItIsAnyOf(node.anyOf, `${path}.anyOf`);
}
function assertNoTypeArraysOrNumericEnums(node: unknown, path: string): void {
    if (Array.isArray(node)) {
        node.forEach((entry, index) => {
            assertNoTypeArraysOrNumericEnums(entry, `${path}[${index}]`);
        });
        return;
    }
    if (!isPlainObject(node))
        return;
    assert.ok(!Array.isArray(node.type), `${path}: "type" is still an array after sanitizing: ${JSON.stringify(node.type)}`);
    if (Array.isArray(node.enum)) {
        for (const member of node.enum) {
            assert.equal(typeof member, "string", `${path}: enum member ${JSON.stringify(member)} is not a string`);
        }
    }
    if (isPlainObject(node.properties)) {
        for (const [name, propSchema] of Object.entries(node.properties))
            assertNoTypeArraysOrNumericEnums(propSchema, `${path}.properties.${name}`);
    }
    if (node.items !== undefined)
        assertNoTypeArraysOrNumericEnums(node.items, `${path}.items`);
    if (Array.isArray(node.anyOf))
        assertNoTypeArraysOrNumericEnums(node.anyOf, `${path}.anyOf`);
}
const TOOL_WITH_NESTED_ADDITIONAL_PROPERTIES: ToolDescriptor = {
    id: "demo_tool",
    description: "a demo tool",
    inputSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        additionalProperties: false,
        properties: {
            filter: { type: "object", additionalProperties: false, properties: { slug: { type: "string" } } },
        },
        required: [],
    },
};
const STRICT_NESTED_PARAMETERS = {
    type: "object",
    additionalProperties: false,
    properties: {
        filter: {
            anyOf: [
                {
                    type: "object",
                    additionalProperties: false,
                    properties: { slug: { anyOf: [{ type: "string" }, { type: "null" }] } },
                    required: ["slug"],
                },
                { type: "null" },
            ],
        },
    },
    required: ["filter"],
};
async function captureOutboundRequest(t: unknown): Promise<{
    baseUrl: string;
    body(): Record<string, unknown>;
}> {
    let captured: Record<string, unknown> | undefined;
    const baseUrl = await startStubProviderServer({ handler: (_callCount, requestBody) => {
            captured = requestBody;
            return { status: 400, body: "{}" };
        } });
    return {
        baseUrl,
        body() {
            assert.ok(captured, "expected the stub provider server to have received a request");
            return captured as Record<string, unknown>;
        },
    };
}
function baseInput(protocol: ByokProviderTurnInput["protocol"], baseUrl: string): ByokProviderTurnInput {
    return {
        protocol,
        baseUrl,
        apiKey: "test-key-not-real",
        model: protocol === "google" ? "gemini-3.6-flash" : "claude-opus-4-8",
        system: "be terse",
        messages: [{ role: "user", content: "hi" }],
        tools: [TOOL_WITH_NESTED_ADDITIONAL_PROPERTIES],
        executeTool: async () => {
            throw new Error("must not be called — the stub server never returns a tool call");
        },
        onEvent: () => { },
    } satisfies ByokProviderTurnInput;
}
test("runByokProviderTurn(google): the outbound Gemini request has additionalProperties/$schema stripped, top-level and nested", async (t) => {
    const capture = await captureOutboundRequest(t);
    await runByokProviderTurn(baseInput("google", capture.baseUrl));
    const body = capture.body();
    const tools = body.tools as Array<{
        functionDeclarations: Array<{
            parameters: Record<string, unknown>;
        }>;
    }>;
    assert.ok(tools[0]);
    assert.ok(tools[0].functionDeclarations[0]);
    const parameters = tools[0].functionDeclarations[0].parameters;
    // Prefer policy now projects this supported closed schema: optional fields become required
    // and nullable before Google's sanitizer removes unsupported keywords at every depth.
    assert.deepEqual(parameters, {
        type: "object",
        properties: {
            filter: {
                anyOf: [
                    {
                        type: "object",
                        properties: { slug: { anyOf: [{ type: "string" }, { type: "null" }] } },
                        required: ["slug"],
                    },
                    { type: "null" },
                ],
            },
        },
        required: ["filter"],
    });
    assert.ok(!JSON.stringify(parameters).includes("additionalProperties"));
    assert.ok(!JSON.stringify(parameters).includes("$schema"));
});
test("runByokProviderTurn(anthropic): strict projection preserves top-level and nested additionalProperties — the Google-only sanitizer must not leak into this protocol", async (t) => {
    const capture = await captureOutboundRequest(t);
    await runByokProviderTurn(baseInput("anthropic", capture.baseUrl));
    const body = capture.body();
    const tools = body.tools as Array<{
        input_schema: Record<string, unknown>;
    }>;
    assert.ok(tools[0]);
    // Prefer policy projects this supported schema, removing $schema and encoding omission as null;
    // closed objects must retain additionalProperties, which the Google sanitizer would strip.
    assert.deepEqual(tools[0].input_schema, STRICT_NESTED_PARAMETERS);
    assert.ok(JSON.stringify(tools[0].input_schema).includes("additionalProperties"));
});
function googleChunk(payload: Record<string, unknown>): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}
function googleFunctionCallFrame(name: string, args: unknown, id: string): string {
    return googleChunk({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args, id } }] }, index: 0 }] });
}
function googleTextFrame(text: string, finishReason: string): string {
    return googleChunk({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason, index: 0 }] });
}
test("runByokProviderTurn(google): a numeric-enum tool (status_tool) round-trips end to end — Gemini sends back statusCode as a STRING, and the tool executor still receives a NUMBER", async (t) => {
    const baseUrl = await startStubProviderServer({ handler: (callCount) => {
            if (callCount === 1) {
                return { status: 200, body: googleFunctionCallFrame("status_tool", { statusCode: "301", fromPattern: "/old", toTarget: "/new", matchType: "exact" }, "call_1") };
            }
            return { status: 200, body: googleTextFrame("Created.", "STOP") };
        } });
    const statusCodeSchema = numericEnumCatalog().find((t2) => t2.name === "status_tool")?.inputSchema;
    assert.ok(statusCodeSchema, "expected status_tool to carry an inputSchema");
    let receivedInput: unknown;
    await runByokProviderTurn({
        protocol: "google",
        baseUrl,
        apiKey: "test-key-not-real",
        model: "gemini-3.6-flash",
        system: "be terse",
        messages: [{ role: "user", content: "create a redirect" }],
        tools: [{ id: "status_tool", description: "create a redirect", inputSchema: statusCodeSchema }],
        executeTool: async (call) => {
            receivedInput = call.input;
            return { content: "ok" };
        },
        onEvent: () => { },
    });
    assert.ok(isRecordForTest(receivedInput), "expected the tool executor to have been called with an input object");
    assert.equal(receivedInput.statusCode, 301, "expected statusCode to be coerced back to a number before the tool executor saw it");
    assert.equal(typeof receivedInput.statusCode, "number");
});
function isRecordForTest(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
function openAiChunk(payload: Record<string, unknown>): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}
const OPENAI_DONE = "data: [DONE]\n\n";
function openAiToolCallChunks(calls: ReadonlyArray<{
    index: number;
    id: string;
    name: string;
    argsJson: string;
}>): string {
    const deltaChunk = openAiChunk({
        choices: [{ index: 0, delta: { tool_calls: calls.map((c) => ({ index: c.index, id: c.id, function: { name: c.name, arguments: c.argsJson } })) }, finish_reason: null }],
    });
    const trailerChunk = openAiChunk({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    return deltaChunk + trailerChunk;
}
function openAiTextChunks(text: string): string {
    const textChunk = openAiChunk({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
    const trailerChunk = openAiChunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    return textChunk + trailerChunk;
}
function byokTools(...ids: string[]): ToolDescriptor[] {
    return ids.map((id) => ({ id, description: id, inputSchema: { type: "object", properties: {}, required: [] } }));
}
test("runByokProviderTurn(azure): refuses with stopReason 'error' when no baseUrl is supplied, rather than attempting a request (every Azure OpenAI resource has its own endpoint — there is no sane global default)", async () => {
    const events: unknown[] = [];
    const result = await runByokProviderTurn({
        protocol: "azure",
        apiKey: "test-key-not-real",
        model: "gpt-5-deployment",
        system: "be terse",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        executeTool: async () => {
            throw new Error("must not be called — refused before any request is attempted");
        },
        onEvent: (event) => events.push(event),
    });
    assert.deepEqual(result, { stopReason: "error", toolTurns: 0 });
    assert.deepEqual(events, [
        { type: "error", message: "the azure protocol requires a base URL (each Azure OpenAI resource has its own endpoint)" },
        { type: "end", reason: "error" },
    ]);
});
test("runByokProviderTurn(openai): strict projection preserves top-level and nested additionalProperties, same as anthropic — the Google-only sanitizer must not leak into this protocol", async (t) => {
    const capture = await captureOutboundRequest(t);
    await runByokProviderTurn(baseInput("openai", capture.baseUrl));
    const body = capture.body();
    const tools = body.tools as Array<{
        function: {
            parameters: Record<string, unknown>;
        };
    }>;
    assert.ok(tools[0]);
    // Prefer policy projects this supported schema, removing $schema and encoding omission as null;
    // closed objects must retain additionalProperties, which the Google sanitizer would strip.
    assert.deepEqual(tools[0].function.parameters, STRICT_NESTED_PARAMETERS);
    assert.ok(JSON.stringify(tools[0].function.parameters).includes("additionalProperties"));
});
test("runByokProviderTurn(openai): a failed tool result is folded into the outbound message with the [tool error] prefix, a successful one passes through unprefixed, and isError on the reported tool_result event is derived from that fold marker — not the adapter's own (nonexistent) isError field", async (t) => {
    let secondRequestBody: Record<string, unknown> | undefined;
    const baseUrl = await startStubProviderServer({ handler: (callCount, requestBody) => {
            if (callCount === 1) {
                return { status: 200, body: openAiToolCallChunks([
                        { index: 0, id: "call_ok", name: "tool_ok", argsJson: "{}" },
                        { index: 1, id: "call_bad", name: "tool_bad", argsJson: "{}" },
                    ]) + OPENAI_DONE };
            }
            secondRequestBody = requestBody;
            return { status: 200, body: openAiTextChunks("Done.") + OPENAI_DONE };
        } });
    const events: Array<{
        type: string;
        [key: string]: unknown;
    }> = [];
    const result = await runByokProviderTurn({
        protocol: "openai",
        baseUrl,
        apiKey: "test-key-not-real",
        model: "gpt-5",
        system: "be terse",
        messages: [{ role: "user", content: "run two tools" }],
        tools: byokTools("tool_ok", "tool_bad"),
        executeTool: async (call) => (call.name === "tool_bad" ? { content: "boom", isError: true } : { content: "fine" }),
        onEvent: (event) => events.push(event as {
            type: string;
            [key: string]: unknown;
        }),
    });
    assert.equal(result.stopReason, "stop");
    const toolResults = events.filter((e) => e.type === "tool_result");
    assert.deepEqual(toolResults.map((e) => ({ toolUseId: e.toolUseId, content: e.content, isError: e.isError })), [
        { toolUseId: "call_ok", content: "fine", isError: false },
        { toolUseId: "call_bad", content: "[tool error] boom", isError: true },
    ]);
    assert.ok(secondRequestBody, "expected a second request carrying the tool results");
    const toolMessages = (secondRequestBody.messages as Array<{
        role: string;
        tool_call_id?: string;
        content: unknown;
    }>).filter((m) => m.role === "tool");
    assert.deepEqual(toolMessages.map((m) => ({ tool_call_id: m.tool_call_id, content: m.content })), [
        { tool_call_id: "call_ok", content: "fine" },
        { tool_call_id: "call_bad", content: "[tool error] boom" },
    ]);
});
function outboundToolDeclaration(protocol: ByokProviderTurnInput["protocol"], body: Record<string, unknown>): Record<string, unknown> {
    const tools = body.tools as unknown[];
    const first = tools[0] as Record<string, unknown>;
    if (protocol === "anthropic")
        return first;
    if (protocol === "google") {
        const decl = (first as {
            functionDeclarations: unknown[];
        }).functionDeclarations[0];
        return decl as Record<string, unknown>;
    }
    return (first as {
        function: Record<string, unknown>;
    }).function;
}
for (const protocol of ["anthropic", "openai", "azure", "google"] as const) {
    test(`runByokProviderTurn(${protocol}): a tool descriptor with no description omits the description key entirely from the outbound request, rather than sending description: undefined`, async (t) => {
        const capture = await captureOutboundRequest(t);
        await runByokProviderTurn({
            ...baseInput(protocol, capture.baseUrl),
            tools: [{ id: "no_description_tool", inputSchema: { type: "object", properties: {}, required: [] } }],
        });
        const declaration = outboundToolDeclaration(protocol, capture.body());
        assert.equal("description" in declaration, false, `expected no "description" key at all, got: ${JSON.stringify(declaration)}`);
    });
}
test("runByokProviderTurn(azure): the same [tool error]-prefix fold/derive as openai, in azure's own copy of that logic", async (t) => {
    let secondRequestBody: Record<string, unknown> | undefined;
    const baseUrl = await startStubProviderServer({ handler: (callCount, requestBody) => {
            if (callCount === 1) {
                return { status: 200, body: openAiToolCallChunks([
                        { index: 0, id: "call_ok", name: "tool_ok", argsJson: "{}" },
                        { index: 1, id: "call_bad", name: "tool_bad", argsJson: "{}" },
                    ]) + OPENAI_DONE };
            }
            secondRequestBody = requestBody;
            return { status: 200, body: openAiTextChunks("Done.") + OPENAI_DONE };
        } });
    const events: Array<{
        type: string;
        [key: string]: unknown;
    }> = [];
    const result = await runByokProviderTurn({
        protocol: "azure",
        baseUrl,
        apiKey: "test-key-not-real",
        model: "gpt-5-deployment",
        system: "be terse",
        messages: [{ role: "user", content: "run two tools" }],
        tools: byokTools("tool_ok", "tool_bad"),
        executeTool: async (call) => (call.name === "tool_bad" ? { content: "boom", isError: true } : { content: "fine" }),
        onEvent: (event) => events.push(event as {
            type: string;
            [key: string]: unknown;
        }),
    });
    assert.equal(result.stopReason, "stop");
    const toolResults = events.filter((e) => e.type === "tool_result");
    assert.deepEqual(toolResults.map((e) => ({ toolUseId: e.toolUseId, content: e.content, isError: e.isError })), [
        { toolUseId: "call_ok", content: "fine", isError: false },
        { toolUseId: "call_bad", content: "[tool error] boom", isError: true },
    ]);
    assert.ok(secondRequestBody, "expected a second request carrying the tool results");
    const toolMessages = (secondRequestBody.messages as Array<{
        role: string;
        tool_call_id?: string;
        content: unknown;
    }>).filter((m) => m.role === "tool");
    assert.deepEqual(toolMessages.map((m) => ({ tool_call_id: m.tool_call_id, content: m.content })), [
        { tool_call_id: "call_ok", content: "fine" },
        { tool_call_id: "call_bad", content: "[tool error] boom" },
    ]);
});

test.each(['max_tool_turns', 'contaminated', 'error'] as const)('adapter termination %s overrides the raw provider stop code', async reason => {
  const events: unknown[] = [];
  const adapters = { ...providerTurnAdapters, anthropic: vi.fn(async (required: Parameters<typeof providerTurnAdapters.anthropic>[0], optional: Parameters<typeof providerTurnAdapters.anthropic>[1] = {}) => {
    const options = { ...optional, ...required };
    options.onEvent({ type: 'end', reason });
    return { stopReason: 'tool_use', toolTurns: 2 };
  }) };
  const result = await runProviderToolTurn({ protocol: 'anthropic', adapters, apiKey: 'key', model: 'model', system: 'system', messages: [], tools: [], executeTool: async () => ({ content: 'ok' }), onEvent: event => events.push(event) }, { maxToolTurns: 2 });
  expect(result).toEqual({ stopReason: reason, toolTurns: 2 });
  expect(events).toEqual([{ type: 'end', reason }]);
  expect(adapters.anthropic).toHaveBeenCalledTimes(1);
  expect(adapters.anthropic.mock.calls[0]![1]?.maxToolTurns).toBe(2);
});

test('the supplied adapter receives cancellation and the optional token limit', async () => {
  const controller = new AbortController();
  const google = vi.fn(async (required: Parameters<typeof providerTurnAdapters.google>[0], optional: Parameters<typeof providerTurnAdapters.google>[1] = {}) => {
    const options = { ...optional, ...required };
    expect(options.signal).toBe(controller.signal);
    expect(options.maxOutputTokens).toBe(123);
    options.onEvent({ type: 'end', reason: 'stop' });
    return { finishReason: 'STOP', toolTurns: 0 };
  });
  const result = await runProviderToolTurn({ protocol: 'google', adapters: { ...providerTurnAdapters, google }, apiKey: 'key', model: 'model', system: '', messages: [], tools: [], executeTool: async () => ({ content: 'ok' }), onEvent: () => {} }, { signal: controller.signal, maxTokens: 123 });
  expect(result.stopReason).toBe('stop');
  expect(google).toHaveBeenCalledTimes(1);
});

test('a provider content guard failure keeps isError even without a host error marker', async () => {
  const events: unknown[] = [];
  const openai = async (required: Parameters<typeof providerTurnAdapters.openai>[0], optional: Parameters<typeof providerTurnAdapters.openai>[1] = {}) => {
    const options = { ...optional, ...required };
    options.onEvent({ type: 'tool_result', toolUseId: 'call', content: 'tool result rejected: malformed image', isError: true });
    return { finishReason: 'stop', toolTurns: 1 };
  };
  await runProviderToolTurn({ protocol: 'openai', adapters: { ...providerTurnAdapters, openai }, apiKey: 'key', model: 'model', system: '', messages: [], tools: [], executeTool: async () => ({ content: 'ok' }), onEvent: event => events.push(event) });
  expect(events).toEqual([{ type: 'tool_result', toolUseId: 'call', content: 'tool result rejected: malformed image', isError: true }]);
});

interface ProjectionInspection {
  readonly tools: readonly unknown[];
  readonly getTools: (options?: ProviderToolSnapshotOptions) => readonly unknown[];
  readonly executeTool: (call: ProviderToolCall) => Promise<{ readonly content: unknown }>;
  readonly emitToolUse: (call: ProviderToolCall) => void;
}
/** Exercise the adapter port without sockets; B1 owns real request-loop refresh/strict flags. */
function projectionAdapters(inspect: (port: ProjectionInspection) => Promise<void>): ProviderTurnAdapters {
  return {
    anthropic: async (required, optional = {}) => {
      await inspect({ tools: optional.tools!, getTools: optional.getTools!, executeTool: optional.executeTool!, emitToolUse: call => required.onEvent({ type: 'tool_use', ...call }) });
      return { stopReason: 'stop', toolTurns: 1 };
    },
    openai: async (required, optional = {}) => {
      await inspect({ tools: optional.tools!, getTools: optional.getTools!, executeTool: optional.executeTool!, emitToolUse: call => required.onEvent({ type: 'tool_use', ...call }) });
      return { finishReason: 'stop', toolTurns: 1 };
    },
    azure: async (required, optional = {}) => {
      await inspect({ tools: optional.tools!, getTools: optional.getTools!, executeTool: optional.executeTool!, emitToolUse: call => required.onEvent({ type: 'tool_use', ...call }) });
      return { finishReason: 'stop', toolTurns: 1 };
    },
    google: async (required, optional = {}) => {
      await inspect({ tools: optional.tools!, getTools: optional.getTools!, executeTool: optional.executeTool!, emitToolUse: call => required.onEvent({ type: 'tool_use', ...call }) });
      return { finishReason: 'STOP', toolTurns: 1 };
    },
  };
}
function closedTool(id: string): ToolDescriptor {
  return { id, inputSchema: { type: 'object', additionalProperties: false, properties: { optional: { type: 'string' }, clear: { type: ['string', 'null'] } }, required: ['clear'] } };
}
function projectionInput(protocol: ByokProtocol, adapters: ProviderTurnAdapters): ProviderToolTurnInput {
  return { protocol, adapters, apiKey: 'key', model: 'model', system: '', messages: [], tools: [], executeTool: async () => ({ content: 'ok' }), onEvent: () => {} };
}
function declarations(protocol: ByokProtocol, tools: readonly unknown[]): Record<string, unknown>[] {
  if (protocol === 'google') return (tools[0] as { functionDeclarations: Record<string, unknown>[] }).functionDeclarations;
  return tools.map(tool => protocol === 'anthropic' ? tool as Record<string, unknown> : (tool as { function: Record<string, unknown> }).function);
}

test.each(['anthropic', 'openai', 'azure', 'google'] as const)('%s: optional live snapshots project discovered schemas and round-trip names/inputs to the existing executor', async protocol => {
  let snapshot: readonly ToolDescriptor[] = [closedTool('describe')];
  const calls: ProviderToolCall[] = [];
  const events: ProviderTurnEvent[] = [];
  const adapters = projectionAdapters(async port => {
    expect(declarations(protocol, port.tools).map(tool => tool.name)).toEqual(['describe']);
    await port.executeTool({ id: 'describe-call', name: 'describe', input: {} });
    const tools = declarations(protocol, port.getTools({ strict: true }));
    expect(tools).toHaveLength(2);
    const typed = tools[1]!;
    expect(typed.name).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
    expect(typed.name).not.toBe('content_read.menu');
    const schema = (protocol === 'anthropic' ? typed.input_schema : typed.parameters) as Record<string, unknown>;
    expect(schema.required).toEqual(['optional', 'clear']);
    const call = { id: 'typed-call', name: String(typed.name), input: { optional: null, clear: null } };
    port.emitToolUse(call);
    await port.executeTool(call);
  });
  await runProviderToolTurn({ ...projectionInput(protocol, adapters), tools: snapshot, executeTool: async call => {
    calls.push(call);
    if (call.name === 'describe') snapshot = [...snapshot, closedTool('content_read.menu')];
    return { content: 'ok' };
  }, onEvent: event => events.push(event) }, { baseUrl: 'https://endpoint.invalid', getToolSnapshot: () => snapshot });
  expect(calls).toEqual([
    { id: 'describe-call', name: 'describe', input: {} },
    { id: 'typed-call', name: 'content_read.menu', input: { clear: null } },
  ]);
  expect(events).toEqual([{ type: 'tool_use', id: 'typed-call', name: 'content_read.menu', input: { clear: null } }]);
});

test.each(['anthropic', 'openai', 'azure', 'google'] as const)('%s: absent getter preserves legacy snapshots and result/image/error translation', async protocol => {
  const tool = closedTool('legacy');
  const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: [{ type: 'image' as const, mimeType: 'image/png', data: 'aW1hZ2U=' }], isError: true }));
  const adapters = projectionAdapters(async port => {
    const declaration = declarations(protocol, port.getTools())[0]!;
    expect(declaration.name).toBe('legacy');
    expect(declaration.strict).toBeUndefined();
    const result = await port.executeTool({ id: 'call', name: 'legacy', input: { optional: null, clear: null } });
    if (protocol === 'anthropic') expect(result).toEqual({ content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } }], isError: true });
    else if (protocol === 'google') expect(result).toEqual({ content: [{ inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }], isError: true });
    else expect(result).toEqual({ content: [{ type: 'text', text: '[tool error]' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }] });
  });
  await runProviderToolTurn({ ...projectionInput(protocol, adapters), tools: [tool], executeTool }, { baseUrl: 'https://endpoint.invalid' });
  expect(executeTool).toHaveBeenCalledTimes(1);
  expect(executeTool).toHaveBeenCalledWith({ id: 'call', name: 'legacy', input: { optional: null, clear: null } });
});

test('strict fallback diagnostics contain only IDs/protocol/reason, are deduplicated, and never include arguments', async () => {
  const diagnostics: unknown[] = [];
  const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'ok' }));
  const tool = { id: 'open.map', inputSchema: { type: 'object', additionalProperties: true } };
  const adapters = projectionAdapters(async port => {
    const declaration = declarations('openai', port.getTools({ strict: true }))[0]!;
    port.getTools({ strict: true });
    expect(declaration.strict).toBeUndefined();
    expect(declaration.parameters).toBe(tool.inputSchema);
    await port.executeTool({ id: 'call', name: String(declaration.name), input: { password: 'never-in-diagnostics', clear: null } });
  });
  await runProviderToolTurn({ ...projectionInput('openai', adapters), tools: [tool], executeTool }, { onSchemaFallback: event => diagnostics.push(event) });
  expect(diagnostics).toEqual([{ toolId: 'open.map', protocol: 'openai', reason: 'open-map' }]);
  expect(JSON.stringify(diagnostics)).not.toContain('never-in-diagnostics');
  expect(executeTool).toHaveBeenCalledTimes(1);
  expect(executeTool).toHaveBeenCalledWith({ id: 'call', name: 'open.map', input: { password: 'never-in-diagnostics', clear: null } });
});

test('a non-strict downgrade refresh selects its matching decoder and preserves a real null', async () => {
  const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'ok' }));
  const adapters = projectionAdapters(async port => {
    const strict = declarations('openai', port.getTools({ strict: true }))[0]!;
    expect(strict.strict).toBe(true);
    const fallback = declarations('openai', port.getTools({ strict: false }))[0]!;
    expect(fallback.strict).toBeUndefined();
    await port.executeTool({ id: 'call', name: String(fallback.name), input: { optional: null } });
  });
  await runProviderToolTurn({ ...projectionInput('openai', adapters), tools: [closedTool('write')], executeTool });
  expect(executeTool).toHaveBeenCalledTimes(1);
  expect(executeTool).toHaveBeenCalledWith({ id: 'call', name: 'write', input: { optional: null } });
});

describe.each(['anthropic', 'openai', 'azure', 'google'] as const)('%s: unexposed tool refusals', protocol => {
  const defaultText = 'Tool is not exposed in this turn.';
  const call = { id: 'hidden-call', name: 'hidden_tool', input: { query: 'raw input' } };
  const options = { baseUrl: 'https://endpoint.invalid' };

  test.each([
    { label: 'custom text', reply: { text: 'This tool is unavailable.' }, text: 'This tool is unavailable.' },
    { label: 'undefined fallback', reply: undefined, text: defaultText },
    { label: 'empty text', reply: { text: '' }, text: '' },
  ])('$label: an awaited refusal hook changes only refusal content compared with omission', async ({ reply, text }) => {
    const results: unknown[] = [];
    const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'must not execute' }));
    const onUnexposedToolCall = vi.fn(async () => reply);
    const adapters = projectionAdapters(async port => { results.push(await port.executeTool(call)); });
    const input = { ...projectionInput(protocol, adapters), executeTool };

    await runProviderToolTurn(input, options);
    await runProviderToolTurn(input, { ...options, onUnexposedToolCall });

    const wireResult = (content: string) => protocol === 'openai' || protocol === 'azure'
      ? { content: `[tool error] ${content}` } : { content, isError: true };
    expect(results).toEqual([wireResult(defaultText), wireResult(text)]);
    expect(onUnexposedToolCall).toHaveBeenCalledTimes(1);
    expect(onUnexposedToolCall).toHaveBeenCalledWith({ toolName: call.name, callId: call.id, input: call.input, protocol });
    expect(executeTool).not.toHaveBeenCalled();
  });

  test('a synchronous hook cannot turn a refusal into a successful result', async () => {
    const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'must not execute' }));
    const adapters = projectionAdapters(async port => {
      expect(await port.executeTool(call)).toEqual(protocol === 'openai' || protocol === 'azure'
        ? { content: '[tool error] Denied.' } : { content: 'Denied.', isError: true });
    });
    await runProviderToolTurn({ ...projectionInput(protocol, adapters), executeTool }, {
      ...options, onUnexposedToolCall: () => ({ text: 'Denied.', isError: false }),
    });
    expect(executeTool).not.toHaveBeenCalled();
  });

  test('published wire names bypass the refusal hook and retain canonical name/input decoding', async () => {
    const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'allowed' }));
    const onUnexposedToolCall = vi.fn(() => ({ text: 'Denied.' }));
    const adapters = projectionAdapters(async port => {
      port.getTools({ strict: true });
      expect(await port.executeTool({ id: 'allowed-call', name: 'read_wire', input: { optional: null, clear: null } }))
        .toEqual({ content: 'allowed' });
    });
    await runProviderToolTurn({ ...projectionInput(protocol, adapters), executeTool,
      tools: [{ ...closedTool('content.read'), wireName: 'read_wire' }],
    }, { ...options, onUnexposedToolCall });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith({ id: 'allowed-call', name: 'content.read', input: { clear: null } });
    expect(onUnexposedToolCall).not.toHaveBeenCalled();
  });

  test.each(['throw', 'reject'] as const)('a hook %s propagates without falling through to execution', async failure => {
    const error = new Error('Audit unavailable');
    const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'must not execute' }));
    const onUnexposedToolCall = vi.fn(() => {
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    });
    const adapters = projectionAdapters(async port => { await port.executeTool(call); });
    await expect(runProviderToolTurn({ ...projectionInput(protocol, adapters), executeTool }, {
      ...options, onUnexposedToolCall,
    })).rejects.toBe(error);
    expect(onUnexposedToolCall).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
  });

  test('an asynchronous policy change cannot execute an unpublished canonical name', async () => {
    let snapshot: readonly ToolDescriptor[] = [{ ...closedTool('content.read'), wireName: 'read_wire' }];
    const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'must not execute' }));
    const onUnexposedToolCall = vi.fn(async () => {
      await Promise.resolve();
      snapshot = [...snapshot, closedTool('hidden_tool')];
      return { text: 'Denied.' };
    });
    const adapters = projectionAdapters(async port => {
      const expected = protocol === 'openai' || protocol === 'azure'
        ? { content: '[tool error] Denied.' } : { content: 'Denied.', isError: true };
      expect(await port.executeTool({ ...call, name: 'content.read' })).toEqual(expected);
      expect(await port.executeTool(call)).toEqual(expected);
      expect(declarations(protocol, port.tools).map(tool => tool.name)).toEqual(['read_wire']);
    });
    await runProviderToolTurn({ ...projectionInput(protocol, adapters), executeTool }, {
      ...options, getToolSnapshot: () => snapshot, onUnexposedToolCall,
    });
    expect(onUnexposedToolCall.mock.calls).toEqual([
      [{ toolName: 'content.read', callId: call.id, input: call.input, protocol }],
      [{ toolName: call.name, callId: call.id, input: call.input, protocol }],
    ]);
    expect(executeTool).not.toHaveBeenCalled();
  });
});

test('long/unsafe/colliding names stay stable through repeated refresh and unpublished names cannot reach the host', async () => {
  const long = `domain.${'x'.repeat(90)}`;
  let snapshot = [closedTool(long)];
  let originalName = '';
  const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'ok' }));
  const adapters = projectionAdapters(async port => {
    originalName = String(declarations('openai', port.tools)[0]!.name);
    expect(originalName).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
    snapshot = [...snapshot, closedTool(originalName)];
    const second = declarations('openai', port.getTools());
    const third = declarations('openai', port.getTools());
    expect(second).toEqual(third);
    expect(second[0]!.name).toBe(originalName);
    expect(second[1]!.name).not.toBe(originalName);
    await port.executeTool({ id: 'first', name: originalName, input: {} });
    await port.executeTool({ id: 'second', name: String(second[1]!.name), input: {} });
    expect(await port.executeTool({ id: 'unknown', name: long, input: {} })).toEqual({ content: '[tool error] Tool is not exposed in this turn.' });
    snapshot = [];
    port.getTools();
    await port.executeTool({ id: 'in-flight', name: originalName, input: {} });
  });
  await runProviderToolTurn({ ...projectionInput('openai', adapters), executeTool }, { getToolSnapshot: () => snapshot });
  expect(executeTool.mock.calls.map(call => call[0])).toEqual([
    { id: 'first', name: long, input: {} }, { id: 'second', name: originalName, input: {} }, { id: 'in-flight', name: long, input: {} },
  ]);
  expect(executeTool.mock.calls[1]![0]!.name).toMatch(/^tool_domain_/);
});

test('wire names already assigned by core exposure are preserved and conflicting spellings fail closed', async () => {
  const executeTool = vi.fn(async (_call: ProviderToolCall) => ({ content: 'ok' }));
  const adapters = projectionAdapters(async port => {
    expect(declarations('openai', port.tools)[0]!.name).toBe('pinned_name');
    await port.executeTool({ id: 'call', name: 'pinned_name', input: {} });
  });
  await runProviderToolTurn({ ...projectionInput('openai', adapters), tools: [{ ...closedTool('a.b'), wireName: 'pinned_name' }], executeTool });
  expect(executeTool).toHaveBeenCalledTimes(1);
  expect(executeTool).toHaveBeenCalledWith({ id: 'call', name: 'a.b', input: {} });
  await expect(runProviderToolTurn({ ...projectionInput('openai', adapters), tools: [{ ...closedTool('one'), wireName: 'same' }, { ...closedTool('two'), wireName: 'same' }] })).rejects.toBeInstanceOf(ProviderToolProjectionError);
  await expect(runProviderToolTurn({ ...projectionInput('openai', adapters), tools: [{ ...closedTool('one'), wireName: 'invalid.name' }] })).rejects.toBeInstanceOf(ProviderToolProjectionError);
});

test('concurrent turns keep snapshot, name and schema decoder isolated', async () => {
  async function run(id: string) {
    const calls: ProviderToolCall[] = [];
    const adapters = projectionAdapters(async port => {
      await Promise.resolve();
      const tool = declarations('openai', port.getTools({ strict: true }))[0]!;
      await port.executeTool({ id: 'call', name: String(tool.name), input: { optional: null } });
    });
    await runProviderToolTurn({ ...projectionInput('openai', adapters), executeTool: async call => { calls.push(call); return { content: 'ok' }; } }, { getToolSnapshot: () => [closedTool(id)] });
    return calls;
  }
  expect(await Promise.all([run('one.tool'), run('two.tool')])).toEqual([
    [{ id: 'call', name: 'one.tool', input: {} }], [{ id: 'call', name: 'two.tool', input: {} }],
  ]);
});

describe('adapter port plumbing per protocol', () => {
  const marker = { type: 'fabricated_role_marker', marker: 'Human:', messageId: 'm1' } as const;
  const unknownToolUse = { type: 'tool_use', id: 'u1', name: 'never_published', input: { raw: '1' } } as const;
  function turnInput(protocol: ByokProtocol, adapters: ProviderTurnAdapters, events: unknown[]): ProviderToolTurnInput {
    return { protocol, adapters, apiKey: 'key', model: 'model', system: 'sys', messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }], tools: [], executeTool: async () => ({ content: 'ok' }), onEvent: event => events.push(event) };
  }
  // Every adapter: drops the fabricated-role marker, passes an unpublished tool_use through
  // undecoded, renders a non-text tool result as a readable summary, and reports no stop reason.
  const expectedPassThrough = { type: 'tool_use', id: 'u1', name: 'never_published', input: { raw: '1' } };

  test('anthropic: forwards signal and turn bound, renders a URL-sourced image block verbatim, and reports a null stop reason', async () => {
    const controller = new AbortController();
    const events: unknown[] = [];
    let seen: Record<string, unknown> = {};
    const anthropic: ProviderTurnAdapters['anthropic'] = async (required, optional = {}) => {
      seen = { ...optional, ...required };
      required.onEvent(marker);
      required.onEvent(unknownToolUse);
      required.onEvent({ type: 'tool_result', toolUseId: 'u1', content: [{ type: 'image', source: { type: 'url', url: 'https://img.test/a.png' } }], isError: false });
      return { stopReason: null, toolTurns: 0 };
    };
    const result = await runProviderToolTurn(turnInput('anthropic', { ...providerTurnAdapters, anthropic }, events), { signal: controller.signal, maxToolTurns: 3 });
    expect(seen).toMatchObject({ signal: controller.signal, maxToolTurns: 3, maxTokens: 8192 });
    expect(events).toEqual([expectedPassThrough, { type: 'tool_result', toolUseId: 'u1', content: '{"type":"image","source":{"type":"url","url":"https://img.test/a.png"}}', isError: false }]);
    expect(result).toEqual({ stopReason: null, toolTurns: 0 });
  });

  test.each(['openai', 'azure'] as const)('%s: forwards signal, token and turn bounds and summarizes a URL image part', async protocol => {
    const controller = new AbortController();
    const events: unknown[] = [];
    let seen: Record<string, unknown> = {};
    let seenRequired: object = {};
    let seenOptional: object = {};
    const adapter = async (required: { onEvent: (event: never) => void }, optional: object = {}) => {
      seen = { ...optional, ...required };
      seenRequired = required;
      seenOptional = optional;
      required.onEvent(marker as never);
      required.onEvent(unknownToolUse as never);
      required.onEvent({ type: 'tool_result', toolUseId: 'u1', content: [{ type: 'text', text: 'caption' }, { type: 'image_url', image_url: { url: 'https://img.test/b.png' } }], isError: false } as never);
      return { finishReason: null, toolTurns: 0 };
    };
    const adapters: ProviderTurnAdapters = { ...providerTurnAdapters, [protocol]: adapter };
    const result = await runProviderToolTurn(turnInput(protocol, adapters, events), { baseUrl: 'https://resource.test', signal: controller.signal, maxTokens: 77, maxToolTurns: 4 });
    expect(seen).toMatchObject({ signal: controller.signal, maxTokens: 77, maxToolTurns: 4 });
    expect(protocol === 'azure' ? seenRequired : seenOptional).toHaveProperty('baseUrl', 'https://resource.test');
    expect(protocol === 'azure' ? seenOptional : seenRequired).not.toHaveProperty('baseUrl');
    expect(events).toEqual([expectedPassThrough, { type: 'tool_result', toolUseId: 'u1', content: 'caption\n[image: url]', isError: false }]);
    expect(result).toEqual({ stopReason: null, toolTurns: 0 });
  });

  test('google: maps assistant history to the model role, forwards the turn bound, and summarizes inline image data', async () => {
    const events: unknown[] = [];
    let seen: Record<string, unknown> = {};
    const google: ProviderTurnAdapters['google'] = async (required, optional = {}) => {
      seen = { ...optional, ...required };
      required.onEvent(marker);
      required.onEvent(unknownToolUse);
      required.onEvent({ type: 'tool_result', toolUseId: 'u1', content: [{ inlineData: { mimeType: 'image/webp', data: 'AAAA' } }], isError: false });
      return { finishReason: null, toolTurns: 0 };
    };
    const result = await runProviderToolTurn(turnInput('google', { ...providerTurnAdapters, google }, events), { maxToolTurns: 5 });
    expect((seen.contents as Array<{ role: string }>).map(content => content.role)).toEqual(['user', 'model']);
    expect(seen.maxToolTurns).toBe(5);
    expect(events).toEqual([expectedPassThrough, { type: 'tool_result', toolUseId: 'u1', content: '[image: image/webp]', isError: false }]);
    expect(result).toEqual({ stopReason: null, toolTurns: 0 });
  });

  // Adapters are a host-supplied port; a non-conforming JavaScript adapter must not crash the
  // event mapping when it reports a structured (non-array) tool result.
  test('a non-array structured tool result from a host adapter is rendered as JSON', async () => {
    const events: unknown[] = [];
    const openai: ProviderTurnAdapters['openai'] = async (required) => {
      required.onEvent({ type: 'tool_result', toolUseId: 'u2', content: { rows: 2 } as never, isError: false });
      return { finishReason: 'stop', toolTurns: 1 };
    };
    await runProviderToolTurn(turnInput('openai', { ...providerTurnAdapters, openai }, events));
    expect(events).toEqual([{ type: 'tool_result', toolUseId: 'u2', content: '{"rows":2}', isError: false }]);
  });

  test('a tool whose pinned wire name changes between snapshots fails closed on refresh', async () => {
    let wireName = 'first_name';
    const adapters = projectionAdapters(async port => {
      wireName = 'second_name';
      expect(() => port.getTools()).toThrow(ProviderToolProjectionError);
    });
    await runProviderToolTurn({ ...projectionInput('openai', adapters) }, { getToolSnapshot: () => [{ ...closedTool('renamed'), wireName }] });
    expect(wireName).toBe('second_name');
  });
});
