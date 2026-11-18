import { describe, expect, it } from 'vitest';
import { MASKED_IDENTIFIER_ROWS } from '@jini-ai/core/text/masked-identifier-rows';
import { postDaemonJson } from '../daemon-client.js';
import { handleToolCall, type McpToolContext, type McpToolDef } from '../tool-protocol.js';

/** What the client prints today for each row when a nested envelope carries it as its message, with no vocabulary. */
const TODAY: Readonly<Record<number, string>> = {
  1: 'HTTP 400: BAD_REQUEST: Call publish_job_status_read with {}',
  2: 'HTTP 400: BAD_REQUEST: Declared inputs: viewport (optional), fullPage (optional), [redacted] (optional)',
  3: "HTTP 400: BAD_REQUEST: media_asset '[redacted]' was not found",
  4: 'HTTP 400: BAD_REQUEST: execution [redacted] for theme_write_file is still pending',
  5: 'HTTP 400: BAD_REQUEST: tool "[redacted]" timed out before it finished',
};

function envelopeFetch({ message }: { message: string }): typeof fetch {
  return (async () => new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message } }), { status: 400, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

const ctxFor = (fetchImpl: typeof fetch): McpToolContext => ({ baseUrl: 'http://d.example', fetchImpl });

describe('masked identifier rows through the MCP client (characterization)', () => {
  it.each(MASKED_IDENTIFIER_ROWS)('row $row through postDaemonJson', async ({ row, text }) => {
    const failure = await postDaemonJson({ baseUrl: 'http://d.example', route: '/x', body: {} }, { fetchImpl: envelopeFetch({ message: text }) }).catch((error: Error) => error);
    expect((failure as Error).message).toBe(TODAY[row]);
  });

  it.each(MASKED_IDENTIFIER_ROWS)('row $row through handleToolCall', async ({ row, text }) => {
    const tool: McpToolDef = {
      name: 'probe_tool', description: 'probe', inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      handler: ({ ctx }) => postDaemonJson({ baseUrl: ctx.baseUrl, route: '/x', body: {} }, { fetchImpl: ctx.fetchImpl }),
    };
    const result = await handleToolCall({ name: 'probe_tool', tools: new Map([[tool.name, tool]]), ctx: ctxFor(envelopeFetch({ message: text })) });
    expect(JSON.stringify(result.content)).toContain(TODAY[row]!.replaceAll('"', '\\"'));
  });
});
