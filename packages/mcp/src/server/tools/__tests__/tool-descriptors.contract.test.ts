/**
 * Contract pins for the model-facing tool descriptors (Stryker L3, 2026-10-25: every
 * `inputSchema` / `required` / `additionalProperties` / `annotations` literal in these four files
 * could be emptied or flipped with no test failing). The schema is what the model is told it may
 * send and the annotations drive approval UX, so each is pinned against an INLINE expected value
 * (not a regenerated snapshot) and then exercised with a real JSON-schema validator: one good
 * input, one with an extra key, one missing the required key.
 */
import { describe, expect, it } from 'vitest';
import { Validator, type Schema } from '@cfworker/json-schema';
import { describeComponentTool, searchComponentsTool } from '../component-catalog-tools.js';
import { describeToolTool, searchToolsTool } from '../tool-catalog-tools.js';
import { cancelRunTool, getActiveContextTool, getRunTool, listAgentsTool, startRunTool } from '../run-tools.js';
import { createCheckMessagesTool } from '../../message-relay.js';
import type { McpToolDef } from '../../tool-protocol.js';

const text = expect.any(String);
const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false };
const limitSchema = { type: 'integer', minimum: 1, maximum: 25, description: text };

function valid(tool: McpToolDef, input: unknown): boolean {
  return new Validator(tool.inputSchema as Schema, '2020-12', false).validate(input).valid;
}

const checkMessages = createCheckMessagesTool({ runId: 'r1', nonce: 'n'.repeat(48) });

describe('tool descriptor contracts (inline, exact)', () => {
  it.each([
    ['search_components', searchComponentsTool, {
      type: 'object',
      properties: { query: { type: 'string', description: text }, limit: limitSchema },
      required: ['query'],
      additionalProperties: false,
    }, { ...READ, title: 'Search the interactive-UI component catalog' }],
    ['describe_component', describeComponentTool, {
      type: 'object',
      properties: { id: { type: 'string', description: text } },
      required: ['id'],
      additionalProperties: false,
    }, { ...READ, title: 'Describe an interactive-UI component' }],
    ['search_tools', searchToolsTool, {
      type: 'object',
      properties: { query: { type: 'string', description: text }, limit: limitSchema },
      required: ['query'],
      additionalProperties: false,
    }, { ...READ, title: 'Search the tool catalog' }],
    ['describe_tool', describeToolTool, {
      type: 'object',
      properties: {
        id: { type: 'string', description: text },
        toolId: { type: 'string', description: text },
        name: { type: 'string', description: text },
      },
      anyOf: [{ required: ['id'] }, { required: ['toolId'] }, { required: ['name'] }],
      additionalProperties: false,
    }, { ...READ, title: 'Describe a tool' }],
    ['start_run', startRunTool, {
      type: 'object',
      properties: {
        contextRef: { type: 'string', description: text },
        agentId: { type: 'string', description: text },
        idempotencyKey: { type: 'string', description: text },
      },
      required: ['contextRef'],
      additionalProperties: false,
    }, { ...WRITE, title: 'Start a run' }],
    ['get_run', getRunTool, {
      type: 'object',
      properties: { runId: { type: 'string', description: text } },
      required: ['runId'],
      additionalProperties: false,
    }, { ...READ, title: 'Check a run' }],
    ['cancel_run', cancelRunTool, {
      type: 'object',
      properties: { runId: { type: 'string', description: text }, reason: { type: 'string', description: text } },
      required: ['runId'],
      additionalProperties: false,
    }, { ...WRITE, title: 'Cancel a run' }],
    ['get_active_context', getActiveContextTool, { type: 'object', properties: {}, additionalProperties: false },
      { ...READ, title: 'What is the caller focused on?' }],
    ['list_agents', listAgentsTool, { type: 'object', properties: {}, additionalProperties: false },
      { ...READ, title: 'List registered agents' }],
    ['check_messages', checkMessages, { type: 'object', properties: {}, additionalProperties: false },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false }],
  ] as const)('%s', (name, tool, inputSchema, annotations) => {
    expect(tool.name).toBe(name);
    expect(tool.inputSchema).toEqual(inputSchema);
    expect(tool.annotations).toEqual(annotations);
  });

  it('describe_tool normalizes toolId/name aliases onto id', () => {
    expect(describeToolTool.argumentNormalization).toEqual({ aliases: { toolId: 'id', name: 'id' } });
  });
});

describe('tool input schemas validate (good / extra key / missing required)', () => {
  it.each([
    [searchComponentsTool, { query: 'q', limit: 25 }, { query: 'q', extra: 1 }, { limit: 3 }],
    [describeComponentTool, { id: 'x' }, { id: 'x', extra: 1 }, {}],
    [searchToolsTool, { query: 'q', limit: 1 }, { query: 'q', extra: 1 }, { limit: 3 }],
    [describeToolTool, { toolId: 'x' }, { id: 'x', extra: 1 }, {}],
    [startRunTool, { contextRef: 'c', agentId: 'a', idempotencyKey: 'k' }, { contextRef: 'c', extra: 1 }, { agentId: 'a' }],
    [getRunTool, { runId: 'r' }, { runId: 'r', extra: 1 }, {}],
    [cancelRunTool, { runId: 'r', reason: 'why' }, { runId: 'r', extra: 1 }, { reason: 'why' }],
  ] as const)('%#', (tool, good, extra, missing) => {
    expect(valid(tool, good)).toBe(true);
    expect(valid(tool, extra)).toBe(false);
    expect(valid(tool, missing)).toBe(false);
  });

  it.each([searchComponentsTool, searchToolsTool])('limit bounds are 1..25 integers ($name)', (tool) => {
    expect([0, 1, 25, 26, 1.5].map((limit) => valid(tool, { query: 'q', limit }))).toEqual([false, true, true, false, false]);
  });

  it.each([getActiveContextTool, listAgentsTool, checkMessages])('$name accepts only {}', (tool) => {
    expect(valid(tool, {})).toBe(true);
    expect(valid(tool, { any: 1 })).toBe(false);
  });
});
