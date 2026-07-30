import { describe, expect, it } from 'vitest';
import { definePack } from '@jini-ai/core';

import {
  CAPABILITY_IDS,
  defineJiniFeature,
  JINI_PROFILES,
  type CapabilityId,
  type JiniFeature,
  type JiniProfile,
} from '../feature.js';
import { resolveFeatureActivation } from '../feature-activation.js';

/**
 * The activation policy is where every security consequence of the composition lives, so it is a
 * pure function and it is tested as one — no kernel, no sqlite file, no socket. The four rules under
 * test, in the order the resolver applies them:
 *
 *  1. capabilities are a ceiling (permitted ⇔ every `provides` granted)
 *  2. an explicit enable can never beat a denied capability
 *  3. permitted is not active — `core-only` still requires the caller to name it
 *  4. `requires` is validated, not documented
 */

function feature(id: string, provides: readonly CapabilityId[], requires?: readonly string[]): JiniFeature {
  return defineJiniFeature({
    id,
    provides,
    ...(requires === undefined ? {} : { requires }),
    compose: () => ({ pack: definePack({ name: `test.${id}`, deps: [], services: () => ({}) }) }),
  });
}

const CORE_ONLY: JiniProfile = { id: 'agent-core-v1', grants: ['run:transport', 'tool:delegated'], activation: 'core-only' };
const ALL_PERMITTED: JiniProfile = {
  id: 'local-daemon-v1',
  grants: ['run:transport', 'tool:delegated', 'host:exec', 'net:egress'],
  activation: 'all-permitted',
};

const activeIds = (plan: { active: readonly { id: string }[] }) => plan.active.map((r) => r.id);

describe('rule 1 — capabilities are a ceiling', () => {
  it('a feature is permitted only when EVERY capability it provides is granted', () => {
    const plan = resolveFeatureActivation({
      features: [feature('mixed', ['run:transport', 'db:admin'])],
      profile: ALL_PERMITTED, // grants run:transport, not db:admin
    });

    expect(activeIds(plan)).toEqual([]);
    expect(plan.inactive[0]).toMatchObject({ id: 'mixed', reason: 'capability-denied', deniedCapabilities: ['db:admin'] });
  });

  it('a feature that provides NOTHING is always permitted and always default-on (e.g. health)', () => {
    for (const profile of [CORE_ONLY, ALL_PERMITTED]) {
      const plan = resolveFeatureActivation({ features: [feature('health', [])], profile });
      expect(activeIds(plan)).toEqual(['health']);
    }
  });

  it('an explicit capability grant raises the ceiling', () => {
    const plan = resolveFeatureActivation({
      features: [feature('daemonDb', ['db:admin'])],
      profile: ALL_PERMITTED,
      capabilities: { 'db:admin': true },
      featureOverrides: { daemonDb: true },
    });
    expect(activeIds(plan)).toEqual(['daemonDb']);
  });

  it('an explicit capability denial lowers it, turning off everything that needed it at once', () => {
    const plan = resolveFeatureActivation({
      features: [
        feature('modelProxy', ['net:egress']),
        feature('research', ['net:egress']),
        feature('runs', ['run:transport']),
      ],
      profile: ALL_PERMITTED,
      capabilities: { 'net:egress': false },
    });

    expect(activeIds(plan)).toEqual(['runs']);
    expect(plan.inactive.map((r) => r.id)).toEqual(['modelProxy', 'research']);
    expect(plan.deniedCapabilities).toContain('net:egress');
  });
});

describe('rule 2 — an explicit enable can never beat a denied capability', () => {
  it('throws, naming both the feature and the specific denied capability', () => {
    expect(() =>
      resolveFeatureActivation({
        features: [feature('terminal', ['host:exec'])],
        profile: ALL_PERMITTED,
        capabilities: { 'host:exec': false },
        featureOverrides: { terminal: true },
      }),
    ).toThrow(/feature "terminal" was explicitly enabled but requires denied capability \[host:exec\]/);
  });

  it('pluralizes and lists every denied capability when more than one blocks it', () => {
    expect(() =>
      resolveFeatureActivation({
        features: [feature('hostTools', ['host:read', 'host:exec'])],
        profile: CORE_ONLY,
        featureOverrides: { hostTools: true },
      }),
    ).toThrow(/requires denied capabilities \[host:read, host:exec\]/);
  });

  it('names the remedy in both directions (grant the capability, or drop the feature)', () => {
    expect(() =>
      resolveFeatureActivation({
        features: [feature('terminal', ['host:exec'])],
        profile: CORE_ONLY,
        featureOverrides: { terminal: true },
      }),
    ).toThrow(/Grant them via config\.capabilities, or remove "terminal" from config\.features/);
  });

  it('an explicit DISABLE is always honored, even for a permitted feature', () => {
    const plan = resolveFeatureActivation({
      features: [feature('terminal', ['host:exec'])],
      profile: ALL_PERMITTED,
      featureOverrides: { terminal: false },
    });
    expect(activeIds(plan)).toEqual([]);
    expect(plan.inactive[0]).toMatchObject({ id: 'terminal', reason: 'opt-out', deniedCapabilities: [] });
  });
});

