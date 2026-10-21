/** Shape narrowing of untrusted MCP server responses: what survives, and what is defaulted or dropped. */
import { describe, expect, it } from "vitest";
import { parseCallToolResult, parseInitializeResult, parseToolsListPage } from "../mcp-protocol.js";

describe("parseInitializeResult", () => {
  it("reads the protocol version and server identity when they are well-typed", () => {
    expect(parseInitializeResult({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "files", version: "1.2.0" } } }))
      .toEqual({ protocolVersion: "2025-06-18", info: { name: "files", version: "1.2.0" } });
  });

  it("defaults every field it cannot trust instead of carrying a wrong type through", () => {
    expect(parseInitializeResult({ result: { protocolVersion: 20250618, serverInfo: { name: 7, version: null } } }))
      .toEqual({ protocolVersion: "", info: { name: undefined, version: undefined } });
    expect(parseInitializeResult({ result: "not an object" })).toEqual({ protocolVersion: "", info: { name: undefined, version: undefined } });
  });
});

describe("parseCallToolResult", () => {
  it("carries an out-of-spec non-object result through as content rather than discarding it", () => {
    expect(parseCallToolResult({ result: "bare string" })).toEqual({ content: "bare string" });
    expect(parseCallToolResult({ result: [1, 2] })).toEqual({ content: [1, 2] });
  });

  it("reports isError only for a literal true", () => {
    expect(parseCallToolResult({ result: { content: [{ type: "text", text: "x" }], structuredContent: { n: 1 }, isError: true } }))
      .toEqual({ content: [{ type: "text", text: "x" }], structuredContent: { n: 1 }, isError: true });
    expect(parseCallToolResult({ result: { content: [], isError: "true" } }).isError).toBe(false);
  });
});

describe("parseToolsListPage", () => {
  it("keeps well-typed annotations and drops wrongly typed ones field by field", () => {
    const page = parseToolsListPage({ result: { tools: [
      { name: "read", description: "Reads", inputSchema: { type: "object" }, annotations: { title: "Read", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      { name: "write", description: 5, annotations: { title: 1, readOnlyHint: "yes", destructiveHint: "no", idempotentHint: 0, openWorldHint: null } },
      { name: "plain" },
    ], nextCursor: "page-2" } });
    expect(page.nextCursor).toBe("page-2");
    expect(page.tools).toEqual([
      { name: "read", description: "Reads", inputSchema: { type: "object" }, annotations: { title: "Read", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
      { name: "write", description: undefined, inputSchema: undefined, annotations: { title: undefined, readOnlyHint: undefined, destructiveHint: undefined, idempotentHint: undefined, openWorldHint: undefined } },
      { name: "plain", description: undefined, inputSchema: undefined, annotations: undefined },
    ]);
  });

  it("drops entries without a usable name and treats a missing or non-array tool list as empty", () => {
    expect(parseToolsListPage({ result: { tools: [null, { name: "" }, { name: 3 }, "x"] } })).toEqual({ tools: [], nextCursor: undefined });
    expect(parseToolsListPage({ result: { tools: "nope", nextCursor: "" } })).toEqual({ tools: [], nextCursor: undefined });
    expect(parseToolsListPage({ result: null })).toEqual({ tools: [], nextCursor: undefined });
  });
});
