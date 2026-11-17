import { expect, it } from 'vitest';
import { LOCAL_HOST_DEFAULT_PERMISSIONS, planRun, resolveNativeToolPolicy } from '../native-tool-policy.js';
import { AGENT_DEFS } from '../registry.js';
import { antigravityAgentDef } from '../defs/antigravity/index.js';
const policy = { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass' as const,
  nativeCapabilities: { shell: true, fileWrite: true, userMcp: false, subagents: true,
    userSettings: true, web: true, workflows: true, loginEnvironment: true } };
it('does not silently grant Antigravity any capability', () => {
  expect(resolveNativeToolPolicy({ def: antigravityAgentDef, policy })).toBe(policy);
  expect(planRun({ def: antigravityAgentDef, policy })).toMatchObject({ verdict: 'ASK', keys: ['userMcp'] });
});
it('plans every registered CLI conservatively without refusing it', () => {
  for (const def of AGENT_DEFS) {
    const result = planRun({ def, policy });
    expect(['RUN', 'ASK', 'SETUP']).toContain(result.verdict);
    if (result.verdict === 'RUN') expect(result.loadsOwn).toBe(false);
  }
});
it('unknown isolation asks; stamped per-run isolation excludes personal sources', () => {
  const def = { name: 'Test', supportsNativeToolAccess: true };
  expect(planRun({ def, policy })).toMatchObject({ verdict: 'ASK', keys: ['userMcp'] });
  expect(planRun({ def: { ...def, mcpIsolation: { perRun: 'test@2026-11-05' } }, policy })).toMatchObject({ verdict: 'RUN', loadsOwn: false });
  expect(planRun({ def: { ...def, mcpIsolation: { perRun: 'test@2026-11-05' } }, policy, host: { isolationBlocked: true } })).toMatchObject({ verdict: 'ASK', why: 'isolation_blocked' });
});
it('host locks never present an owner Allow, unknown auth can proceed, and missing setup is named', () => {
  const def = { name: 'Test' };
  expect(planRun({ def, policy, host: { locked: 'hosted' } })).toMatchObject({ verdict: 'SETUP', reason: 'host_locked' });
  expect(planRun({ def, policy, host: { installed: false } })).toEqual({ verdict: 'SETUP', reason: 'not_installed' });
  expect(planRun({ def, policy, host: { auth: 'missing' } })).toEqual({ verdict: 'SETUP', reason: 'not_signed_in' });
  expect(planRun({ def, policy, host: { auth: 'unknown' } }).verdict).toBe('ASK');
});
it('collects every unsupported off switch and admits own tools only after explicit Allow', () => {
  expect(planRun({ def: { name: 'Test' }, policy: { nativeToolAccess: false, nativeCapabilities: { shell: false, fileWrite: false, userMcp: false } } })).toMatchObject({ verdict: 'ASK', keys: ['enabled', 'shell', 'fileWrite', 'userMcp'] });
  expect(planRun({ def: { name: 'Test' }, policy: { nativeToolAccess: true, nativeCapabilities: { userMcp: true } } })).toMatchObject({ verdict: 'RUN', loadsOwn: true });
});

it('keeps own-list and host-lock invariants across every definition and capability combination', () => {
  const keys = Object.keys(policy.nativeCapabilities) as (keyof typeof policy.nativeCapabilities)[];
  for (const def of AGENT_DEFS) for (let bits = 0; bits < 256; bits++) {
    const nativeCapabilities = Object.fromEntries(keys.map((key, index) => [key, Boolean(bits & (1 << index))]));
    const candidate = { ...policy, nativeCapabilities };
    const result = planRun({ def, policy: candidate });
    if (result.verdict === 'RUN' && result.loadsOwn) expect(nativeCapabilities.userMcp).toBe(true);
    if (result.verdict === 'ASK') {
      expect(planRun({ def, policy: candidate, host: { locked: 'not_owner' } }).verdict).toBe('SETUP');
      if (!def.supportsNativeToolAccess) for (const key of keys) {
        if (key !== 'userMcp' && !nativeCapabilities[key]) expect(result.keys).toContain(key);
      }
    }
  }
});

it('host-defaults.fixture.contract plans every CLI against the exported consumer defaults', () => {
  const { enabled, capabilities } = LOCAL_HOST_DEFAULT_PERMISSIONS;
  for (const def of AGENT_DEFS) {
    const result = planRun({ def, policy: { nativeToolAccess: enabled, nativeCapabilities: capabilities } });
    expect(['RUN', 'ASK', 'SETUP']).toContain(result.verdict);
    if (result.verdict === 'RUN') expect(result.loadsOwn).toBe(false);
  }
});
