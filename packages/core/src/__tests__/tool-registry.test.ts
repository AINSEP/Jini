import { assert, describe, expect, it } from 'vitest';

import * as publicBarrel from '../index.js';
import { authorizeToolInvocation } from '../internal.js';
import type { Principal } from '../principal.js';
import {
  createToolRegistry,
  type ToolAuthorizationContext,
  type ToolRegistration,
  type ToolRegistry,
} from '../tool-registry.js';

const principal: Principal = { id: 'user-1' };
const run = { id: 'run-1' };

function makeRegistration(id: string, decision: 'allow' | 'deny' = 'allow'): ToolRegistration {
  return {
    descriptor: { id },
    handler: async () => 'ok',
    policy: { authorize: () => decision },
  };
}

describe('@jini-ai/core — tool-registry', () => {
  it('starts empty', () => {
    const registry = createToolRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.has('missing')).toBe(false);
  });

  it('registers a tool, exposing only its descriptor via has/list', () => {
    const registry = createToolRegistry();
    const registration = makeRegistration('echo');
    registry.register(registration);

    expect(registry.has('echo')).toBe(true);
    expect(registry.list()).toEqual([{ id: 'echo' }]);
    for (const descriptor of registry.list()) {
      expect(descriptor).not.toHaveProperty('handler');
      expect(descriptor).not.toHaveProperty('policy');
    }
  });

  it('lists descriptors in registration order', () => {
    const registry = createToolRegistry();
    registry.register(makeRegistration('a'));
    registry.register(makeRegistration('b'));
    registry.register(makeRegistration('c'));
    expect(registry.list().map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects a duplicate tool id', () => {
    const registry = createToolRegistry();
    registry.register(makeRegistration('echo'));
    expect(() => registry.register(makeRegistration('echo'))).toThrow(/already registered/);
  });

  it('authorizeToolInvocation resolves the descriptor and handler for an allowed call', async () => {
    const registry = createToolRegistry();
    registry.register(makeRegistration('echo', 'allow'));

    const resolved = await authorizeToolInvocation(registry, 'echo', principal, run, {});
    assert(resolved?.decision === 'allow');
    expect(resolved.descriptor).toEqual({ id: 'echo' });
    expect(resolved.handler).toBeTypeOf('function');
  });

  it('authorizeToolInvocation resolves the descriptor but withholds the handler for a denied call', async () => {
    const registry = createToolRegistry();
    registry.register(makeRegistration('echo', 'deny'));

    const resolved = await authorizeToolInvocation(registry, 'echo', principal, run, {});
    expect(resolved?.decision).toBe('deny');
    expect(resolved?.descriptor).toEqual({ id: 'echo' });
    expect(resolved).not.toHaveProperty('handler');
  });

  it('maps its positional arguments onto the policy and delegate authorization context', async () => {
    // `Principal` and `RunRef` are mutually assignable structural `{id}` shapes, so transposing
    // those two positional arguments typechecks silently — only an assertion on the received
    // context catches it.
    const registry = createToolRegistry();
    const seen: ToolAuthorizationContext[] = [];
    registry.register({
      descriptor: { id: 'echo', description: 'echoes' },
      handler: async () => 'ok',
      policy: {
        authorize: (ctx) => {
          seen.push(ctx);
          return 'allow';
        },
      },
    });

    const caller: Principal = { id: 'user-7', roles: ['editor'] };
    await authorizeToolInvocation(registry, 'echo', caller, { id: 'run-9' }, { path: 'a.txt' }, {
      onAuthorize: (ctx) => {
        seen.push(ctx);
        return 'allow';
      },
    });

    expect(seen).toHaveLength(2);
    for (const ctx of seen) {
      expect(ctx.principal).toEqual({ id: 'user-7', roles: ['editor'] });
      expect(ctx.run).toEqual({ id: 'run-9' });
      expect(ctx.tool).toEqual({ id: 'echo', description: 'echoes' });
      expect(ctx.input).toEqual({ path: 'a.txt' });
    }
  });

  it('an allowing policy can still be vetoed by a delegate onAuthorize', async () => {
    const registry = createToolRegistry();
    registry.register(makeRegistration('echo', 'allow'));

    const resolved = await authorizeToolInvocation(registry, 'echo', principal, run, {}, { onAuthorize: () => 'deny' });
    expect(resolved?.decision).toBe('deny');
    expect(resolved).not.toHaveProperty('handler');
  });

  it('a delegate onAuthorize is never consulted when the policy itself denies', async () => {
    const registry = createToolRegistry();
    registry.register(makeRegistration('echo', 'deny'));
    let consulted = false;

    await authorizeToolInvocation(registry, 'echo', principal, run, {}, {
      onAuthorize: () => {
        consulted = true;
        return 'allow';
      },
    });
    expect(consulted).toBe(false);
  });

  it('authorizeToolInvocation returns undefined for an unregistered tool id', async () => {
    const registry = createToolRegistry();
    expect(await authorizeToolInvocation(registry, 'missing', principal, run, {})).toBeUndefined();
  });

  it('authorizeToolInvocation finds nothing for a registry instance it never tracked', async () => {
    const fakeRegistry = { register() {}, has: () => false, list: () => [] } as ToolRegistry;
    expect(await authorizeToolInvocation(fakeRegistry, 'anything', principal, run, {})).toBeUndefined();
  });

  it('does not export authorizeToolInvocation from the public barrel', () => {
    expect('authorizeToolInvocation' in publicBarrel).toBe(false);
  });

  it('keeps two registries independent', async () => {
    const a = createToolRegistry();
    const b = createToolRegistry();
    a.register(makeRegistration('only-in-a'));
    expect(a.has('only-in-a')).toBe(true);
    expect(b.has('only-in-a')).toBe(false);
    expect(await authorizeToolInvocation(b, 'only-in-a', principal, run, {})).toBeUndefined();
  });
});
