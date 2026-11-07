import { afterEach, expect, it, vi } from 'vitest';
import { accessApprovalDetails } from '../../surfaces/access-approval.js';
import { buildConfirmationSurface, CONFIRM_DWELL_MS } from '../../surfaces/confirmation.js';
import { MCP_UI_ACTION_PLAN_META_KEY } from '../../resource.js';
import { mountSurface } from './mount-surface.js';

const access = () => ({ resources: [{ id: 'mail', label: 'Mail <tools>', scope: { personId: 'person', siteId: 'site', chatId: 'chat' }, previous: { allow: [] }, proposed: { allow: ['read'], write: [] }, revision: 'v1' }] });
const card = () => buildConfirmationSurface({
  details: accessApprovalDetails({ access: access() }), uri: 'ui://test/access', title: 'Allow this access?',
  confirm: { label: 'Allow', toolName: 'decide', params: { exchangeId: 'private-exchange', decision: 'confirm' } },
  cancel: { label: 'Cancel', toolName: 'decide', params: { exchangeId: 'private-exchange', decision: 'cancel' } },
});

afterEach(() => vi.useRealTimers());

it('discloses the named resource and detached fixed before/after grant', () => {
  const original = access(); const details = accessApprovalDetails({ access: original });
  original.resources[0]!.proposed.allow.push('write');
  expect(details).toEqual([
    { label: 'Resource', value: 'Mail <tools>' },
    { label: 'Mail <tools>', previous: { allow: [] }, value: { allow: ['read'], write: [] } },
  ]);
  const resource = card();
  const doc = new DOMParser().parseFromString(resource.resource.text, 'text/html');
  expect(doc.body.textContent).toContain('Mail <tools>'); expect(doc.querySelector('tools')).toBeNull();
  expect(doc.querySelectorAll('input')).toHaveLength(0);
  expect(JSON.stringify(resource.resource._meta?.[MCP_UI_ACTION_PLAN_META_KEY])).not.toContain('private-exchange');
});

it('reuses the dwell and trusted-click gate and sends one decision only', () => {
  vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  const surface = mountSurface(card().resource.text);
  surface.trustedClick('confirm'); expect(surface.calls).toEqual([]);
  vi.advanceTimersByTime(CONFIRM_DWELL_MS);
  surface.click('confirm'); expect(surface.calls).toEqual([]);
  surface.trustedClick('confirm'); surface.trustedClick('confirm');
  expect(surface.calls).toHaveLength(1);
  expect(surface.calls[0]).toMatchObject({ tool: 'decide', params: { exchangeId: 'private-exchange', decision: 'confirm' } });
});

it('names the resource without displaying opaque target ids or revisions', () => {
  const doc = new DOMParser().parseFromString(card().resource.text, 'text/html');
  expect(doc.body.textContent).toContain('Mail <tools>');
  expect(doc.body.textContent).not.toMatch(/Person ID|Site ID|Chat ID|Revision|v1/);
  const resource = access().resources[0]!;
  expect(resource.scope).toEqual({ personId: 'person', siteId: 'site', chatId: 'chat' });
});