describe('rule 3 — permitted is not active (capabilities are an upper bound, not a trigger)', () => {
  it('under core-only, granting a capability activates NOTHING on its own', () => {
    const plan = resolveFeatureActivation({
      features: [
        feature('modelProxy', ['net:egress']),
        feature('research', ['net:egress']),
        feature('connectors', ['net:egress']),
      ],
      profile: CORE_ONLY,
      capabilities: { 'net:egress': true },
    });

    // The ceiling rose; nothing was mounted. This is the whole point of the upper-bound semantics:
    // "this host may reach the network" must not mean "mount all four network features".
    expect(activeIds(plan)).toEqual([]);
    expect(plan.inactive.map((r) => r.reason)).toEqual(['not-default', 'not-default', 'not-default']);
    expect(plan.grantedCapabilities).toContain('net:egress');
  });

  it('under core-only, the caller must ALSO name the feature — and then it activates', () => {
    const plan = resolveFeatureActivation({
      features: [feature('modelProxy', ['net:egress']), feature('research', ['net:egress'])],
      profile: CORE_ONLY,
      capabilities: { 'net:egress': true },
      featureOverrides: { modelProxy: true },
    });

    expect(activeIds(plan)).toEqual(['modelProxy']);
    expect(plan.active[0]!.reason).toBe('opt-in');
  });

  it('under core-only, features whose capabilities are all core default ON with no caller input', () => {
    const plan = resolveFeatureActivation({
      features: [feature('runs', ['run:transport']), feature('delegated', ['tool:delegated'])],
      profile: CORE_ONLY,
    });
    expect(activeIds(plan)).toEqual(['runs', 'delegated']);
    expect(plan.active.every((r) => r.reason === 'default')).toBe(true);
  });

  it('under all-permitted, the ceiling IS the selection — every permitted feature mounts', () => {
    const plan = resolveFeatureActivation({
      features: [feature('terminal', ['host:exec']), feature('modelProxy', ['net:egress']), feature('db', ['db:admin'])],
      profile: ALL_PERMITTED,
    });
    expect(activeIds(plan)).toEqual(['terminal', 'modelProxy']);
  });
});

describe('rule 4 — requires is validated, not documented', () => {
  it('throws when an active feature requires an inactive one, naming both and the two remedies', () => {
    expect(() =>
      resolveFeatureActivation({
        features: [feature('runs', ['run:transport']), feature('delegated', ['tool:delegated'], ['runs'])],
        profile: CORE_ONLY,
        featureOverrides: { runs: false },
      }),
    ).toThrow(/feature "delegated" requires "runs", which is not active — enable "runs" or disable "delegated"/);
  });

  it('accepts a satisfied dependency', () => {
    const plan = resolveFeatureActivation({
      features: [feature('runs', ['run:transport']), feature('delegated', ['tool:delegated'], ['runs'])],
      profile: CORE_ONLY,
    });
    expect(activeIds(plan)).toEqual(['runs', 'delegated']);
  });

  it('is order-independent: a dependency declared BEFORE its dependent still validates', () => {
    const plan = resolveFeatureActivation({
      features: [feature('delegated', ['tool:delegated'], ['runs']), feature('runs', ['run:transport'])],
      profile: CORE_ONLY,
    });
    expect(activeIds(plan)).toEqual(['delegated', 'runs']);
  });

  it('throws when requires names a feature that does not exist at all', () => {
    expect(() =>
      resolveFeatureActivation({
        features: [feature('delegated', ['tool:delegated'], ['nope'])],
        profile: CORE_ONLY,
      }),
    ).toThrow(/declares requires "nope", which is not a known feature/);
  });

  it('does not validate requires for an INACTIVE feature', () => {
    const plan = resolveFeatureActivation({
      features: [feature('terminal', ['host:exec'], ['runs'])],
      profile: CORE_ONLY,
    });
    expect(activeIds(plan)).toEqual([]);
  });
});

