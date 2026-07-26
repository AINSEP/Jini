import { describe, expect, it, vi } from 'vitest';

import {
  createFrontendSessionRegistry,
  type FrontendInvocation,
  type FrontendSessionRegistry,
} from '../frontend-session-registry.js';

/** Collects what a surface was asked to do, so a test can answer it by hand. */
function recordingSurface(): {
  deliver: (invocation: FrontendInvocation) => void;
  delivered: FrontendInvocation[];
} {
  const delivered: FrontendInvocation[] = [];
  return { deliver: (invocation) => void delivered.push(invocation), delivered };
}

/** Attaches a surface and binds `runId` to it — the ordinary "a tab started this run" setup. */
function attachAndBind(
  registry: FrontendSessionRegistry,
  sessionId: string,
  runId: string,
  capabilities: readonly string[] = ['page.click'],
): ReturnType<typeof recordingSurface> & {
  handle: ReturnType<FrontendSessionRegistry['attach']>;
  unbind: () => void;
} {
  const surface = recordingSurface();
  const handle = registry.attach({ sessionId, capabilities }, surface.deliver);
  const unbind = registry.bindRun(runId, sessionId);
  return { ...surface, handle, unbind };
}

describe('createFrontendSessionRegistry', () => {
  describe('round trip', () => {
    it('delivers an invocation to the surface bound to the run and resolves with its output', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      const pending = registry.invoke('run-1', 'page.click', { element: 'save-button' });

      expect(surface.delivered).toEqual([
        { invocationId: 'inv-1', capabilityId: 'page.click', input: { element: 'save-button' } },
      ]);

      expect(registry.settle('session-1', 'inv-1', { ok: true, output: { clicked: 'save-button' } })).toBe(true);
      await expect(pending).resolves.toEqual({ clicked: 'save-button' });
    });

    it('rejects with the surface-supplied message when the surface refuses', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1', ['page.fill']);

      const pending = registry.invoke('run-1', 'page.fill', { element: 'password', text: 'hunter2' });
      registry.settle('session-1', 'inv-1', {
        ok: false,
        message: 'refusing to fill "password": password fields are never filled by an automated caller',
      });

      await expect(pending).rejects.toThrow(/refusing to fill "password"/);
    });

    it('mints its own invocation id rather than trusting the surface', async () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      void registry.invoke('run-1', 'page.click', {}).catch(() => undefined);

      expect(surface.delivered[0]?.invocationId).toEqual(expect.any(String));
      expect(surface.delivered[0]?.invocationId).not.toBe('');
    });

    it('serves several runs from one long-lived surface', async () => {
      let next = 0;
      const registry = createFrontendSessionRegistry({ newInvocationId: () => `inv-${++next}` });
      const surface = recordingSurface();
      registry.attach({ sessionId: 'tab-1', capabilities: ['page.click'] }, surface.deliver);

      // One tab, two messages — the pane attached once and each run binds to it as it starts.
      registry.bindRun('run-1', 'tab-1');
      registry.bindRun('run-2', 'tab-1');

      const first = registry.invoke('run-1', 'page.click', {});
      const second = registry.invoke('run-2', 'page.click', {});
      registry.settle('tab-1', 'inv-1', { ok: true, output: 'a' });
      registry.settle('tab-1', 'inv-2', { ok: true, output: 'b' });

      await expect(first).resolves.toBe('a');
      await expect(second).resolves.toBe('b');
    });
  });

  describe('fails closed rather than hanging', () => {
    it('rejects when no surface is bound to the run', async () => {
      const registry = createFrontendSessionRegistry();
      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(
        'no frontend is bound to run "run-1", so "page.click" cannot be executed',
      );
    });

    it('rejects, listing what is on offer, when the bound surface lacks the capability', async () => {
      const registry = createFrontendSessionRegistry();
      attachAndBind(registry, 'session-1', 'run-1', ['page.find_elements', 'page.highlight']);

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(
        'the frontend bound to run "run-1" does not offer "page.click" '
        + '(it offers: page.find_elements, page.highlight)',
      );
    });

    it('reports "nothing" rather than an empty list for a surface claiming no capabilities', async () => {
      const registry = createFrontendSessionRegistry();
      attachAndBind(registry, 'session-1', 'run-1', []);

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(/it offers: nothing/);
    });

    it('does not route a call to a surface bound to a different run', async () => {
      const registry = createFrontendSessionRegistry();
      const other = attachAndBind(registry, 'session-1', 'run-OTHER');

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(/no frontend is bound/);
      expect(other.delivered).toEqual([]);
    });

    it('refuses to bind a run to a surface that is not attached', () => {
      const registry = createFrontendSessionRegistry();

      expect(() => registry.bindRun('run-1', 'ghost')).toThrow(
        'FrontendSessionRegistry: cannot bind run "run-1" to unattached session "ghost"',
      );
    });
  });

  describe('bindings', () => {
    it('replaces the association when a run is bound to a different surface', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      const first = attachAndBind(registry, 'session-1', 'run-1');
      const second = recordingSurface();
      registry.attach({ sessionId: 'session-2', capabilities: ['page.click'] }, second.deliver);

      registry.bindRun('run-1', 'session-2');
      void registry.invoke('run-1', 'page.click', {}).catch(() => undefined);

      expect(first.delivered).toEqual([]);
      expect(second.delivered).toHaveLength(1);
      expect(registry.sessionFor('run-1')?.sessionId).toBe('session-2');
    });

    it('releases the association when the returned unbind is called', async () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      surface.unbind();

      expect(registry.sessionFor('run-1')).toBeUndefined();
      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(/no frontend is bound/);
    });

    it('does not let a stale unbind tear down a newer binding for the same run', () => {
      const registry = createFrontendSessionRegistry();
      const first = attachAndBind(registry, 'session-1', 'run-1');
      registry.attach({ sessionId: 'session-2', capabilities: ['page.click'] }, recordingSurface().deliver);

      registry.bindRun('run-1', 'session-2');
      first.unbind();

      expect(registry.sessionFor('run-1')?.sessionId).toBe('session-2');
    });
  });

  describe('duplicate answers', () => {
    it('reports false for a second settle and leaves the first result intact', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');

      const pending = registry.invoke('run-1', 'page.click', {});
      expect(registry.settle('session-1', 'inv-1', { ok: true, output: 'first' })).toBe(true);
      expect(registry.settle('session-1', 'inv-1', { ok: true, output: 'second' })).toBe(false);
      expect(registry.settle('session-1', 'inv-1', { ok: false, message: 'late failure' })).toBe(false);

      await expect(pending).resolves.toBe('first');
    });

    it('reports false for an unknown session or an unknown invocation', () => {
      const registry = createFrontendSessionRegistry();
      attachAndBind(registry, 'session-1', 'run-1');

      expect(registry.settle('session-NOPE', 'inv-1', { ok: true, output: 1 })).toBe(false);
      expect(registry.settle('session-1', 'inv-NOPE', { ok: true, output: 1 })).toBe(false);
    });

    it('reports false when another session tries to answer an invocation it does not own', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');
      registry.attach({ sessionId: 'session-2', capabilities: ['page.click'] }, recordingSurface().deliver);

      const pending = registry.invoke('run-1', 'page.click', {});
      expect(registry.settle('session-2', 'inv-1', { ok: true, output: 'stolen' })).toBe(false);

      registry.settle('session-1', 'inv-1', { ok: true, output: 'rightful' });
      await expect(pending).resolves.toBe('rightful');
    });
  });

  describe('a surface that goes away', () => {
    it('rejects everything still awaiting a detached surface instead of leaving it pending', async () => {
      let next = 0;
      const registry = createFrontendSessionRegistry({ newInvocationId: () => `inv-${++next}` });
      const surface = attachAndBind(registry, 'session-1', 'run-1', ['page.click', 'page.fill']);

      const first = registry.invoke('run-1', 'page.click', {});
      const second = registry.invoke('run-1', 'page.fill', { element: 'note', text: 'x' });
      expect(surface.delivered).toHaveLength(2);

      surface.handle.detach();

      await expect(first).rejects.toThrow('frontend session "session-1" detached before answering');
      await expect(second).rejects.toThrow('frontend session "session-1" detached before answering');
    });

    it('drops the runs bound to a detached surface, so a later call fails closed', async () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachAndBind(registry, 'session-1', 'run-1');
      registry.bindRun('run-2', 'session-1');

      surface.handle.detach();

      expect(registry.sessionFor('run-1')).toBeUndefined();
      expect(registry.sessionFor('run-2')).toBeUndefined();
      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(/no frontend is bound/);
    });

    it('leaves another surface\'s bindings alone when one detaches', () => {
      const registry = createFrontendSessionRegistry();
      const first = attachAndBind(registry, 'session-1', 'run-1');
      attachAndBind(registry, 'session-2', 'run-2');

      first.handle.detach();

      expect(registry.sessionFor('run-1')).toBeUndefined();
      expect(registry.sessionFor('run-2')?.sessionId).toBe('session-2');
    });

    it('refuses to attach a session id that is already attached', () => {
      const registry = createFrontendSessionRegistry();
      attachAndBind(registry, 'session-1', 'run-1');

      expect(() => registry.attach({ sessionId: 'session-1', capabilities: [] }, vi.fn())).toThrow(
        'FrontendSessionRegistry: session "session-1" is already attached',
      );
    });

    it('rejects when delivery itself throws, rather than waiting for a timeout', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      registry.attach({ sessionId: 'session-1', capabilities: ['page.click'] }, () => {
        throw new Error('stream already closed');
      });
      registry.bindRun('run-1', 'session-1');

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow('stream already closed');
      // The failed invocation left nothing behind for a later answer to settle.
      expect(registry.settle('session-1', 'inv-1', { ok: true, output: 'late' })).toBe(false);
    });

    it('normalizes a non-Error delivery failure', async () => {
      const registry = createFrontendSessionRegistry();
      registry.attach({ sessionId: 'session-1', capabilities: ['page.click'] }, () => {
        throw 'socket gone';
      });
      registry.bindRun('run-1', 'session-1');

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow('socket gone');
    });
  });

  describe('cancellation', () => {
    it('rejects immediately when the caller signal is already aborted', async () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      await expect(
        registry.invoke('run-1', 'page.click', {}, AbortSignal.abort()),
      ).rejects.toThrow('"page.click" was cancelled before the frontend answered');
      expect(surface.delivered).toEqual([]);
    });

    it('rejects when the caller signal aborts while the surface is still thinking', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');
      const controller = new AbortController();

      const pending = registry.invoke('run-1', 'page.click', {}, controller.signal);
      controller.abort();

      await expect(pending).rejects.toThrow('"page.click" was cancelled before the frontend answered');
      // A late answer from the surface finds nothing to settle.
      expect(registry.settle('session-1', 'inv-1', { ok: true, output: 'too late' })).toBe(false);
    });

    it('removes its abort listener once the invocation settles normally', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

      const pending = registry.invoke('run-1', 'page.click', {}, controller.signal);
      registry.settle('session-1', 'inv-1', { ok: true, output: 'done' });
      await expect(pending).resolves.toBe('done');

      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('works without a signal at all', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');

      const pending = registry.invoke('run-1', 'page.click', {});
      registry.settle('session-1', 'inv-1', { ok: true, output: 'done' });

      await expect(pending).resolves.toBe('done');
    });
  });

  describe('availability reporting', () => {
    it('reports the bound surface\'s capabilities so a caller advertises only what can be served', () => {
      const registry = createFrontendSessionRegistry();
      attachAndBind(registry, 'session-1', 'run-1', ['page.click', 'page.fill']);

      expect(registry.capabilitiesFor('run-1')).toEqual(['page.click', 'page.fill']);
      expect(registry.sessionFor('run-1')).toEqual({
        sessionId: 'session-1',
        capabilities: ['page.click', 'page.fill'],
      });
    });

    it('reports nothing for an unbound run, so availability fails closed', () => {
      const registry = createFrontendSessionRegistry();
      attachAndBind(registry, 'session-1', 'run-1');

      expect(registry.capabilitiesFor('run-2')).toEqual([]);
      expect(registry.sessionFor('run-2')).toBeUndefined();
    });

    it('drops a detached surface from availability', () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      expect(registry.capabilitiesFor('run-1')).toEqual(['page.click']);
      surface.handle.detach();
      expect(registry.capabilitiesFor('run-1')).toEqual([]);
    });
  });
});
