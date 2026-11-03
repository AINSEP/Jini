import { expect, it } from 'vitest';
import { buildOutcomeSurface, renderOutcomeDocument } from '../../surfaces/outcome.js';
import { MCP_UI_ACTION_PLAN_META_KEY } from '../../resource.js';
import { mountSurface } from './mount-surface.js';

const spec = {
  title: 'Connect Example', state: 'partial' as const, message: 'Waiting for you to sign in…',
  openLinkUrl: 'https://example.test/sign-in', openLinkLabel: 'Sign in',
  cancel: { label: 'Skip', toolName: 'connect', params: { __exchangeId: 'exchange', __dismissed: true } },
};

it('Skip releases a waiting sign-in card through its exchange without opening the sign-in link', async () => {
  const surface = mountSurface(renderOutcomeDocument(spec));
  // DOMParser documents have no defaultView; jest-dom's realm check rejects their nodes.
  expect(surface.button('cancel').textContent).toBe('Skip');
  surface.trustedClick('open-link');
  expect(surface.api.openLink).toHaveBeenCalledWith(spec.openLinkUrl);
  expect(surface.api.callTool).not.toHaveBeenCalled();
  surface.trustedClick('cancel');
  surface.trustedClick('cancel');
  expect(surface.api.callTool).toHaveBeenCalledTimes(1);
  expect(surface.api.callTool).toHaveBeenCalledWith('connect', spec.cancel.params);
  await surface.settle('resolve', { delivered: true });
  expect(surface.statusState()).toBe('dismissed');
  expect(surface.disabledActions()).toEqual([true, true]);
});

it('exposes the pending Skip action to the chat host without exposing its exchange parameters', () => {
  const resource = buildOutcomeSurface({ ...spec, uri: 'ui://test/sign-in' });
  const plan = resource.resource._meta?.[MCP_UI_ACTION_PLAN_META_KEY];
  expect(plan).toEqual({ title: 'Connect Example', actions: [
    { id: 'open-link', label: 'Sign in', variant: 'neutral' }, { id: 'cancel', label: 'Skip', variant: 'neutral' },
  ] });
  expect(JSON.stringify(plan)).not.toContain('__exchangeId');
});

it('a rejected Skip stays retryable and an expired sign-in card explains that it expired', async () => {
  const surface = mountSurface(renderOutcomeDocument(spec));
  surface.trustedClick('cancel');
  await surface.settle('reject', new Error('Connection lost'));
  expect(surface.status()).toContain('Connection lost');
  expect(surface.disabledActions()).toEqual([false, false]);
  surface.trustedClick('cancel');
  await surface.settle('reject', { data: { code: 'SURFACE_NOT_PENDING' } });
  expect(surface.statusState()).toBe('expired');
  expect(surface.disabledActions()).toEqual([true, true]);
});
