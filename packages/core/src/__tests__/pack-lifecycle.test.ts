import { describe, expect, it, vi } from 'vitest';
import { createDaemon } from '../daemon.js';
import { definePack } from '../pack.js';
import { disposePacks, registerPackTools } from '../pack-lifecycle.js';
import { bindings } from '../bindings.js';
import { createToolRegistry, type ToolRegistration } from '../tool-registry.js';

/**
 * `Pack.tools`/`Pack.dispose` (2026-07-29) are the primitive-level close of the Route-vs-Tool Gap:
 * a pack's tools and its routes are one contribution, so "this feature is not composed" is the only
 * state that exists — there is no separate mounting step a composition root can gate independently.
 * These tests pin that atomicity at the `@jini-ai/core` layer, where every consumer (including
 * third-party packs `@jini-ai/server` knows nothing about) inherits it.
 */

function makeTool(id: string): ToolRegistration {
  return {
    descriptor: { id },
    handler: async () => `${id}-ran`,
    policy: { authorize: () => 'allow' },
  };
}

const composeUnsafe = createDaemon as (config: any) => ReturnType<typeof createDaemon>;

describe('registerPackTools', () => {
  it('registers every composed pack\'s tools into the one shared registry, in pack order', () => {
    const alpha = definePack({
      name: 'alpha',
      deps: [],
      services: () => ({ prefix: 'a' }),
      tools: (services) => [makeTool(`${services.prefix}.one`), makeTool(`${services.prefix}.two`)],
    });
    const beta = definePack({
      name: 'beta',
      deps: [],
      services: () => ({ prefix: 'b' }),
      tools: (services) => [makeTool(`${services.prefix}.one`)],
    });

    const packs = [alpha, beta] as const;
    const daemon = composeUnsafe({ packs, bindings: bindings() });
    const registry = createToolRegistry();

    const registered = registerPackTools(registry, packs, daemon as never);

    expect(registered.map((r) => r.descriptor.id)).toEqual(['a.one', 'a.two', 'b.one']);
    expect(registry.list().map((d) => d.id)).toEqual(['a.one', 'a.two', 'b.one']);
  });

  it('passes each pack its OWN services, never another pack\'s', () => {
    const seen: string[] = [];
    const alpha = definePack({
      name: 'alpha',
      deps: [],
      services: () => ({ marker: 'alpha-services' }),
      tools: (services) => {
        seen.push(services.marker);
        return [];
      },
    });
    const beta = definePack({
      name: 'beta',
      deps: [],
      services: () => ({ marker: 'beta-services' }),
      tools: (services) => {
        seen.push(services.marker);
        return [];
      },
    });

    const packs = [alpha, beta] as const;
    registerPackTools(createToolRegistry(), packs, composeUnsafe({ packs, bindings: bindings() }) as never);

    expect(seen).toEqual(['alpha-services', 'beta-services']);
  });

  it('skips packs with no tools contribution', () => {
    const httpOnly = definePack({ name: 'httpOnly', deps: [], services: () => ({}), http: () => undefined });
    const packs = [httpOnly] as const;

    const registered = registerPackTools(
      createToolRegistry(),
      packs,
      composeUnsafe({ packs, bindings: bindings() }) as never,
    );

    expect(registered).toEqual([]);
  });

  it('propagates a duplicate descriptor id, naming the pack that registered second', () => {
    const first = definePack({ name: 'first', deps: [], services: () => ({}), tools: () => [makeTool('same.id')] });
    const second = definePack({ name: 'second', deps: [], services: () => ({}), tools: () => [makeTool('same.id')] });
    const packs = [first, second] as const;

    expect(() =>
      registerPackTools(createToolRegistry(), packs, composeUnsafe({ packs, bindings: bindings() }) as never),
    ).toThrow(/"same\.id" is already registered/);
  });

  it('an uncomposed pack contributes NOTHING — the Route-vs-Tool Gap made unrepresentable', () => {
    // The whole point: `terminal` is not in `packs`, so its tool is not in the registry. There is
    // no second, independently-gated registration step that could have left it reachable.
    const terminal = definePack({
      name: 'terminal',
      deps: [],
      services: () => ({}),
      tools: () => [makeTool('jini.terminal.create')],
      http: () => undefined,
    });
    const runs = definePack({ name: 'runs', deps: [], services: () => ({}), http: () => undefined });

    const packs = [runs] as const;
    const registry = createToolRegistry();
    registerPackTools(registry, packs, composeUnsafe({ packs, bindings: bindings() }) as never);

    expect(registry.has('jini.terminal.create')).toBe(false);
    expect(terminal.tools).toBeDefined(); // the contribution exists; it was simply never composed
  });
});

describe('disposePacks', () => {
  it('disposes in REVERSE composition order', async () => {
    const order: string[] = [];
    const alpha = definePack({
      name: 'alpha',
      deps: [],
      services: () => ({}),
      dispose: () => {
        order.push('alpha');
      },
    });
    const beta = definePack({
      name: 'beta',
      deps: [],
      services: () => ({}),
      dispose: () => {
        order.push('beta');
      },
    });

    const packs = [alpha, beta] as const;
    const failures = await disposePacks(packs, composeUnsafe({ packs, bindings: bindings() }) as never);

    expect(order).toEqual(['beta', 'alpha']);
    expect(failures).toEqual([]);
  });

  it('awaits an async dispose before resolving', async () => {
    let settled = false;
    const slow = definePack({
      name: 'slow',
      deps: [],
      services: () => ({}),
      dispose: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        settled = true;
      },
    });

    const packs = [slow] as const;
    await disposePacks(packs, composeUnsafe({ packs, bindings: bindings() }) as never);

    expect(settled).toBe(true);
  });

  it('one pack throwing never prevents another from disposing, and the failure is reported with its pack name', async () => {
    const disposed: string[] = [];
    const good = definePack({
      name: 'good',
      deps: [],
      services: () => ({}),
      dispose: () => {
        disposed.push('good');
      },
    });
    const bad = definePack({
      name: 'bad',
      deps: [],
      services: () => ({}),
      dispose: () => {
        throw new Error('teardown blew up');
      },
    });

    // `bad` is composed last, so it disposes FIRST — proving `good` still runs after a failure.
    const packs = [good, bad] as const;
    const failures = await disposePacks(packs, composeUnsafe({ packs, bindings: bindings() }) as never);

    expect(disposed).toEqual(['good']);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.pack).toBe('bad');
    expect((failures[0]!.error as Error).message).toBe('teardown blew up');
  });

  it('passes each pack its own services and skips packs with no dispose', async () => {
    const disposeSpy = vi.fn();
    const withDispose = definePack({
      name: 'withDispose',
      deps: [],
      services: () => ({ handle: 'real-handle' }),
      dispose: disposeSpy,
    });
    const withoutDispose = definePack({ name: 'withoutDispose', deps: [], services: () => ({}) });

    const packs = [withDispose, withoutDispose] as const;
    await disposePacks(packs, composeUnsafe({ packs, bindings: bindings() }) as never);

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledWith({ handle: 'real-handle' });
  });
});
