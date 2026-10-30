import { expect, it } from 'vitest';
import { assessNativeToolPolicy } from '../native-tool-policy.js';

it.each(['Antigravity', 'OpenCode', 'another CLI'])('names only the unsupported OFF switch for %s', name => {
  expect(assessNativeToolPolicy({ def: { name }, policy: { nativeToolAccess: true, cliParity: true,
    permissionMode: 'bypass', nativeCapabilities: { shell: true, userMcp: false } } })).toBe(
    `${name} can't run with 'Your MCP servers' off. Turn it on in the assistant settings, or choose Claude or Codex.`);
});

it('does not reject supported adapters, unrestricted parity, or a standalone unspecified policy', () => {
  expect(assessNativeToolPolicy({ def: { name: 'Claude', supportsNativeToolAccess: true }, policy: {
    nativeToolAccess: false, nativeCapabilities: { userMcp: false } } })).toBeNull();
  expect(assessNativeToolPolicy({ def: { name: 'Antigravity' }, policy: {
    nativeToolAccess: true, cliParity: true, permissionMode: 'bypass' } })).toBeNull();
  expect(assessNativeToolPolicy({ def: { name: 'Antigravity' }, policy: {} })).toBeNull();
});

it('never lets parity override the master lock, a restricted run, or an unknown explicit OFF', () => {
  for (const policy of [
    { nativeToolAccess: false, cliParity: true, permissionMode: 'bypass' as const },
    { nativeToolAccess: true, cliParity: true, permissionMode: 'restricted' as const },
    { nativeCapabilities: JSON.parse('{"futureSwitch":false}') },
  ]) expect(assessNativeToolPolicy({ def: { name: 'Antigravity' }, policy })).toMatch(/can't run/);
});
