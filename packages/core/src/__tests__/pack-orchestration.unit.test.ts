import { describe, expect, it, vi } from 'vitest';
import { bindings } from '../bindings.js';
import { createDaemon } from '../daemon.js';
import { definePack } from '../pack.js';
import { registerPackTools } from '../pack-lifecycle.js';
import { createToolRegistry } from '../tool-registry.js';

describe('pack orchestration belongs to the composition root', () => {
  it('does not invoke tools or mount transports when constructing a daemon', () => {
    const tools = vi.fn(() => []);
    const http = vi.fn();
    const cli = vi.fn();
    const pack = definePack({ name: 'feature', deps: [], services: () => ({ ready: true }) }, { tools, http, cli });
    expect(createDaemon({ packs: [pack], bindings: bindings({}) }).services.feature).toEqual({ ready: true });
    expect(tools).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
    expect(cli).not.toHaveBeenCalled();
  });

  it('invokes the contribution on each explicit registration call and propagates duplicate IDs', () => {
    const tools = vi.fn(() => [{
      descriptor: { id: 'feature.inspect' },
      handler: async () => 'ready',
      policy: { authorize: () => 'allow' as const },
    }]);
    const pack = definePack({ name: 'feature', deps: [], services: () => ({ ready: true }) }, { tools });
    const packs = [pack] as const;
    const daemon = createDaemon({ packs, bindings: bindings({}) });
    const registry = createToolRegistry({});
    registerPackTools({ packs, daemon, registry });
    expect(() => registerPackTools({ packs, daemon, registry }))
      .toThrowError('ToolRegistry: tool "feature.inspect" is already registered');
    expect(tools.mock.calls).toEqual([[{ services: { ready: true } }], [{ services: { ready: true } }]]);
    expect(registry.list({})).toEqual([{ id: 'feature.inspect' }]);
  });
});
