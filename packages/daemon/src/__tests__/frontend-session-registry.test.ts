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
  const handle = registry.attach({ descriptor: { sessionId, capabilities }, deliver: surface.deliver });
  const unbind = registry.bindRun({ runId: runId, sessionId: sessionId });
  return { ...surface, handle, unbind };
}

describe('createFrontendSessionRegistry', () => {
  describe('round trip', () => {
    it('delivers an invocation to the surface bound to the run and resolves with its output', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: { element: 'save-button' } });

      expect(surface.delivered).toEqual([
        { invocationId: 'inv-1', capabilityId: 'page.click', input: { element: 'save-button' } },
      ]);

      expect(registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: { clicked: 'save-button' } } })).toBe(true);
      await expect(pending).resolves.toEqual({ clicked: 'save-button' });
    });

    it('rejects with the surface-supplied message when the surface refuses', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1', ['page.fill']);

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.fill', input: { element: 'password', text: 'hunter2' } });
      registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: {
        ok: false,
        message: 'refusing to fill "password": password fields are never filled by an automated caller',
      } });

      await expect(pending).rejects.toThrow(/refusing to fill "password"/);
    });

    it('mints a bind token distinct from the session id', () => {
      const registry = createFrontendSessionRegistry({});

      const handle = registry.attach({ descriptor: { sessionId: 'session-1', capabilities: [] }, deliver: () => undefined });

      expect(handle.bindToken).toEqual(expect.any(String));
      expect(handle.bindToken).not.toBe('');
      // The whole point: the session id travels in a URL path and therefore leaks into logs and
      // proxies. If the token were the same value, separating them would buy nothing.
      expect(handle.bindToken).not.toBe(handle.sessionId);
    });

    it('gives every surface its own token', () => {
      const registry = createFrontendSessionRegistry({});

      const first = registry.attach({ descriptor: { sessionId: 's-1', capabilities: [] }, deliver: () => undefined });
      const second = registry.attach({ descriptor: { sessionId: 's-2', capabilities: [] }, deliver: () => undefined });

      expect(first.bindToken).not.toBe(second.bindToken);
    });

    it('mints its own invocation id rather than trusting the surface', async () => {
      const registry = createFrontendSessionRegistry({});
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      void registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} }).catch(() => undefined);

      expect(surface.delivered[0]?.invocationId).toEqual(expect.any(String));
      expect(surface.delivered[0]?.invocationId).not.toBe('');
    });

    it('serves several runs from one long-lived surface', async () => {
      let next = 0;
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => `inv-${++next}` });
      const surface = recordingSurface();
      registry.attach({ descriptor: { sessionId: 'tab-1', capabilities: ['page.click'] }, deliver: surface.deliver });

      // One tab, two messages — the pane attached once and each run binds to it as it starts.
      registry.bindRun({ runId: 'run-1', sessionId: 'tab-1' });
      registry.bindRun({ runId: 'run-2', sessionId: 'tab-1' });

      const first = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} });
      const second = registry.invoke({ runId: 'run-2', capabilityId: 'page.click', input: {} });
      registry.settle({ sessionId: 'tab-1', invocationId: 'inv-1', outcome: { ok: true, output: 'a' } });
      registry.settle({ sessionId: 'tab-1', invocationId: 'inv-2', outcome: { ok: true, output: 'b' } });

      await expect(first).resolves.toBe('a');
      await expect(second).resolves.toBe('b');
    });
  });

  describe('fails closed rather than hanging', () => {
    it('rejects when no surface is bound to the run', async () => {
      const registry = createFrontendSessionRegistry({});
      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow(
        'no frontend is bound to run "run-1", so "page.click" cannot be executed',
      );
    });

    it('rejects, listing what is on offer, when the bound surface lacks the capability', async () => {
      const registry = createFrontendSessionRegistry({});
      attachAndBind(registry, 'session-1', 'run-1', ['page.find_elements', 'page.highlight']);

      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow(
        'the frontend bound to run "run-1" does not offer "page.click" '
        + '(it offers: page.find_elements, page.highlight)',
      );
    });

    it('reports "nothing" rather than an empty list for a surface claiming no capabilities', async () => {
      const registry = createFrontendSessionRegistry({});
      attachAndBind(registry, 'session-1', 'run-1', []);

      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow(/it offers: nothing/);
    });

    it('does not route a call to a surface bound to a different run', async () => {
      const registry = createFrontendSessionRegistry({});
      const other = attachAndBind(registry, 'session-1', 'run-OTHER');

      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow(/no frontend is bound/);
      expect(other.delivered).toEqual([]);
    });

    it('refuses to bind a run to a surface that is not attached', () => {
      const registry = createFrontendSessionRegistry({});

      expect(() => registry.bindRun({ runId: 'run-1', sessionId: 'ghost' })).toThrow(
        'FrontendSessionRegistry: cannot bind run "run-1" to unattached session "ghost"',
      );
    });
  });

  // Regression coverage for a real defect found 2026-07-28 by an end-to-end run (live browser,
  // live daemon, real coding agent) that a unit test in this file alone never would have: a
  // surface claiming a trailing-dot PREFIX (`@jini-ai/chat-react`'s `createFrontendSessionBridge`,
  // `executors: { 'webmcp.': handler }`) is meant to serve every id under it, per that option's
  // own doc — but `resolveTarget` used to check `capabilities.includes(capabilityId)`, which a
  // prefix claim can never satisfy (`'webmcp.'.includes('webmcp.add_note')` is false either way
  // round). Every call to an `executors`-backed capability failed 100% of the time until fixed.
  describe('prefix claims (a trailing-dot capability claims everything under it)', () => {
    it('routes a call to a surface that claimed the matching prefix, not the exact id', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      const surface = attachAndBind(registry, 'session-1', 'run-1', ['chat.send_message', 'webmcp.']);

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'webmcp.add_note', input: { text: 'buy oat milk' } });
      expect(surface.delivered).toEqual([
        { invocationId: 'inv-1', capabilityId: 'webmcp.add_note', input: { text: 'buy oat milk' } },
      ]);
      registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: { added: 'buy oat milk' } } });
      await expect(pending).resolves.toEqual({ added: 'buy oat milk' });
    });

    it('routes every id under a claimed prefix, not just one', async () => {
      let next = 0;
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => `inv-${++next}` });
      const surface = attachAndBind(registry, 'session-1', 'run-1', ['webmcp.']);

      const first = registry.invoke({ runId: 'run-1', capabilityId: 'webmcp.add_note', input: {} });
      const second = registry.invoke({ runId: 'run-1', capabilityId: 'webmcp.list_notes', input: {} });
      registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: 'a' } });
      registry.settle({ sessionId: 'session-1', invocationId: 'inv-2', outcome: { ok: true, output: 'b' } });

      await expect(first).resolves.toBe('a');
      await expect(second).resolves.toBe('b');
    });

    it('still refuses an id that does not fall under any claimed prefix', async () => {
      const registry = createFrontendSessionRegistry({});
      attachAndBind(registry, 'session-1', 'run-1', ['webmcp.']);

      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'chat.send_message', input: {} })).rejects.toThrow(
        'the frontend bound to run "run-1" does not offer "chat.send_message" (it offers: webmcp.)',
      );
    });

    it('does not treat a claim without a trailing dot as a prefix', async () => {
      const registry = createFrontendSessionRegistry({});
      // "webmcp" (no dot) must not silently match "webmcp.add_note" — only an exact id or a
      // genuine trailing-dot prefix claim may.
      attachAndBind(registry, 'session-1', 'run-1', ['webmcp']);

      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'webmcp.add_note', input: {} })).rejects.toThrow(/does not offer/);
    });

    it('an exact claim still matches exactly, even when a prefix claim is also present', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      const surface = attachAndBind(registry, 'session-1', 'run-1', ['page.click', 'webmcp.']);

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: { element: 'x' } });
      registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: { clicked: 'x' } } });
      await expect(pending).resolves.toEqual({ clicked: 'x' });
      expect(surface.delivered).toEqual([{ invocationId: 'inv-1', capabilityId: 'page.click', input: { element: 'x' } }]);
    });
  });

  describe('bindings', () => {
    it('replaces the association when a run is bound to a different surface', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      const first = attachAndBind(registry, 'session-1', 'run-1');
      const second = recordingSurface();
      registry.attach({ descriptor: { sessionId: 'session-2', capabilities: ['page.click'] }, deliver: second.deliver });

      registry.bindRun({ runId: 'run-1', sessionId: 'session-2' });
      void registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} }).catch(() => undefined);

      expect(first.delivered).toEqual([]);
      expect(second.delivered).toHaveLength(1);
      expect(registry.sessionFor({ runId: 'run-1' })?.sessionId).toBe('session-2');
    });

    it('releases the association when the returned unbind is called', async () => {
      const registry = createFrontendSessionRegistry({});
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      surface.unbind();

      expect(registry.sessionFor({ runId: 'run-1' })).toBeUndefined();
      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow(/no frontend is bound/);
    });

    it('does not let a stale unbind tear down a newer binding for the same run', () => {
      const registry = createFrontendSessionRegistry({});
      const first = attachAndBind(registry, 'session-1', 'run-1');
      registry.attach({ descriptor: { sessionId: 'session-2', capabilities: ['page.click'] }, deliver: recordingSurface().deliver });

      registry.bindRun({ runId: 'run-1', sessionId: 'session-2' });
      first.unbind();

      expect(registry.sessionFor({ runId: 'run-1' })?.sessionId).toBe('session-2');
    });
  });

  // `bindRun` trusts its sessionId argument, which is right for a composition root and unsafe for
  // anything a caller supplied — session ids travel in URL paths and leak into logs. The token is
  // the wire-safe form.
  describe('binding by token', () => {
    it('binds the run to the surface holding the token', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      const surface = recordingSurface();
      const handle = registry.attach({ descriptor: { sessionId: 'session-1', capabilities: ['page.click'] }, deliver: surface.deliver });

      registry.bindRunByToken({ runId: 'run-1', bindToken: handle.bindToken });
      void registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: { element: 'save' } }).catch(() => undefined);

      expect(registry.sessionFor({ runId: 'run-1' })?.sessionId).toBe('session-1');
      expect(surface.delivered).toHaveLength(1);
    });

    it('returns a working unbind, like bindRun does', async () => {
      const registry = createFrontendSessionRegistry({});
      const handle = registry.attach({ descriptor: { sessionId: 'session-1', capabilities: ['page.click'] }, deliver: () => undefined });

      const unbind = registry.bindRunByToken({ runId: 'run-1', bindToken: handle.bindToken });
      unbind();

      expect(registry.sessionFor({ runId: 'run-1' })).toBeUndefined();
    });

    it('refuses a token that was never issued', () => {
      const registry = createFrontendSessionRegistry({});
      registry.attach({ descriptor: { sessionId: 'session-1', capabilities: [] }, deliver: () => undefined });

      expect(() => registry.bindRunByToken({ runId: 'run-1', bindToken: 'not-a-real-token' })).toThrow(
        'cannot bind run "run-1" — unknown or expired bind token',
      );
      expect(registry.sessionFor({ runId: 'run-1' })).toBeUndefined();
    });

    it('refuses a token whose surface has detached, so a token dies with its surface', () => {
      const registry = createFrontendSessionRegistry({});
      const handle = registry.attach({ descriptor: { sessionId: 'session-1', capabilities: [] }, deliver: () => undefined });
      const token = handle.bindToken;

      handle.detach({});

      expect(() => registry.bindRunByToken({ runId: 'run-1', bindToken: token })).toThrow(/unknown or expired bind token/);
    });

    // A different message for "wrong token" than for "expired token" tells a caller whether a
    // guess was close, which is the only feedback a probe needs.
    it('reports an expired token identically to an unknown one', () => {
      const registry = createFrontendSessionRegistry({});
      const handle = registry.attach({ descriptor: { sessionId: 'session-1', capabilities: [] }, deliver: () => undefined });
      handle.detach({});

      const expired = ((): string => {
        try { registry.bindRunByToken({ runId: 'run-1', bindToken: handle.bindToken }); return ''; }
        catch (error) { return (error as Error).message; }
      })();
      const unknown = ((): string => {
        try { registry.bindRunByToken({ runId: 'run-1', bindToken: 'never-issued' }); return ''; }
        catch (error) { return (error as Error).message; }
      })();

      expect(expired).toBe(unknown);
    });

    // States the threat model exactly, including its limit: the token IS the authority, so
    // whoever holds it can bind. What this closes is that *knowing a session id* — a value the
    // system prints into URLs and therefore into logs — is no longer sufficient.
    it('treats the token as the authority and the session id as merely an address', () => {
      const registry = createFrontendSessionRegistry({});
      const surface = registry.attach({ descriptor: { sessionId: 'victim-tab', capabilities: ['page.click'] }, deliver: () => undefined });

      // Knowing the session id is not enough. That is the whole point of the separation.
      expect(() => registry.bindRunByToken({ runId: 'other-run', bindToken: 'victim-tab' })).toThrow(/unknown or expired/);

      // Holding the token is sufficient by design — which is why it is delivered only on that
      // surface's own stream and never appears in a request path.
      registry.bindRunByToken({ runId: 'other-run', bindToken: surface.bindToken });
      expect(registry.sessionFor({ runId: 'other-run' })?.sessionId).toBe('victim-tab');
    });
  });

  describe('duplicate answers', () => {
    it('reports false for a second settle and leaves the first result intact', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} });
      expect(registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: 'first' } })).toBe(true);
      expect(registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: 'second' } })).toBe(false);
      expect(registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: false, message: 'late failure' } })).toBe(false);

      await expect(pending).resolves.toBe('first');
    });

    it('reports false for an unknown session or an unknown invocation', () => {
      const registry = createFrontendSessionRegistry({});
      attachAndBind(registry, 'session-1', 'run-1');

      expect(registry.settle({ sessionId: 'session-NOPE', invocationId: 'inv-1', outcome: { ok: true, output: 1 } })).toBe(false);
      expect(registry.settle({ sessionId: 'session-1', invocationId: 'inv-NOPE', outcome: { ok: true, output: 1 } })).toBe(false);
    });

    it('reports false when another session tries to answer an invocation it does not own', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');
      registry.attach({ descriptor: { sessionId: 'session-2', capabilities: ['page.click'] }, deliver: recordingSurface().deliver });

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} });
      expect(registry.settle({ sessionId: 'session-2', invocationId: 'inv-1', outcome: { ok: true, output: 'stolen' } })).toBe(false);

      registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: 'rightful' } });
      await expect(pending).resolves.toBe('rightful');
    });
  });

  describe('a surface that goes away', () => {
    it('rejects everything still awaiting a detached surface instead of leaving it pending', async () => {
      let next = 0;
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => `inv-${++next}` });
      const surface = attachAndBind(registry, 'session-1', 'run-1', ['page.click', 'page.fill']);

      const first = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} });
      const second = registry.invoke({ runId: 'run-1', capabilityId: 'page.fill', input: { element: 'note', text: 'x' } });
      expect(surface.delivered).toHaveLength(2);

      surface.handle.detach({});

      await expect(first).rejects.toThrow('frontend session "session-1" detached before answering');
      await expect(second).rejects.toThrow('frontend session "session-1" detached before answering');
    });

    it('drops the runs bound to a detached surface, so a later call fails closed', async () => {
      const registry = createFrontendSessionRegistry({});
      const surface = attachAndBind(registry, 'session-1', 'run-1');
      registry.bindRun({ runId: 'run-2', sessionId: 'session-1' });

      surface.handle.detach({});

      expect(registry.sessionFor({ runId: 'run-1' })).toBeUndefined();
      expect(registry.sessionFor({ runId: 'run-2' })).toBeUndefined();
      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow(/no frontend is bound/);
    });

    it('leaves another surface\'s bindings alone when one detaches', () => {
      const registry = createFrontendSessionRegistry({});
      const first = attachAndBind(registry, 'session-1', 'run-1');
      attachAndBind(registry, 'session-2', 'run-2');

      first.handle.detach({});

      expect(registry.sessionFor({ runId: 'run-1' })).toBeUndefined();
      expect(registry.sessionFor({ runId: 'run-2' })?.sessionId).toBe('session-2');
    });

    // A handle is a capability over *one attachment*, not over a session id. A surface that
    // reconnects (tab reload, dropped SSE stream) legitimately re-attaches under the same id, so a
    // handle left over from the previous attachment must be inert — otherwise a late `detach()`
    // from the old connection silently unroutes the live one, and every subsequent capability call
    // fails closed against a surface that is in fact still there.
    it('ignores a stale handle\'s detach once its session id has been re-attached', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      const stale = attachAndBind(registry, 'tab', 'run-1');
      stale.handle.detach({});

      const replacement = recordingSurface();
      const replacementHandle = registry.attach({ descriptor: { sessionId: 'tab', capabilities: ['page.click'] }, deliver: replacement.deliver });
      registry.bindRun({ runId: 'run-1', sessionId: 'tab' });

      stale.handle.detach({});

      expect(registry.sessionFor({ runId: 'run-1' })?.sessionId).toBe('tab');
      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: { element: 'save' } });
      expect(replacement.delivered).toHaveLength(1);
      expect(registry.settle({ sessionId: 'tab', invocationId: 'inv-1', outcome: { ok: true, output: 'clicked' } })).toBe(true);
      await expect(pending).resolves.toBe('clicked');
      expect(replacementHandle.bindToken).not.toBe(stale.handle.bindToken);
    });

    // Same hazard reached through the wire-safe door: the replacement's bind token is the only
    // authority a reconnecting surface has, and it must not be invalidated by the previous
    // attachment's teardown.
    it('leaves a replacement attachment\'s bind token usable after the stale handle detaches', () => {
      const registry = createFrontendSessionRegistry({});
      const stale = attachAndBind(registry, 'tab', 'run-1');
      stale.handle.detach({});
      const replacementHandle = registry.attach({ descriptor: { sessionId: 'tab', capabilities: ['page.click'] }, deliver: recordingSurface().deliver });

      stale.handle.detach({});

      expect(() => registry.bindRunByToken({ runId: 'run-2', bindToken: replacementHandle.bindToken })).not.toThrow();
      expect(registry.sessionFor({ runId: 'run-2' })?.sessionId).toBe('tab');
    });

    // The unbind closure has the same ownership question as `detach`, and the existing
    // "stale unbind" test above only covers the easy case where the newer binding names a
    // *different* session id. Reusing the id is what defeats an id-only comparison.
    it('does not let a stale unbind release a binding owned by a re-attachment of the same session id', () => {
      const registry = createFrontendSessionRegistry({});
      const stale = attachAndBind(registry, 'tab', 'run-1');
      stale.handle.detach({});
      registry.attach({ descriptor: { sessionId: 'tab', capabilities: ['page.click'] }, deliver: recordingSurface().deliver });
      registry.bindRun({ runId: 'run-1', sessionId: 'tab' });

      stale.unbind();

      expect(registry.sessionFor({ runId: 'run-1' })?.sessionId).toBe('tab');
    });

    it('refuses to attach a session id that is already attached', () => {
      const registry = createFrontendSessionRegistry({});
      attachAndBind(registry, 'session-1', 'run-1');

      expect(() => registry.attach({ descriptor: { sessionId: 'session-1', capabilities: [] }, deliver: vi.fn() })).toThrow(
        'FrontendSessionRegistry: session "session-1" is already attached',
      );
    });

    it('rejects when delivery itself throws, rather than waiting for a timeout', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      registry.attach({ descriptor: { sessionId: 'session-1', capabilities: ['page.click'] }, deliver: () => {
        throw new Error('stream already closed');
      } });
      registry.bindRun({ runId: 'run-1', sessionId: 'session-1' });

      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow('stream already closed');
      // The failed invocation left nothing behind for a later answer to settle.
      expect(registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: 'late' } })).toBe(false);
    });

    it('normalizes a non-Error delivery failure', async () => {
      const registry = createFrontendSessionRegistry({});
      registry.attach({ descriptor: { sessionId: 'session-1', capabilities: ['page.click'] }, deliver: () => {
        throw 'socket gone';
      } });
      registry.bindRun({ runId: 'run-1', sessionId: 'session-1' });

      await expect(registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} })).rejects.toThrow('socket gone');
    });
  });

  describe('cancellation', () => {
    it('rejects immediately when the caller signal is already aborted', async () => {
      const registry = createFrontendSessionRegistry({});
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      await expect(
        registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} }, { signal: AbortSignal.abort() }),
      ).rejects.toThrow('"page.click" was cancelled before the frontend answered');
      expect(surface.delivered).toEqual([]);
    });

    it('rejects when the caller signal aborts while the surface is still thinking', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');
      const controller = new AbortController();

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} }, { signal: controller.signal });
      controller.abort();

      await expect(pending).rejects.toThrow('"page.click" was cancelled before the frontend answered');
      // A late answer from the surface finds nothing to settle.
      expect(registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: 'too late' } })).toBe(false);
    });

    it('removes its abort listener once the invocation settles normally', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} }, { signal: controller.signal });
      registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: 'done' } });
      await expect(pending).resolves.toBe('done');

      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('works without a signal at all', async () => {
      const registry = createFrontendSessionRegistry({  }, { newInvocationId: () => 'inv-1' });
      attachAndBind(registry, 'session-1', 'run-1');

      const pending = registry.invoke({ runId: 'run-1', capabilityId: 'page.click', input: {} });
      registry.settle({ sessionId: 'session-1', invocationId: 'inv-1', outcome: { ok: true, output: 'done' } });

      await expect(pending).resolves.toBe('done');
    });
  });

  describe('availability reporting', () => {
    it('reports the bound surface\'s capabilities so a caller advertises only what can be served', () => {
      const registry = createFrontendSessionRegistry({});
      attachAndBind(registry, 'session-1', 'run-1', ['page.click', 'page.fill']);

      expect(registry.capabilitiesFor({ runId: 'run-1' })).toEqual(['page.click', 'page.fill']);
      expect(registry.sessionFor({ runId: 'run-1' })).toEqual({
        sessionId: 'session-1',
        capabilities: ['page.click', 'page.fill'],
      });
    });

    it('reports nothing for an unbound run, so availability fails closed', () => {
      const registry = createFrontendSessionRegistry({});
      attachAndBind(registry, 'session-1', 'run-1');

      expect(registry.capabilitiesFor({ runId: 'run-2' })).toEqual([]);
      expect(registry.sessionFor({ runId: 'run-2' })).toBeUndefined();
    });

    it('drops a detached surface from availability', () => {
      const registry = createFrontendSessionRegistry({});
      const surface = attachAndBind(registry, 'session-1', 'run-1');

      expect(registry.capabilitiesFor({ runId: 'run-1' })).toEqual(['page.click']);
      surface.handle.detach({});
      expect(registry.capabilitiesFor({ runId: 'run-1' })).toEqual([]);
    });
  });
});
