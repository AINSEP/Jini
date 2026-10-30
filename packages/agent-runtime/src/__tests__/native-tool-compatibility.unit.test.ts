import { expect, it } from 'vitest';
import { antigravityAgentDef } from '../defs/antigravity.js';
import { claudeAgentDef } from '../defs/claude.js';
import { codexAgentDef } from '../defs/codex.js';
import { resolveNativeToolPolicy, assessNativeToolPolicy } from '../native-tool-policy.js';

it.each(['OpenCode', 'another CLI'])('names only the unsupported OFF switch for %s', name => {
  expect(assessNativeToolPolicy({ def: { name }, policy: { nativeToolAccess: true, cliParity: true,
    permissionMode: 'bypass', nativeCapabilities: { shell: true, userMcp: false } } })).toBe(
    `${name} can't run with 'Your MCP servers' off. Turn it on in the assistant settings, or choose Claude or Codex.`);
});

it('does not reject supported adapters, unrestricted parity, or a standalone unspecified policy', () => {
  expect(assessNativeToolPolicy({ def: { name: 'Claude', supportsNativeToolAccess: true }, policy: {
    nativeToolAccess: false, nativeCapabilities: { userMcp: false } } })).toBeNull();
  expect(assessNativeToolPolicy({ def: { name: 'Another CLI' }, policy: {
    nativeToolAccess: true, cliParity: true, permissionMode: 'bypass' } })).toBeNull();
  expect(assessNativeToolPolicy({ def: { name: 'Another CLI' }, policy: {} })).toBeNull();
});

it('never lets parity override the master lock, a restricted run, or an unknown explicit OFF', () => {
  for (const policy of [
    { nativeToolAccess: false, cliParity: true, permissionMode: 'bypass' as const },
    { nativeToolAccess: true, cliParity: true, permissionMode: 'restricted' as const },
    { nativeCapabilities: JSON.parse('{"futureSwitch":false}') },
  ]) expect(assessNativeToolPolicy({ def: { name: 'Another CLI' }, policy })).toMatch(/can't run/);
});

it('projects full access for a definition requiring it without owner eligibility', () => {
  const limits = { nativeToolAccess: false, permissionMode: 'restricted' as const,
    nativeCapabilities: { shell: false, userMcp: false } };
  for (const policy of [limits, {}]) {
    const full = resolveNativeToolPolicy({ def: antigravityAgentDef, policy });
    expect(full).toMatchObject({ nativeToolAccess: true, cliParity: true, permissionMode: 'bypass' });
    expect(Object.values(full.nativeCapabilities!)).toEqual(Array(8).fill(true));
    expect(assessNativeToolPolicy({ def: antigravityAgentDef, policy })).toBeNull();
  }
  expect(limits.nativeCapabilities).toEqual({ shell: false, userMcp: false });
  for (const def of [claudeAgentDef, codexAgentDef]) {
    expect(resolveNativeToolPolicy({ def, policy: limits })).toBe(limits);
    expect(assessNativeToolPolicy({ def, policy: limits })).toBeNull();
  }
});
