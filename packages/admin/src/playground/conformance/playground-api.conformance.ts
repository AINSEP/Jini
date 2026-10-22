import type { PlaygroundRenderTargetPort } from '../../contracts/playground-render-target.js';
/** Run with an isolated bus; this temporarily registers and releases test targets. */
export function runPlaygroundApiConformance({ targets }: { targets: PlaygroundRenderTargetPort }, _optional = {}): readonly string[] {
  const checks: string[] = []; const assert = (ok: boolean, name: string) => { if (!ok) throw new Error(`Playground conformance: ${name}`); checks.push(name); };
  const a = {}, b = {}; let count = 0; const stop = targets.subscribe({ listener: () => count++ });
  const first = targets.register({ target: a }); let second: ReturnType<PlaygroundRenderTargetPort['register']> | undefined;
  try {
    assert(targets.getSnapshot().target === a, 'published target is readable'); const snapshot = targets.getSnapshot();
    assert(snapshot === targets.getSnapshot(), 'snapshot identity is cached'); const same = targets.register({ target: a });
    assert(count === 1, 'unchanged node does not notify'); first.release({}); assert(targets.getSnapshot().target === a, 'stale publisher cannot clear current target');
    second = targets.register({ target: b }); assert(snapshot.target === a, 'prior snapshots do not mutate'); same.release({});
    assert(targets.getSnapshot().target === b, 'release cannot clear a newer node'); second.release({});
    assert(targets.getSnapshot().target === null && count === 3, 'detach publishes inline fallback'); stop();
    const last = targets.register({ target: a }); last.release({}); assert(count === 3, 'unsubscribe stops notifications'); return Object.freeze(checks);
  } finally { first.release({}); second?.release({}); stop(); }
}
