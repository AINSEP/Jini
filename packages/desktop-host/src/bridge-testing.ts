/**
 * Ported from OD `packages/host/src/testing.ts`, retargeted at the
 * de-branded bridge in `bridge.ts`.
 */
import { JINI_HOST_CLIENT_TYPES, JINI_HOST_GLOBAL, JINI_HOST_VERSION, type JiniHostBridge, type JiniHostGlobalScope } from './bridge.js';

export type MockJiniHost = Partial<Omit<JiniHostBridge, 'client' | 'shell'>> & {
  client?: Partial<JiniHostBridge['client']>;
  shell?: Partial<JiniHostBridge['shell']>;
};

export interface MockJiniHostOptions {
  host?: MockJiniHost;
  scope?: JiniHostGlobalScope;
}

function defaultHost(): JiniHostBridge {
  return {
    version: JINI_HOST_VERSION,
    client: { type: JINI_HOST_CLIENT_TYPES.ELECTRON, platform: 'test' },
    shell: {
      openExternal: async () => ({ ok: true }),
      openPath: async () => ({ ok: true }),
    },
  };
}

export function createMockJiniHost(_requiredArgs: Record<string, never>, overrides: MockJiniHost = {}): JiniHostBridge {
  const base = defaultHost();
  return {
    ...base,
    ...overrides,
    client: { ...base.client, ...overrides.client },
    shell: { ...base.shell, ...overrides.shell },
  };
}

export function installMockJiniHost(_requiredArgs: Record<string, never>, options: MockJiniHostOptions = {}): () => void {
  const scope = (options.scope ?? globalThis) as JiniHostGlobalScope;
  const host = createMockJiniHost({}, options.host);
  const windowValue = scope.window;
  const targets = [
    scope,
    ...(typeof windowValue === 'object' && windowValue != null && windowValue !== scope ? [windowValue as JiniHostGlobalScope] : []),
  ];
  const previous = targets.map((target) => ({
    had: Object.prototype.hasOwnProperty.call(target, JINI_HOST_GLOBAL),
    target,
    value: target[JINI_HOST_GLOBAL],
  }));

  for (const target of targets) {
    Object.defineProperty(target, JINI_HOST_GLOBAL, { configurable: true, value: host, writable: true });
  }

  return () => {
    for (const entry of previous) {
      if (entry.had) {
        Object.defineProperty(entry.target, JINI_HOST_GLOBAL, { configurable: true, value: entry.value, writable: true });
      } else {
        delete entry.target[JINI_HOST_GLOBAL];
      }
    }
  };
}