describe('config integrity', () => {
  it('throws on an unknown feature id, listing the known ones — a silently ignored typo in a security config is the failure mode this exists to prevent', () => {
    expect(() =>
      resolveFeatureActivation({
        features: [feature('terminal', ['host:exec']), feature('runs', ['run:transport'])],
        profile: ALL_PERMITTED,
        featureOverrides: { termnal: false },
      }),
    ).toThrow(/unknown feature "termnal" in features config — known features are: runs, terminal/);
  });

  it('throws on an unknown capability id, for exactly the same reason a typo\'d feature id throws', () => {
    // The failure this closes: `{'host:exce': false}` deletes a capability nobody has, so the
    // correctly-spelled `host:exec` stays granted and `terminal` mounts — a denial that reads as
    // applied in the config and is not. A security switch that fails open on a typo is worse than
    // no switch at all.
    expect(() =>
      resolveFeatureActivation({
        features: [feature('terminal', ['host:exec'])],
        profile: ALL_PERMITTED,
        capabilities: { 'host:exce': false } as Record<string, boolean>,
      }),
    ).toThrow(/unknown capability "host:exce" in capabilities config/);
  });

  it('throws on a typo\'d capability GRANT too — a ceiling raised for nothing is equally silent', () => {
    expect(() =>
      resolveFeatureActivation({
        features: [feature('daemonDb', ['db:admin'])],
        profile: ALL_PERMITTED,
        capabilities: { 'db:admn': true } as Record<string, boolean>,
      }),
    ).toThrow(/unknown capability "db:admn" in capabilities config/);
  });

  it('accepts every capability the vocabulary actually declares', () => {
    for (const capability of CAPABILITY_IDS) {
      expect(() =>
        resolveFeatureActivation({
          features: [feature('runs', ['run:transport'])],
          profile: ALL_PERMITTED,
          capabilities: { [capability]: true },
        }),
      ).not.toThrow();
    }
  });

  it('throws on a duplicate feature id in the catalog', () => {
    expect(() =>
      resolveFeatureActivation({
        features: [feature('dup', []), feature('dup', [])],
        profile: CORE_ONLY,
      }),
    ).toThrow(/duplicate feature id "dup"/);
  });

  it('preserves catalog order in the active list, so composition order is deterministic', () => {
    const plan = resolveFeatureActivation({
      features: [feature('a', []), feature('b', []), feature('c', [])],
      profile: CORE_ONLY,
    });
    expect(activeIds(plan)).toEqual(['a', 'b', 'c']);
  });
});

describe('shipped profiles', () => {
  it('are frozen — a future capability must never silently join a pinned profile', () => {
    expect(Object.isFrozen(JINI_PROFILES)).toBe(true);
    expect(Object.isFrozen(JINI_PROFILES['local-daemon-v1'])).toBe(true);
    expect(Object.isFrozen(JINI_PROFILES['local-daemon-v1'].grants)).toBe(true);
  });

  it('neither profile grants run:inject — remote event injection is opt-in everywhere', () => {
    expect(JINI_PROFILES['agent-core-v1'].grants).not.toContain('run:inject');
    expect(JINI_PROFILES['local-daemon-v1'].grants).not.toContain('run:inject');
  });

  it('local-daemon-v1 does not grant the never-wired families\' capabilities', () => {
    for (const capability of ['memory:store', 'routines:schedule', 'media:generate', 'ui:session'] as const) {
      expect(JINI_PROFILES['local-daemon-v1'].grants).not.toContain(capability);
    }
  });

  it('agent-core-v1 grants exactly the run-transport contract', () => {
    expect([...JINI_PROFILES['agent-core-v1'].grants].sort()).toEqual(['agent:discovery', 'run:transport', 'tool:delegated']);
  });
});

describe('capability overrides', () => {
  it('ignores an explicitly-undefined override rather than treating it as a denial', () => {
    // `{ 'net:egress': undefined }` is what an optional-property spread produces when the caller
    // had nothing to say. Reading it as `false` would silently turn features off on a config the
    // host believes is empty.
    const plan = resolveFeatureActivation({
      features: [feature('modelProxy', ['net:egress'])],
      profile: ALL_PERMITTED,
      capabilities: { 'net:egress': undefined },
    });

    expect(activeIds(plan)).toEqual(['modelProxy']);
    expect(plan.grantedCapabilities).toContain('net:egress');
  });
});
