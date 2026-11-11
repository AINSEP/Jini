import { describe, expect, it } from 'vitest';
import { agentWriteRules } from '../agent-value-write-tools.js';
import { AGENT_WRITE_CONFIRMATION_SETTINGS, AGENT_WRITE_DENIED_SETTINGS, findAgentWriteRule } from '../agent-write-denylist.js';

/** AP6: the owner-decided agent-write policy (2026-10-01) is pinned in full, rule matching is exact
 *  per clause, and host extensions append while a host confirmation list REPLACES the defaults. */
describe('agent write policy defaults', () => {
  it('pins the confirmation rules and the empty deny list', () => {
    expect(AGENT_WRITE_CONFIRMATION_SETTINGS).toEqual([
      { namespace: 'core.privacy', reason: 'Telemetry consent must record a human decision' },
      { namespace: 'core.instructions', key: 'custom', reason: "The assistant's own standing instructions are self-modification" },
    ]);
    expect(AGENT_WRITE_DENIED_SETTINGS).toEqual([]);
  });
});

describe('findAgentWriteRule', () => {
  const rules = AGENT_WRITE_CONFIRMATION_SETTINGS;
  it.each([
    [{ namespace: 'core.privacy', key: 'anything' }, 'core.privacy'],
    [{ namespace: 'core.instructions', key: 'custom' }, 'core.instructions'],
  ])('%j matches %s', (target, namespace) => {
    expect(findAgentWriteRule(rules, target)?.namespace).toBe(namespace);
  });
  it.each([
    { namespace: 'core.instructions', key: 'other' }, { namespace: 'core.privacyx', key: 'a' }, { namespace: 'core', key: 'privacy' }, { namespace: 'Core.Privacy', key: 'a' },
  ])('%j matches nothing', (target) => {
    expect(findAgentWriteRule(rules, target)).toBeUndefined();
  });
  it('returns the FIRST matching rule', () => {
    const first = { namespace: 'n', reason: 'first' }; const second = { namespace: 'n', key: 'k', reason: 'second' };
    expect(findAgentWriteRule([first, second], { namespace: 'n', key: 'k' })).toBe(first);
  });
});

describe('agentWriteRules composition', () => {
  const extra = { namespace: 'host.x', reason: 'host' };
  it('defaults: package denials and package confirmations', () => {
    expect(agentWriteRules({} as never)).toEqual({ denied: [], confirmation: [...AGENT_WRITE_CONFIRMATION_SETTINGS] });
  });
  it('host extras append to both lists; a host confirmation list replaces the package defaults', () => {
    expect(agentWriteRules({ extraDeniedSettings: [extra], extraConfirmationSettings: [extra] } as never)).toEqual({ denied: [extra], confirmation: [...AGENT_WRITE_CONFIRMATION_SETTINGS, extra] });
    const replaced = { namespace: 'only', reason: 'r' };
    expect(agentWriteRules({ confirmationSettings: [replaced], extraConfirmationSettings: [extra] } as never).confirmation).toEqual([replaced, extra]);
    expect(agentWriteRules({ confirmationSettings: [] } as never).confirmation).toEqual([]);
  });
});
