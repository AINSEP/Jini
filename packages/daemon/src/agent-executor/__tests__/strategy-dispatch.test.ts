import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { AgentRuntimeStrategies } from '../../ports/agent-runtime.js';
import { fakeAgentDef, fakeAgentRuntimePort } from '../../ports/__tests__/agent-runtime-port.fake.js';
import { createInMemoryEventLog } from '../../event-log.js';
import { createRunLifecycle } from '../../run-lifecycle.js';
import { wireChildLifecycle } from '../child-lifecycle.js';
import { buildMcpBridgeDelivery } from '../mcp-bridge.js';
import { createDef, createFakeChild, stopResult } from './r8a-rig.js';
import { agentRuntimeFixture } from './runtime-fixture.js';
import { createCliToolCallReceiver } from '../tool-call-receipts.js';

/**
 * @file K01 pin: the daemon selects vendor behaviour from the strategies the host's runtime binding supplies for a
 * definition, never from the definition's id or dialect. Two unrelated fake bindings, with ids the daemon has never heard
 * of, must each drive their own receipt dialect and MCP delivery variable. Dispatching on one fixture's id (or on any
 * built-in CLI name) turns the second fake red.
 */
interface FakeRuntime { readonly def: RuntimeAgentDef; readonly strategies: AgentRuntimeStrategies; readonly expectedReceipt: Record<string, unknown>; readonly expectedVar: string }

const toolUse = { type: 'tool_use', name: 'zz.lookup', input: { q: 1 } };
const FAKES: readonly FakeRuntime[] = [
  {
    def: fakeAgentDef({ id: 'synthetic-alpha' }, { eventParser: 'alpha-dialect', externalMcpInjection: 'opencode-env-content' }),
    strategies: { toolCallReceipt: ({ event }) => ({ ...event, bridgeCall: { name: 'alpha-correlation', input: event.input } }), mcpDelivery: { envContentVar: 'ALPHA_MCP_DOC' } },
    expectedReceipt: { ...toolUse, bridgeCall: { name: 'alpha-correlation', input: { q: 1 } } },
    expectedVar: 'ALPHA_MCP_DOC',
  },
  {
    def: fakeAgentDef({ id: 'synthetic-beta' }, { eventParser: 'beta-dialect', externalMcpInjection: 'mimo-env-content' }),
    strategies: { toolCallReceipt: ({ event }) => ({ ...event, bridgeCall: { name: 'beta-correlation', input: event.input, buffered: true } }), mcpDelivery: { envContentVar: 'BETA_MCP_DOC' } },
    expectedReceipt: { ...toolUse, bridgeCall: { name: 'beta-correlation', input: { q: 1 }, buffered: true } },
    expectedVar: 'BETA_MCP_DOC',
  },
];
const options = { command: '/bin/bridge', daemonUrl: 'http://127.0.0.1:1' };

describe.each(FAKES)('fake runtime $def.id', ({ def, strategies, expectedReceipt, expectedVar }) => {
  const port = fakeAgentRuntimePort({}, { strategies: { for: ({ def: asked }) => (asked.id === def.id ? strategies : {}) } });

  it('shapes tool receipts with only the strategy it bound', () => {
    const seen: Record<string, unknown>[] = [];
    createCliToolCallReceiver({ strategy: port.strategies.for({ def }), onEvent: event => seen.push(event) })(toolUse);
    expect(seen).toEqual([expectedReceipt]);
  });

  // The launcher's own path: a native tool call parsed from the child's stdout reaches the run's stream shaped by the
  // bound receipt only. The fake parser stands in for the runtime's, so the dialect name carries no meaning to the daemon.
  it('wires the bound receipt into the child stream a run emits', async () => {
    const lifecycle = createRunLifecycle({ eventLog: createInMemoryEventLog({}) });
    const { run } = await lifecycle.start({ contextRef: 'strategy-dispatch' });
    const events: Array<{ kind: string; payload: unknown }> = [];
    await lifecycle.stream({ runId: run.id, onEvent: event => { events.push(event as never); } });
    const child = createFakeChild(7400);
    const real = agentRuntimeFixture();
    wireChildLifecycle({
      runId: run.id, lifecycle, child: child as unknown as ChildProcess,
      streams: { ...real.streams, jsonEvents: ({ onEvent }) => ({ feed: ({ chunk }) => { for (const line of chunk.split('\n').filter(Boolean)) onEvent(JSON.parse(line)); }, flush: () => {} }) },
      strategies: port.strategies, identityKind: real.models.identityKind,
      def: createDef({ id: def.id, streamFormat: 'json-event-stream', ...(def.eventParser === undefined ? {} : { eventParser: def.eventParser }) }),
      streamFormat: 'json-event-stream', onCleanupFailure: vi.fn(), cleanupStagedFiles: async () => {},
      journal: undefined, continuation: undefined, classifyFailure: undefined, bufferedStdoutMaxBytes: 1024, expectsJiniBridge: false,
      bridgeProbeEntry: undefined, probeMcpBridge: vi.fn(), listProcessSnapshots: async () => [], collectProcessTreePids: () => [],
      stopProcesses: async () => stopResult,
    });
    child.stdout.emit('data', JSON.stringify({ type: 'tool_use', id: 'u1', name: 'zz.lookup', input: { q: 1 } }) + '\n');
    child.emit('close', 0, null);
    await lifecycle.waitForTerminal({ runId: run.id });
    expect(events.filter(event => event.kind === 'agent').map(event => (event.payload as { bridgeCall?: unknown }).bridgeCall)).toEqual([expectedReceipt.bridgeCall]);
  });

  it('delivers MCP config through the variable it bound, whatever the strategy name', () => {
    const delivery = buildMcpBridgeDelivery({ cwd: '/w', runId: 'r', strategy: def.externalMcpInjection, options, credential: undefined, mcpDelivery: port.strategies.for({ def }).mcpDelivery });
    expect(delivery).toMatchObject({ kind: 'env-content', envVarName: expectedVar });
  });
});

it('passes events through untouched when the binding supplies no receipt, even for a dialect named like a built-in CLI', () => {
  const seen: Record<string, unknown>[] = [];
  const port = fakeAgentRuntimePort();
  const def = fakeAgentDef({ id: 'opencode' }, { eventParser: 'opencode' });
  createCliToolCallReceiver({ strategy: port.strategies.for({ def }), onEvent: event => seen.push(event) })({ type: 'tool_use', name: 'srv_tool', input: {} });
  expect(seen).toEqual([{ type: 'tool_use', name: 'srv_tool', input: {} }]);
});

it('refuses an env-content strategy the binding bound no variable for', () => {
  expect(() => buildMcpBridgeDelivery({ cwd: '/w', runId: 'r', strategy: 'opencode-env-content', options, credential: undefined })).toThrow(/bind the variable/);
});
