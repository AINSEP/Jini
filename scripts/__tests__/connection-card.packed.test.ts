import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyRuntimeTree, fixture, pack, packages, run } from '../testing/packed-fixture.js';

describe('packed connection-card consumer', () => {
  it('renders different host copy and delivers a real exchange through published entries', () => {
    const dir = fixture('connection-card-');
    try {
      const seen = new Set<string>();
      for (const name of ['daemon', 'ui', 'integrations', 'oauth']) {
        copyRuntimeTree(dir, `@jini-ai/${name}`, join(packages, name), seen);
      }
      for (const name of ['daemon', 'ui', 'integrations']) pack(dir, name);
      const result = run(dir, `
        import assert from 'node:assert/strict';
        import { buildSignInCard, waitAtSignInCard } from '@jini-ai/ui/mcp-ui/sign-in-card';
        import { createSurfaceExchangeStore } from '@jini-ai/daemon/surface-exchanges';
        import { createTimeoutScheduler } from '@jini-ai/daemon/scheduler';
        import { deliverSurfaceCallback, isSurfaceCallbackPermitted } from '@jini-ai/daemon/http';
        import { waitForHostedSignIn, createSignInHandoffs } from '@jini-ai/integrations/api-connections';
        const store = createSurfaceExchangeStore({ scheduler: createTimeoutScheduler({}),
          clock: { nowMs: () => Date.now() }, idGenerator: { newId: () => 'atlas-exchange' }, defaultChannel: 'mcp-ui' });
        const toolId = 'atlas_calendar_connect';
        const spec = { uri: 'ui://atlas/calendar', toolId, app: { appName: 'atlas', appVersion: '2' },
          waiting: { title: 'Authorize Atlas calendar', description: 'Read calendar events.', message: 'Waiting for Atlas', openLinkLabel: 'Open Atlas', cancelLabel: 'Continue without Atlas' },
          connected: { title: 'Atlas ready', message: 'Calendar connected' },
          skipped: { title: 'Atlas skipped', message: 'Continue without calendar' } };
        const emissions = [];
        let status, body;
        const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
        const result = await waitAtSignInCard({ surfaceExchanges: store, toolId,
          ctx: { executionId: 'e', run: { id: 'r' }, principal: { id: 'atlas-owner' }, input: {}, signal: new AbortController().signal },
          card: state => buildSignInCard({ ...spec, ...state }), missingEmitterMessage: 'Atlas needs a chat',
          skippedResult: () => ({ status: 'skipped' }),
          connect: async ({ signal, showSignIn }) => {
            await showSignIn({ signInUrl: 'https://atlas.example.test/authorize' });
            await deliverSurfaceCallback({ res, store, exchangeId: 'atlas-exchange', toolId, principalId: 'atlas-owner', params: { __dismissed: true },
              admit: input => isSurfaceCallbackPermitted({ admitted: input.toolId === toolId, answersAnExchange: input.answersAnExchange, exchangeOnly: true }, { typedAnswer: input.typedAnswer }) });
            assert.equal(signal.aborted, true);
            return { status: 'not-connected' };
          },
        }, { emitSurface: async emission => emissions.push(emission) });
        assert.deepEqual(result, { status: 'skipped' });
        assert.equal(status, 202); assert.deepEqual(body, { delivered: true });
        assert.equal(emissions.length, 2); assert.equal(store.size(), 0);
        const waiting = emissions[0].payload.resource, final = emissions[1].payload.resource;
        assert.match(waiting.resource.text, /Authorize Atlas calendar/);
        assert.match(waiting.resource.text, /atlas_calendar_connect/);
        assert.match(waiting.resource.text, /https:\\/\\/atlas.example.test\\/authorize/);
        assert.match(final.resource.text, /Atlas skipped/);
        assert.equal(waiting.resource.uri, final.resource.uri);
        assert.equal(typeof waitForHostedSignIn, 'function'); assert.equal(typeof createSignInHandoffs, 'function');
      `);
      expect(result.status, result.stderr || result.stdout).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
