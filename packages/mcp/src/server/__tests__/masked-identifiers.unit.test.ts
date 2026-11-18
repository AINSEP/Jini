import { describe, expect, it } from 'vitest';
import type { ToolDescriptor } from '@jini-ai/core';
import { MASKED_IDENTIFIER_ROWS } from '@jini-ai/core/text/masked-identifier-rows';
import { handleToolCall, type McpToolContext, type McpToolDef } from '../tool-protocol.js';
import { createExecuteDelegatedToolTool, createTypedDelegatedToolTool } from '../tools/delegated-tool.js';

const row = (n: number): string => MASKED_IDENTIFIER_ROWS.find(entry => entry.row === n)!.text;
const SCREENSHOT_SCHEMA = { type: 'object', properties: { viewport: { type: 'string' }, fullPage: { type: 'boolean' }, dismissCookieBanners: { type: 'boolean' } }, additionalProperties: false } as const;
const DESCRIPTOR: ToolDescriptor = { id: 'web_screenshot_page', description: 'Take a screenshot', readOnly: true, inputSchema: SCREENSHOT_SCHEMA as unknown as ToolDescriptor['inputSchema'] };
const EXECUTION = '3f2b8c1e-5d47-4a8e-9b1c-0d6e7f8a9b10';
const MASKED_ROW_2 = 'Declared inputs: viewport (optional), fullPage (optional), [redacted] (optional)';

interface Failure { readonly message: string; readonly details?: Record<string, unknown> }

function failingFetch({ message, details }: Failure): typeof fetch {
  return (async () => new Response(JSON.stringify({ error: { code: 'BAD_REQUEST', message, ...(details === undefined ? {} : { details }) } }), { status: 400, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

async function resultText({ tool, args, failure, ctx = {} }: { tool: McpToolDef; args: Record<string, unknown>; failure: Failure; ctx?: Partial<McpToolContext> }): Promise<string> {
  const result = await handleToolCall({ name: tool.name, tools: new Map([[tool.name, tool]]), ctx: { baseUrl: 'http://d.example', fetchImpl: failingFetch(failure), ...ctx } }, { rawArgs: args });
  return JSON.stringify(result.content);
}

const typedScreenshot = (): McpToolDef => createTypedDelegatedToolTool({ runId: 'run-1', tool: { wireName: 'web_screenshot_page', descriptor: DESCRIPTOR } as never });
const gateway = (): McpToolDef => createExecuteDelegatedToolTool({ runId: 'run-1' });
const descriptorFor: McpToolContext['descriptorFor'] = ({ toolId }) => (toolId === DESCRIPTOR.id ? DESCRIPTOR : undefined);

describe('model-facing errors keep the names the caller may read', () => {
  it('typed call: the tool\'s own schema supplies the property names (row 2)', async () => {
    expect(await resultText({ tool: typedScreenshot(), args: {}, failure: { message: row(2) } })).toContain(row(2));
  });
  it('gateway call for a tool this run holds a descriptor for (row 2)', async () => {
    const text = await resultText({ tool: gateway(), args: { toolId: DESCRIPTOR.id, input: {} }, failure: { message: row(2) }, ctx: { descriptorFor } });
    expect(text).toContain(row(2));
  });
  it('gateway call for a tool this run never described: masked, unless the envelope carries details.inputNames', async () => {
    const args = { toolId: 'web_screenshot_page', input: {} };
    expect(await resultText({ tool: gateway(), args, failure: { message: row(2) } })).toContain(MASKED_ROW_2);
    const inputNames = ['viewport', 'fullPage', 'dismissCookieBanners'];
    expect(await resultText({ tool: gateway(), args, failure: { message: row(2), details: { inputNames } } })).toContain(row(2));
  });
  it('rows 4 and 5: details.executionId and details.toolId of the right shape', async () => {
    const args = { toolId: 'theme_write_file', input: {} };
    expect(await resultText({ tool: gateway(), args, failure: { message: row(4), details: { executionId: EXECUTION, toolId: 'theme_write_file' } } })).toContain(row(4));
    expect(await resultText({ tool: gateway(), args, failure: { message: row(5), details: { toolId: 'agent_plugin_google-login__start_sign_in' } } })).toContain(row(5).replaceAll('"', '\\"'));
  });
  it('row 3: a slug that is a scalar argument of the same call', async () => {
    const descriptor: ToolDescriptor = { id: 'media_get', description: 'Get media', readOnly: true, inputSchema: { type: 'object', properties: { slug: { type: 'string' } } } as unknown as ToolDescriptor['inputSchema'] };
    const text = await resultText({ tool: gateway(), args: { toolId: 'media_get', input: { slug: 'marquee-suit-2024-final-v2' } }, failure: { message: row(3) }, ctx: { descriptorFor: () => descriptor } });
    expect(text).toContain(row(3));
  });
});

describe('model-facing errors still mask what is not a trusted name', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  it('a bearer token, a labelled key, a UUID that is only in free text, a glued suffix and a long jobId', async () => {
    const ctx = { descriptorFor };
    const args = { toolId: DESCRIPTOR.id, input: { viewport: token } };
    const texts = await Promise.all([
      resultText({ tool: gateway(), args, failure: { message: `Authorization: Bearer ${token}` }, ctx }),
      resultText({ tool: gateway(), args, failure: { message: `apiKey: ${token}` }, ctx }),
      resultText({ tool: gateway(), args, failure: { message: `session ${EXECUTION} expired` }, ctx }),
      resultText({ tool: gateway(), args, failure: { message: 'dismissCookieBannersXYZ123 failed' }, ctx }),
      resultText({ tool: gateway(), args, failure: { message: `job ${'j'.repeat(60)} failed`, details: { jobId: 'j'.repeat(60) } }, ctx }),
    ]);
    for (const text of texts) expect(text).toContain('[redacted]');
    expect(texts[2]).not.toContain(EXECUTION);
    expect(texts.join('')).not.toContain(token);
  });
  it('the vocabulary is not a registration predicate: diagnosticToolIds is unchanged while the vocabulary holds the names', async () => {
    let seen: McpToolContext | undefined;
    const probe: McpToolDef = { ...typedScreenshot(), handler: ({ ctx }) => { seen = ctx; return {}; } };
    await handleToolCall({ name: probe.name, tools: new Map([[probe.name, probe]]), ctx: { baseUrl: 'http://d.example', fetchImpl: failingFetch({ message: 'x' }), diagnosticToolIds: ['only_registered'] } }, {});
    expect(seen?.diagnosticVocabulary).toContain('dismissCookieBanners');
    expect(seen?.diagnosticToolIds).toContain('only_registered');
    expect(seen?.diagnosticToolIds).not.toContain('dismissCookieBanners');
  });
});
