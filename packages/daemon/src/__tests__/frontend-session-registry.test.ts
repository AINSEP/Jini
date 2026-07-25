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

function attachPageSurface(
  registry: FrontendSessionRegistry,
  sessionId: string,
  runId: string,
  capabilities: readonly string[] = ['page.click'],
): ReturnType<typeof recordingSurface> & { handle: ReturnType<FrontendSessionRegistry['attach']> } {
  const surface = recordingSurface();
  const handle = registry.attach({ sessionId, runId, capabilities }, surface.deliver);
  return { ...surface, handle };
}

describe('createFrontendSessionRegistry', () => {
  describe('round trip', () => {
    it('delivers an invocation to the surface claiming the capability and resolves with its output', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      const surface = attachPageSurface(registry, 'session-1', 'run-1');

      const pending = registry.invoke('run-1', 'page.click', { element: 'save-button' });

      expect(surface.delivered).toEqual([
        { invocationId: 'inv-1', capabilityId: 'page.click', input: { element: 'save-button' } },
      ]);

      expect(registry.settle('session-1', 'inv-1', { ok: true, output: { clicked: 'save-button' } })).toBe(true);
      await expect(pending).resolves.toEqual({ clicked: 'save-button' });
    });

    it('rejects with the surface-supplied message when the surface refuses', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachPageSurface(registry, 'session-1', 'run-1', ['page.fill']);

      const pending = registry.invoke('run-1', 'page.fill', { element: 'password', text: 'hunter2' });
      registry.settle('session-1', 'inv-1', {
        ok: false,
        message: 'refusing to fill "password": password fields are never filled by an automated caller',
      });

      await expect(pending).rejects.toThrow(/refusing to fill "password"/);
    });

    it('mints its own invocation id rather than trusting the surface', async () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachPageSurface(registry, 'session-1', 'run-1');

      void registry.invoke('run-1', 'page.click', {}).catch(() => undefined);

      expect(surface.delivered[0]?.invocationId).toEqual(expect.any(String));
      expect(surface.delivered[0]?.invocationId).not.toBe('');
    });
  });

  describe('fails closed rather than hanging', () => {
    it('rejects when no surface is attached for the run at all', async () => {
      const registry = createFrontendSessionRegistry();
      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(
        'no attached frontend for run "run-1" can execute "page.click"',
      );
    });

    it('rejects when a surface is attached but does not claim the capability', async () => {
      const registry = createFrontendSessionRegistry();
      attachPageSurface(registry, 'session-1', 'run-1', ['page.find_elements']);

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(
        'no attached frontend for run "run-1" can execute "page.click"',
      );
    });

    it('does not route a call to a surface attached to a different run', async () => {
      const registry = createFrontendSessionRegistry();
      const other = attachPageSurface(registry, 'session-1', 'run-OTHER');

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(/no attached frontend/);
      expect(other.delivered).toEqual([]);
    });
  });

  describe('ambiguity is an error, never last-writer-wins', () => {
    it('refuses to guess when two attached surfaces both claim the capability', async () => {
      const registry = createFrontendSessionRegistry();
      const first = attachPageSurface(registry, 'session-1', 'run-1');
      const second = attachPageSurface(registry, 'session-2', 'run-1');

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(
        /"page\.click" is claimed by 2 attached frontends for run "run-1" \(session-1, session-2\)/,
      );
      // The point of refusing: neither tab was acted on.
      expect(first.delivered).toEqual([]);
      expect(second.delivered).toEqual([]);
    });

    it('routes again once the ambiguity is resolved by detaching one', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      const first = attachPageSurface(registry, 'session-1', 'run-1');
      const second = attachPageSurface(registry, 'session-2', 'run-1');

      second.handle.detach();
      const pending = registry.invoke('run-1', 'page.click', {});
      registry.settle('session-1', 'inv-1', { ok: true, output: 'ok' });

      await expect(pending).resolves.toBe('ok');
      expect(first.delivered).toHaveLength(1);
    });

    it('allows two surfaces on one run when they claim disjoint capabilities', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      const clicker = attachPageSurface(registry, 'session-1', 'run-1', ['page.click']);
      const filler = attachPageSurface(registry, 'session-2', 'run-1', ['page.fill']);

      void registry.invoke('run-1', 'page.fill', { element: 'note', text: 'hi' }).catch(() => undefined);

      expect(clicker.delivered).toEqual([]);
      expect(filler.delivered).toHaveLength(1);
    });
  });

  describe('duplicate answers', () => {
    it('reports false for a second settle of the same invocation and leaves the first result intact', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachPageSurface(registry, 'session-1', 'run-1');

      const pending = registry.invoke('run-1', 'page.click', {});
      expect(registry.settle('session-1', 'inv-1', { ok: true, output: 'first' })).toBe(true);
      expect(registry.settle('session-1', 'inv-1', { ok: true, output: 'second' })).toBe(false);
      expect(registry.settle('session-1', 'inv-1', { ok: false, message: 'late failure' })).toBe(false);

      await expect(pending).resolves.toBe('first');
    });

    it('reports false for an unknown session or an unknown invocation', () => {
      const registry = createFrontendSessionRegistry();
      attachPageSurface(registry, 'session-1', 'run-1');

      expect(registry.settle('session-NOPE', 'inv-1', { ok: true, output: 1 })).toBe(false);
      expect(registry.settle('session-1', 'inv-NOPE', { ok: true, output: 1 })).toBe(false);
    });

    it('reports false when another session tries to answer an invocation it does not own', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachPageSurface(registry, 'session-1', 'run-1');
      attachPageSurface(registry, 'session-2', 'run-2');

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
      const surface = attachPageSurface(registry, 'session-1', 'run-1', ['page.click', 'page.fill']);

      const first = registry.invoke('run-1', 'page.click', {});
      const second = registry.invoke('run-1', 'page.fill', { element: 'note', text: 'x' });
      expect(surface.delivered).toHaveLength(2);

      surface.handle.detach();

      await expect(first).rejects.toThrow('frontend session "session-1" detached before answering');
      await expect(second).rejects.toThrow('frontend session "session-1" detached before answering');
    });

    it('stops routing to a detached surface', async () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachPageSurface(registry, 'session-1', 'run-1');
      surface.handle.detach();

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow(/no attached frontend/);
    });

    it('refuses to attach a session id that is already attached', () => {
      const registry = createFrontendSessionRegistry();
      attachPageSurface(registry, 'session-1', 'run-1');

      expect(() => attachPageSurface(registry, 'session-1', 'run-2')).toThrow(
        'FrontendSessionRegistry: session "session-1" is already attached',
      );
    });

    it('rejects when delivery itself throws, rather than waiting for a timeout', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      registry.attach({ sessionId: 'session-1', runId: 'run-1', capabilities: ['page.click'] }, () => {
        throw new Error('stream already closed');
      });

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow('stream already closed');
      // The failed invocation left nothing behind for a later answer to settle.
      expect(registry.settle('session-1', 'inv-1', { ok: true, output: 'late' })).toBe(false);
    });

    it('normalizes a non-Error delivery failure', async () => {
      const registry = createFrontendSessionRegistry();
      registry.attach({ sessionId: 'session-1', runId: 'run-1', capabilities: ['page.click'] }, () => {
        throw 'socket gone';
      });

      await expect(registry.invoke('run-1', 'page.click', {})).rejects.toThrow('socket gone');
    });
  });

  describe('cancellation', () => {
    it('rejects immediately when the caller signal is already aborted', async () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachPageSurface(registry, 'session-1', 'run-1');

      await expect(
        registry.invoke('run-1', 'page.click', {}, AbortSignal.abort()),
      ).rejects.toThrow('"page.click" was cancelled before the frontend answered');
      expect(surface.delivered).toEqual([]);
    });

    it('rejects when the caller signal aborts while the surface is still thinking', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachPageSurface(registry, 'session-1', 'run-1');
      const controller = new AbortController();

      const pending = registry.invoke('run-1', 'page.click', {}, controller.signal);
      controller.abort();

      await expect(pending).rejects.toThrow('"page.click" was cancelled before the frontend answered');
      // A late answer from the surface finds nothing to settle.
      expect(registry.settle('session-1', 'inv-1', { ok: true, output: 'too late' })).toBe(false);
    });

    it('removes its abort listener once the invocation settles normally', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachPageSurface(registry, 'session-1', 'run-1');
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

      const pending = registry.invoke('run-1', 'page.click', {}, controller.signal);
      registry.settle('session-1', 'inv-1', { ok: true, output: 'done' });
      await expect(pending).resolves.toBe('done');

      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('works without a signal at all', async () => {
      const registry = createFrontendSessionRegistry({ newInvocationId: () => 'inv-1' });
      attachPageSurface(registry, 'session-1', 'run-1');

      const pending = registry.invoke('run-1', 'page.click', {});
      registry.settle('session-1', 'inv-1', { ok: true, output: 'done' });

      await expect(pending).resolves.toBe('done');
    });
  });

  describe('availability reporting', () => {
    it('reports the union of capabilities across attached surfaces, deduplicated', () => {
      const registry = createFrontendSessionRegistry();
      attachPageSurface(registry, 'session-1', 'run-1', ['page.click', 'page.fill']);
      attachPageSurface(registry, 'session-2', 'run-1', ['page.fill', 'page.navigate']);

      expect([...registry.capabilitiesFor('run-1')].sort()).toEqual([
        'page.click',
        'page.fill',
        'page.navigate',
      ]);
    });

    it('reports nothing for a run with no attached surface, so availability fails closed', () => {
      const registry = createFrontendSessionRegistry();
      attachPageSurface(registry, 'session-1', 'run-1');

      expect(registry.capabilitiesFor('run-2')).toEqual([]);
      expect(registry.sessionsFor('run-2')).toEqual([]);
    });

    it('lists attached descriptors for a run in attach order', () => {
      const registry = createFrontendSessionRegistry();
      attachPageSurface(registry, 'session-1', 'run-1', ['page.click']);
      attachPageSurface(registry, 'session-2', 'run-1', ['page.fill']);
      attachPageSurface(registry, 'session-3', 'run-OTHER', ['page.click']);

      expect(registry.sessionsFor('run-1')).toEqual([
        { sessionId: 'session-1', runId: 'run-1', capabilities: ['page.click'] },
        { sessionId: 'session-2', runId: 'run-1', capabilities: ['page.fill'] },
      ]);
    });

    it('drops a detached surface from availability', () => {
      const registry = createFrontendSessionRegistry();
      const surface = attachPageSurface(registry, 'session-1', 'run-1');

      expect(registry.capabilitiesFor('run-1')).toEqual(['page.click']);
      surface.handle.detach();
      expect(registry.capabilitiesFor('run-1')).toEqual([]);
    });
  });
});
