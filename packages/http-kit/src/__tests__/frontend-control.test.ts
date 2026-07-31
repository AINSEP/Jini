import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFrontendControl } from '../frontend-control.js';

const PAGE_CLICK = { id: 'page.click', description: 'Activate one control.' } as const;
const PAGE_FILL = { id: 'page.fill', description: 'Type into one field.' } as const;
const ALLOW_ALL = { authorize: (): 'allow' => 'allow' };

/** Only the two members `bindOnStarted` actually uses. */
function fakeLifecycle(terminal: Promise<unknown> = new Promise(() => undefined)) {
  return { waitForTerminal: vi.fn(() => terminal) } as never;
}

function startContext(runId: string, contextRef: string, lifecycle = fakeLifecycle()) {
  return { request: { contextRef }, run: { id: runId }, lifecycle } as never;
}

describe('createFrontendControl', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });

  /** Mounts the bundle's own extension — the only route to the registry a host is given. */
  async function listen(control: ReturnType<typeof createFrontendControl>): Promise<string> {
    const app = express();
    app.use(express.json());
    const resolvedPortRef = { current: 0 };
    control.httpExtension(app as never, { adapter: { resolvedPortRef } } as never);
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);
    resolvedPortRef.current = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${resolvedPortRef.current}`;
  }

  /** Opens a surface and reads the `attached` event off the stream. */
  async function attachSurface(base: string, capability: string): Promise<{
    sessionId: string;
    bindToken: string;
    next: () => Promise<Record<string, unknown>>;
    close: () => void;
  }> {
    const controller = new AbortController();
    const response = await fetch(
      `${base}/api/frontend-sessions/stream?capability=${encodeURIComponent(capability)}`,
      { signal: controller.signal },
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const next = async (): Promise<Record<string, unknown>> => {
      for (;;) {
        const { value } = await reader.read();
        const line = decoder.decode(value).split('\n').find((l) => l.startsWith('data: '));
        if (line) return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;
      }
    };
    const attached = await next();
    return {
      sessionId: String(attached.sessionId),
      bindToken: String(attached.bindToken),
      next,
      close: () => controller.abort(),
    };
  }

  describe('what a host is given', () => {
    it('exposes only the extension, the registrations and the bind hook', () => {
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        resolveBindToken: () => undefined,
      });

      expect(Object.keys(control).sort()).toEqual(['bindOnStarted', 'httpExtension', 'toolRegistrations']);
    });

    // The registry's invoke() drives a real user's screen with no policy, confirmation, timeout or
    // audit. It is safe only because a gated ToolHandler is the one thing that can reach it.
    it('never hands back the registry, so a host cannot reach an ungated invoke', () => {
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        resolveBindToken: () => undefined,
      });

      for (const value of Object.values(control)) {
        expect(value).not.toHaveProperty('invoke');
        expect(value).not.toHaveProperty('bindRunByToken');
      }
    });

    it('produces one gated registration per capability, in manifest order', () => {
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK, PAGE_FILL],
        resolveBindToken: () => undefined,
      });

      expect(control.toolRegistrations.map((r) => r.descriptor.id)).toEqual(['page.click', 'page.fill']);
      // Deny-by-default survives the facade: a host grants access by supplying a policy.
      expect(control.toolRegistrations[0]?.policy.authorize({} as never)).toBe('deny');
    });

    it('passes the host\'s timeout and output bound through to every descriptor', () => {
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK, PAGE_FILL],
        resolveBindToken: () => undefined,
        policy: ALLOW_ALL,
        timeoutMs: 1_500,
        maxOutputBytes: 4_096,
      });

      for (const registration of control.toolRegistrations) {
        expect(registration.descriptor.timeoutMs).toBe(1_500);
        expect(registration.descriptor.maxOutputBytes).toBe(4_096);
      }
    });
  });

  describe('binding a run to the surface that started it', () => {
    it('routes a tool call to the surface whose token the run carried', async () => {
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        policy: ALLOW_ALL,
        resolveBindToken: (request) => request.contextRef,
      });
      const base = await listen(control);
      const surface = await attachSurface(base, 'page.click');

      control.bindOnStarted(startContext('run-1', surface.bindToken));

      const pending = control.toolRegistrations[0]!.handler({
        executionId: 'e', principal: { id: 'p' }, run: { id: 'run-1' },
        input: { element: 'save' }, signal: new AbortController().signal,
      } as never);

      const invocation = await surface.next();
      expect(invocation).toMatchObject({
        type: 'invocation', capabilityId: 'page.click', input: { element: 'save' },
      });

      await fetch(`${base}/api/frontend-sessions/${surface.sessionId}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base },
        body: JSON.stringify({ invocationId: invocation.invocationId, ok: true, output: { clicked: true } }),
      });
      await expect(pending).resolves.toEqual({ clicked: true });
      surface.close();
    });

    it('binds nothing when the run has no originating surface', () => {
      const onBindError = vi.fn();
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        resolveBindToken: () => undefined,
        onBindError,
      });

      // A CLI-started run is the normal case for this, not an error.
      expect(() => control.bindOnStarted(startContext('run-1', 'ignored'))).not.toThrow();
      expect(onBindError).not.toHaveBeenCalled();
    });

    // A run that cannot reach a page is degraded, not invalid. Killing it would turn one missing
    // optional channel into no session at all.
    it('reports a bad token without failing the run', () => {
      const onBindError = vi.fn();
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        resolveBindToken: () => 'never-issued',
        onBindError,
      });

      expect(() => control.bindOnStarted(startContext('run-1', 'x'))).not.toThrow();
      expect(onBindError).toHaveBeenCalledWith({
        runId: 'run-1',
        error: expect.objectContaining({ message: expect.stringContaining('unknown or expired bind token') }),
      });
    });

    // `RunStartHandler` throwing is not a no-op: `@jini-ai/http-kit`'s run-start route catches it,
    // marks the run `failed` and answers 500. So anything that can throw inside this hook can turn
    // the documented "degraded, not failed" outcome into exactly the killed run it promises not to
    // cause — including the host's own `resolveBindToken`, which reads an opaque host blob.
    it("reports a throwing resolveBindToken without failing the run", () => {
      const onBindError = vi.fn();
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        resolveBindToken: () => {
          throw new Error('contextRef was not the JSON this host expected');
        },
        onBindError,
      });

      expect(() => control.bindOnStarted(startContext('run-1', 'x'))).not.toThrow();
      expect(onBindError).toHaveBeenCalledWith({
        runId: 'run-1',
        error: expect.objectContaining({ message: expect.stringContaining('contextRef was not the JSON') }),
      });
    });

    it('does not let the bind-error sink itself fail the run', () => {
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        resolveBindToken: () => 'never-issued',
        onBindError: () => {
          throw new Error('the host sink exploded');
        },
      });

      expect(() => control.bindOnStarted(startContext('run-1', 'x'))).not.toThrow();
    });

    it('falls back to console.error when the host supplies no bind-error sink', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        resolveBindToken: () => 'never-issued',
      });

      control.bindOnStarted(startContext('run-1', 'x'));

      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('could not bind run "run-1"'),
        expect.objectContaining({ message: expect.stringContaining('unknown or expired bind token') }),
      );
      consoleError.mockRestore();
    });

    it('releases the binding when the run reaches a terminal state', async () => {
      let finish: (value: unknown) => void = () => undefined;
      const terminal = new Promise((resolve) => { finish = resolve; });
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        policy: ALLOW_ALL,
        resolveBindToken: (request) => request.contextRef,
      });
      const base = await listen(control);
      const surface = await attachSurface(base, 'page.click');

      control.bindOnStarted(startContext('run-1', surface.bindToken, fakeLifecycle(terminal)));
      finish({ id: 'run-1', state: 'succeeded' });
      await terminal;
      await new Promise((resolve) => setImmediate(resolve));

      // The binding is gone, so a later call fails closed instead of reaching a stale surface.
      await expect(control.toolRegistrations[0]!.handler({
        executionId: 'e', principal: { id: 'p' }, run: { id: 'run-1' },
        input: {}, signal: new AbortController().signal,
      } as never)).rejects.toThrow(/no frontend is bound/);
      surface.close();
    });

    it('releases the binding even when waiting for terminal rejects', async () => {
      const control = createFrontendControl({
        capabilities: [PAGE_CLICK],
        policy: ALLOW_ALL,
        resolveBindToken: (request) => request.contextRef,
      });
      const base = await listen(control);
      const surface = await attachSurface(base, 'page.click');
      const rejected = Promise.reject(new Error('lifecycle exploded'));

      control.bindOnStarted(startContext('run-1', surface.bindToken, fakeLifecycle(rejected)));
      await rejected.catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));

      await expect(control.toolRegistrations[0]!.handler({
        executionId: 'e', principal: { id: 'p' }, run: { id: 'run-1' },
        input: {}, signal: new AbortController().signal,
      } as never)).rejects.toThrow(/no frontend is bound/);
      surface.close();
    });
  });
});
