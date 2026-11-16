import { describe, expect, it } from 'vitest';
import * as pkgBarrel from '../index.js';

describe('@jini-ai/agent-runtime root barrel', () => {
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
  });

  it('resolves the two barrel-merge name collisions to distinct, real implementations', () => {
    // `detectAcpModels` (the real ACP transport, from agent-protocol/) and
    // `probeAcpModels` (acp-model-probe.ts's injectable no-op-by-default
    // seam, used internally by defs/shared.ts) are two different functions
    // kept under two different names — see archived provenance ledger's "Barrel merge"
    // section.
    expect(pkgBarrel.detectAcpModels).not.toBe(pkgBarrel.probeAcpModels);
    expect(typeof pkgBarrel.probeAcpModels).toBe('function');

    // `parsePiRpcModels` is the agent-protocol/pi-rpc name for the SAME function as `parsePiModels`
    // (pi-models.ts): the two ported copies were deduplicated into one implementation, so the
    // alias must stay the single implementation rather than drift into a second copy.
    expect(typeof pkgBarrel.parsePiModels).toBe('function');
    expect(typeof pkgBarrel.parsePiRpcModels).toBe('function');
    expect(pkgBarrel.parsePiRpcModels).toBe(pkgBarrel.parsePiModels);
    const stdout = 'provider model\nopenai gpt-5\nanthropic claude\n';
    expect(pkgBarrel.parsePiRpcModels({ stdout })).toEqual([
      { id: 'default', label: 'Default (CLI config)' },
      { id: 'openai/gpt-5', label: 'openai/gpt-5' },
      { id: 'anthropic/claude', label: 'anthropic/claude' },
    ]);
  });
});
