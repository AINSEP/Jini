/** One daemon payload of every `RunAgentPayload` type, with every optional field populated.
 * Shared by the reducer-drift and round-trip goldens so both pin the same input. */
export interface FixturePayload {
  readonly type: string;
  readonly [key: string]: unknown;
}

export const NAMES = { usage: 'jini.usage', status: 'jini.status', extensionPrefix: 'jini.ext.' } as const;

export const IDS = { next: ({ prefix, ordinal }: { prefix: string; ordinal: number }) => `${prefix}_${ordinal}` };

const SURFACE_EXCHANGE = { exchangeId: 'ex-1', toolId: 'posts.delete', runId: 'run-1' };

const MCP_UI_RESOURCE = {
  type: 'resource',
  resource: { uri: 'ui://confirm/1', mimeType: 'text/html', text: '<p>Delete?</p>', _meta: { existing: true } },
};

export const A2UI_MESSAGE = { createSurface: { surfaceId: 's1', catalogId: 'basic' } };

export const PAYLOADS: Readonly<Record<string, FixturePayload>> = {
  statusWithDetail: { type: 'status', label: 'Working', detail: 'step 2 of 3' },
  statusWithoutDetail: { type: 'status', label: 'Working' },
  textDelta: { type: 'text_delta', delta: 'Hello' },
  thinkingStart: { type: 'thinking_start' },
  thinkingDelta: { type: 'thinking_delta', delta: 'plan' },
  toolInputDelta: { type: 'tool_input_delta', id: 'call-1', delta: '{"q":' },
  toolUse: {
    type: 'tool_use', id: 'call-1', name: 'search', input: { q: 'posts' },
    toolOrigin: 'bridge', bridgeCall: { name: 'posts.search', input: { q: 'posts' }, buffered: true },
  },
  toolResult: {
    type: 'tool_result', toolUseId: 'call-1', content: 'found 3', isError: true,
    media: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }], outcome: 'unknown',
  },
  usage: {
    type: 'usage', usage: { input_tokens: 11, output_tokens: 7 }, costUsd: 0.01, cumulativeCostUsd: 0.05,
    costSessionId: 'cost-1', durationMs: 1200, stopReason: 'end_turn',
  },
  raw: { type: 'raw', line: 'raw line' },
  mcpUi: { type: 'mcp-ui', resource: MCP_UI_RESOURCE, surfaceExchange: SURFACE_EXCHANGE },
  a2ui: { type: 'a2ui', message: A2UI_MESSAGE },
  stageStart: { type: 'stage_start', stage: 'plan' },
};
