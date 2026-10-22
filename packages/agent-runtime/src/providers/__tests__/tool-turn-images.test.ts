import assert from 'node:assert/strict';
import { test, expect, vi } from 'vitest';
import type { ProviderToolDescriptor as ToolDescriptor, ProviderToolTurnInput, ProviderToolTurnOptions, ProviderProtocol as ByokProtocol, ProviderToolResult as ByokToolResult } from '../tool-turn.js';
import { runProviderToolTurn, providerTurnAdapters } from '../tool-turn.js';
import { startStubProviderServer, runFixtureTurn as runByokProviderTurn } from './transport-fixture.js';
type ByokProviderTurnInput = Omit<ProviderToolTurnInput, 'adapters'> & ProviderToolTurnOptions;
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const IMAGE_RESULT: ByokToolResult = {
    content: [
        { type: "text", text: '{"title":"ai-caps"}' },
        { type: "image", mimeType: "image/png", data: PNG_BASE64 },
    ],
};
function sseFrame(type: string, data: unknown): string {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
function anthropicToolUseTurn(id: string, name: string): string {
    return (sseFrame("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "claude-opus-4-8", stop_reason: null, stop_sequence: null } }) +
        sseFrame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } }) +
        sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }) +
        sseFrame("content_block_stop", { type: "content_block_stop", index: 0 }) +
        sseFrame("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 10 } }) +
        sseFrame("message_stop", { type: "message_stop" }));
}
function anthropicTextTurn(text: string): string {
    return (sseFrame("message_start", { type: "message_start", message: { id: "msg_2", type: "message", role: "assistant", content: [], model: "claude-opus-4-8", stop_reason: null, stop_sequence: null } }) +
        sseFrame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
        sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) +
        sseFrame("content_block_stop", { type: "content_block_stop", index: 0 }) +
        sseFrame("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }) +
        sseFrame("message_stop", { type: "message_stop" }));
}
function dataFrame(payload: unknown): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}
const OPENAI_DONE = "data: [DONE]\n\n";
function openAiToolTurn(id: string, name: string): string {
    return (dataFrame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id, function: { name, arguments: "{}" } }] }, finish_reason: null }] }) +
        dataFrame({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }) +
        OPENAI_DONE);
}
function openAiTextTurn(text: string): string {
    return dataFrame({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) + dataFrame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + OPENAI_DONE;
}
function googleToolTurn(id: string, name: string): string {
    return dataFrame({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name, args: {}, id } }] }, index: 0 }] });
}
function googleTextTurn(text: string): string {
    return dataFrame({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }] });
}
const TOOL: ToolDescriptor = { id: "view_tool", description: "view", inputSchema: { type: "object", properties: {}, required: [] } };
async function roundTrip(t: unknown, protocol: ByokProtocol, firstReply: string, secondReply: string): Promise<{
    body: Record<string, unknown>;
    toolResults: Array<Record<string, unknown>>;
}> {
    let second: Record<string, unknown> | undefined;
    const baseUrl = await startStubProviderServer({ handler: (callCount, requestBody) => {
            if (callCount === 1)
                return { status: 200, body: firstReply };
            second = requestBody;
            return { status: 200, body: secondReply };
        } });
    const events: Array<Record<string, unknown>> = [];
    await runByokProviderTurn({
        protocol,
        baseUrl,
        apiKey: "test-key-not-real",
        model: protocol === "google" ? "gemini-3.6-flash" : protocol === "anthropic" ? "claude-opus-4-8" : "gpt-5",
        system: "be terse",
        messages: [{ role: "user", content: "look at the image" }],
        tools: [TOOL],
        executeTool: async () => IMAGE_RESULT,
        onEvent: (event) => events.push(event as unknown as Record<string, unknown>),
    });
    assert.ok(second, "expected a second request carrying the tool result");
    return { body: second, toolResults: events.filter((event) => event.type === "tool_result") };
}
function assertReadableToolResultEvent(toolResults: Array<Record<string, unknown>>): void {
    assert.equal(toolResults.length, 1);
    const content = toolResults[0]!.content;
    assert.equal(typeof content, "string");
    assert.ok(!(content as string).includes(PNG_BASE64), "the chat-pane event must not carry the raw base64");
    assert.equal(content, '{"title":"ai-caps"}\n[image: image/png]');
    assert.equal(toolResults[0]!.isError, false);
}
test("ANTHROPIC: the tool_result block carries a real base64 image block", async (t) => {
    const { body, toolResults } = await roundTrip(t, "anthropic", anthropicToolUseTurn("toolu_1", "view_tool"), anthropicTextTurn("A red cap."));
    const messages = body.messages as Array<{
        role: string;
        content: unknown;
    }>;
    const toolResultBlock = messages
        .flatMap((message) => (Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : []))
        .find((block) => block.type === "tool_result");
    assert.ok(toolResultBlock, "expected a tool_result block in the follow-up request");
    assert.deepEqual(toolResultBlock.content, [
        { type: "text", text: '{"title":"ai-caps"}' },
        { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_BASE64 } },
    ]);
    assertReadableToolResultEvent(toolResults);
});
for (const protocol of ["openai", "azure"] as const) {
    test(`${protocol.toUpperCase()}: the image reaches the model as an image_url data URL part`, async (t) => {
        const { body, toolResults } = await roundTrip(t, protocol, openAiToolTurn("call_1", "view_tool"), openAiTextTurn("A red cap."));
        const messages = body.messages as Array<{
            role: string;
            content: unknown;
            tool_call_id?: string;
        }>;
        const imageParts = messages
            .flatMap((message) => (Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : []))
            .filter((part) => part.type === "image_url");
        assert.deepEqual(imageParts, [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BASE64}` } }]);
        const toolMessage = messages.find((message) => message.role === "tool");
        assert.ok(toolMessage, "expected the tool message");
        assert.ok(!JSON.stringify(toolMessage.content).includes(PNG_BASE64), "the tool message itself must not carry the base64 as text");
        assertReadableToolResultEvent(toolResults);
    });
}
test("GOOGLE: the image reaches the model as an inlineData part", async (t) => {
    const { body, toolResults } = await roundTrip(t, "google", googleToolTurn("call_1", "view_tool"), googleTextTurn("A red cap."));
    const contents = body.contents as Array<{
        role: string;
        parts: Array<Record<string, unknown>>;
    }>;
    const inline = contents.flatMap((content) => content.parts).filter((part) => "inlineData" in part);
    assert.deepEqual(inline, [{ inlineData: { mimeType: "image/png", data: PNG_BASE64 } }]);
    assert.ok(!JSON.stringify(contents.flatMap((content) => content.parts).filter((part) => "functionResponse" in part)).includes(PNG_BASE64));
    assertReadableToolResultEvent(toolResults);
});
