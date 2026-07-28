import { describe, expect, it } from 'vitest';
import * as pkgBarrel from '../index.js';

describe('@injini/agent-runtime root barrel', () => {
  it('re-exports the agent-protocol public surface', () => {
    expect(typeof pkgBarrel.createJsonLineStream).toBe('function');
    expect(typeof pkgBarrel.attachAcpSession).toBe('function');
    expect(typeof pkgBarrel.attachPiRpcSession).toBe('function');
    expect(typeof pkgBarrel.noopAccountFailureClassifier).toBe('object');
    // The real ACP subprocess transport keeps the plain `detectAcpModels`
    // name at the package barrel (see the alias note below).
    expect(typeof pkgBarrel.detectAcpModels).toBe('function');
  });

  it('re-exports the runtimes/ registry + defs + stream-parser surface', () => {
    expect(Array.isArray(pkgBarrel.AGENT_DEFS)).toBe(true);
    expect(pkgBarrel.AGENT_DEFS.length).toBeGreaterThan(0);
    expect(typeof pkgBarrel.getAgentDef).toBe('function');
    expect(typeof pkgBarrel.detectAgents).toBe('function');
    expect(typeof pkgBarrel.createClaudeStreamHandler).toBe('function');
    expect(typeof pkgBarrel.createJsonEventStreamHandler).toBe('function');
    expect(typeof pkgBarrel.createQoderStreamHandler).toBe('function');
    expect(typeof pkgBarrel.createCopilotStreamHandler).toBe('function');
  });

  it('resolves the two barrel-merge name collisions to distinct, real implementations', () => {
    // `detectAcpModels` (the real ACP transport, from agent-protocol/) and
    // `probeAcpModels` (acp-model-probe.ts's injectable no-op-by-default
    // seam, used internally by defs/shared.ts) are two different functions
    // kept under two different names — see source-map.md's "Barrel merge"
    // section.
    expect(pkgBarrel.detectAcpModels).not.toBe(pkgBarrel.probeAcpModels);
    expect(typeof pkgBarrel.probeAcpModels).toBe('function');

    // `parsePiModels` (pi-models.ts, the standalone copy with real internal
    // consumers) and `parsePiRpcModels` (agent-protocol/pi-rpc's own copy of
    // the identical OD origin function) are two independently-ported
    // functions kept under two different names.
    expect(typeof pkgBarrel.parsePiModels).toBe('function');
    expect(typeof pkgBarrel.parsePiRpcModels).toBe('function');
    expect(pkgBarrel.parsePiModels).not.toBe(pkgBarrel.parsePiRpcModels);
    // Both are verified-identical ports of the same origin function, so
    // they must still agree on behavior for the same input.
    const stdout = 'provider model\nopenai gpt-5\nanthropic claude\n';
    expect(pkgBarrel.parsePiModels(stdout)).toEqual(pkgBarrel.parsePiRpcModels(stdout));
  });
});
