import assert from 'node:assert/strict';
import { test, expect, vi } from 'vitest';
import type { ProviderToolDescriptor as ToolDescriptor, ProviderToolTurnInput, ProviderToolTurnOptions, ProviderProtocol as ByokProtocol, ProviderToolResult as ByokToolResult } from '../tool-turn.js';
import { runProviderToolTurn, providerTurnAdapters } from '../tool-turn.js';
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
    assert.deepEqual(parameters, {
        type: "object",
        properties: {
            filter: { type: "object", properties: { slug: { type: "string" } } },
        },
        required: [],
    });
    assert.ok(!JSON.stringify(parameters).includes("additionalProperties"));
    assert.ok(!JSON.stringify(parameters).includes("$schema"));
});
test("runByokProviderTurn(anthropic): the SAME tool schema reaches the outbound request untouched — additionalProperties/$schema preserved", async (t) => {
    const capture = await captureOutboundRequest(t);
    await runByokProviderTurn(baseInput("anthropic", capture.baseUrl));
    const body = capture.body();
    const tools = body.tools as Array<{
        input_schema: Record<string, unknown>;
    }>;
    assert.ok(tools[0]);
    assert.deepEqual(tools[0].input_schema, TOOL_WITH_NESTED_ADDITIONAL_PROPERTIES.inputSchema);
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
test("runByokProviderTurn(openai): the outbound request carries the tool schema untouched, same as anthropic — the Google-only sanitizer must not leak into this protocol", async (t) => {
    const capture = await captureOutboundRequest(t);
    await runByokProviderTurn(baseInput("openai", capture.baseUrl));
    const body = capture.body();
    const tools = body.tools as Array<{
        function: {
            parameters: Record<string, unknown>;
        };
    }>;
    assert.ok(tools[0]);
    assert.deepEqual(tools[0].function.parameters, TOOL_WITH_NESTED_ADDITIONAL_PROPERTIES.inputSchema);
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
