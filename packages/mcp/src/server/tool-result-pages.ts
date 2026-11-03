import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolDef } from './tool-protocol.js';

const INLINE_CHARS = 12000;
const MAX_STORED_CHARS = 8_000_000;
const MAX_RESULTS = 32;
const SMALL_BLOCK_CHARS = 1024;

export interface ToolResultPages {
  readonly tool: McpToolDef;
  project(required: { result: CallToolResult }, optional?: Record<string, never>): CallToolResult;
  clear(required: Record<string, never>, optional?: Record<string, never>): void;
}

/** Keep large text in this MCP run rather than a CLI-owned spill file outside the site sandbox.
 * Text is paged losslessly; image/resource blocks and result error flags pass through unchanged.
 * @param _required No required configuration; one instance belongs to one server run.
 * @param optional Optional opaque ID source for deterministic tests; defaults to randomUUID.
 * @returns A projection, read-only read_tool_result tool, and explicit cleanup.
 * @complexity O(n) projection for n result characters; at most 32 entries / 8M UTF-16 code units.
 * @example const pages = createToolResultPages({}); pages.project({ result });
 */
export function createToolResultPages(_required: Record<string, never>, {
  generateId = randomUUID,
}: { generateId?: () => string } = {}): ToolResultPages {
  const saved = new Map<string, string>();
  let storedChars = 0;

  /** Evict oldest entries until the new result fits; all limits are per run. */
  function save(text: string): string {
    while (saved.size >= MAX_RESULTS || storedChars + text.length > MAX_STORED_CHARS) {
      const oldest = saved.keys().next().value!;
      storedChars -= saved.get(oldest)!.length;
      saved.delete(oldest);
    }
    const id = generateId();
    saved.set(id, text);
    storedChars += text.length;
    return id;
  }

  const tool: McpToolDef = {
    name: 'read_tool_result',
    description: 'Read a page of a saved oversized tool result in this run. Use resultId from the tool response, offset (default 0), and limit (default 4000, max 8000). Returns one text block: JSON cursor metadata on its first line, then exact result text. Follow nextOffset until null. Unknown/evicted IDs fail; repeat the original tool with a narrower query. Never read CLI spill files with Bash.',
    inputSchema: { type: 'object', required: ['resultId'], additionalProperties: false, properties: {
      resultId: { type: 'string', minLength: 1 }, offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 8000 },
    } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler({ args }) {
      const resultId = args['resultId'] as string;
      const text = saved.get(resultId);
      if (text === undefined) throw new Error('Saved result is unavailable in this run. Repeat the original tool call with a narrower query.');
      const offset = (args['offset'] as number | undefined) ?? 0;
      if (offset > text.length) throw new RangeError('offset exceeds the saved result length.');
      const end = Math.min(text.length, offset + ((args['limit'] as number | undefined) ?? 4000));
      const cursor = { resultId, offset, nextOffset: end < text.length ? end : null, totalChars: text.length };
      return { content: [{ type: 'text', text: `${JSON.stringify(cursor)}\n${text.slice(offset, end)}` }] };
    },
  };

  return {
    tool,
    project({ result }) {
      const texts = result.content.flatMap(block => block.type === 'text' ? [block.text] : []);
      const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
      if (totalChars <= INLINE_CHARS) return result;
      // Keep small metadata blocks inline; page medium blocks too when their combined size spills.
      const retained = texts.filter(text => text.length > SMALL_BLOCK_CHARS);
      const retainedChars = retained.reduce((sum, text) => sum + text.length, 0);
      // Admit one response atomically so its later blocks cannot evict its earlier block IDs.
      if (retained.length > MAX_RESULTS || retainedChars > MAX_STORED_CHARS || totalChars - retainedChars > 4000) return { isError: true, content: [{ type: 'text',
        text: 'Tool result exceeds the saved-result limit. Repeat the original tool call with a narrower query. Never use Bash to read CLI spill files.' }] };
      return { ...result, content: result.content.map(block => {
        if (block.type !== 'text' || block.text.length <= SMALL_BLOCK_CHARS) return block;
        const resultId = save(block.text);
        return { ...block, text: `Saved tool result (${block.text.length} characters). Read it with read_tool_result(${JSON.stringify({ resultId, offset: 0 })}); follow nextOffset until null. Never use Bash or shell commands to read saved tool results.` };
      }) };
    },
    clear() { saved.clear(); storedChars = 0; },
  };
}
