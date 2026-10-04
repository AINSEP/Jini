import type { PlaygroundRenderTargetPort, PlaygroundTargetSnapshot } from '../../contracts/playground-render-target.js';
/** Instance-local browser bus as well as a headless fake; no global module singleton. */
export function createMemoryPlaygroundTargets(_required: Record<string, never>, { onListenerError }: { onListenerError?: (required: { error: unknown }, optional?: Record<string, never>) => void } = {}): PlaygroundRenderTargetPort & { dispose(required?: Record<string, never>, optional?: Record<string, never>): void } {
  let snapshot: PlaygroundTargetSnapshot = Object.freeze({ target: null }), owner: object | null = null, disposed = false;
  const listeners = new Set<() => void>();
  function publish(target: object | null) {
    // No-op on unchanged value: ref replay cannot produce a notification storm.
    if (snapshot.target === target) return; snapshot = Object.freeze({ target });
    for (const listener of [...listeners]) { try { listener(); } catch (error) { onListenerError?.({ error }); } }
  }
  return {
    getSnapshot: (_required = {}, _optional = {}) => snapshot,
    subscribe({ listener }, _optional = {}) { if (!disposed) listeners.add(listener); return () => listeners.delete(listener); },
    register({ target }, _optional = {}) { if (disposed) throw new Error('Playground target scope disposed'); const ticket = {}; owner = ticket; publish(target); return { release(_required = {}, _optional = {}) { if (owner !== ticket) return; owner = null; publish(null); } }; },
    dispose(_required = {}, _optional = {}) { if (disposed) return; disposed = true; owner = null; publish(null); listeners.clear(); },
  };
}
