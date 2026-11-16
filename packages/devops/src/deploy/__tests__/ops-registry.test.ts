import { describe, expect, it } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import { requireDeployPlatform } from '../ops-registry.js';
import type { DeployOpsRegistry, LoadedDeployOps } from '../ops-contracts.js';
import { catchErr, fullModule, platformOf } from './ops-fixtures.js';

const loaded = (id: string): LoadedDeployOps => platformOf(fullModule(), id);
const registry = (ps: LoadedDeployOps[], extra: Partial<DeployOpsRegistry> = {}): DeployOpsRegistry => ({ get: id => ps.find(p => p.descriptor.id === id), list: () => ps, refusals: [], ...extra });

describe('requireDeployPlatform', () => {
  it('returns the platform it finds, by identity', () => {
    const a = loaded('a');
    expect(requireDeployPlatform({ registry: registry([a, loaded('b')]), id: 'a' })).toBe(a);
  });

  it('names the plugin that provides a platform which is switched off', async () => {
    const reg = registry([loaded('a')], { switchedOff: new Map([['gone', 'plug-x']]) });
    const err = await catchErr(Promise.resolve().then(() => requireDeployPlatform({ registry: reg, id: 'gone' })));
    expect(err).toBeInstanceOf(ToolInputError);
    expect(err.message).toBe("Deployment ops platform 'gone' is provided by plugin 'plug-x', which is off; turn it on first.");
  });

  it('lists the available platforms for an unknown id', () => {
    expect(() => requireDeployPlatform({ registry: registry([loaded('a'), loaded('b')]), id: 'zz' })).toThrow("Unknown deployment ops platform 'zz'. Choose: a, b.");
  });

  it('falls through to the unknown message when switchedOff does not mention the id', () => {
    const reg = registry([loaded('a')], { switchedOff: new Map([['other', 'plug-y']]) });
    expect(() => requireDeployPlatform({ registry: reg, id: 'zz' })).toThrow("Unknown deployment ops platform 'zz'. Choose: a.");
  });

  it('says (none) for an empty registry and appends loader refusals', () => {
    const reg = registry([], { refusals: ['bad.mjs: nope.', 'worse.mjs: no.'] });
    expect(() => requireDeployPlatform({ registry: reg, id: 'zz' })).toThrow("Unknown deployment ops platform 'zz'. Choose: (none). bad.mjs: nope. worse.mjs: no.");
  });
});
