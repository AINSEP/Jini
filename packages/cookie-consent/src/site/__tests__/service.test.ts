import { expect, it, vi } from 'vitest';
import { ToolInputError } from '@jini-ai/core';
import type { ConsentConfig } from '@jini-ai/core/contracts/site/cookie-consent';
import { SITE_CONSENT_DEFAULTS } from '../config.js';
import { SiteConsentConflict, type SiteConsentState, type SiteConsentStore } from '../revisions.js';
import { createSiteConsentService, type ConsentServicePorts } from '../service.js';

const config: ConsentConfig = { ...SITE_CONSENT_DEFAULTS, enabled: true, title: 'Example privacy', policyVersion: 'policy-7', privacyPolicyUrl: '/privacy', regionMode: 'opt-in' };
const editor = { principalId: 'owner-7' };

function site(initial: SiteConsentState = { draft: null, published: null }) {
  let state = initial;
  let count = 0;
  const store: SiteConsentStore = {
    read: async () => structuredClone(state),
    readPublished: async () => structuredClone(state.published),
    async saveDraft({ revision, expectedDraftId, signal }) {
      if ((state.draft?.id ?? null) !== expectedDraftId) throw new SiteConsentConflict();
      signal?.throwIfAborted();
      state = { ...state, draft: structuredClone(revision) };
    },
    async publish({ draftId, expectedPublishedId, signal }) {
      if (state.draft?.id !== draftId || (state.published?.id ?? null) !== expectedPublishedId) throw new SiteConsentConflict();
      signal?.throwIfAborted();
      state = { ...state, published: state.draft };
    },
  };
  const ports = {
    workspaceId: 'site-7', ready: Promise.resolve(), store, trustedRegion: false,
    authorize: vi.fn<ConsentServicePorts['authorize']>(async ({ principalId, workspaceId, permission }) => ({
      allowed: workspaceId === 'site-7' && (principalId === 'owner-7' || (principalId === 'reader-7' && permission === 'settings.read')),
      reason: 'policy denied',
    })),
    readLegacy: vi.fn(async (): Promise<ConsentConfig> => config),
    defaultOnly: vi.fn(async () => false),
    privacyPageExists: vi.fn(async ({ url }: { url: string }) => url === '/privacy'),
    renderPage: vi.fn<ConsentServicePorts['renderPage']>(async () => ({ html: '<!doctype html><h1>Home</h1>', ok: true, truncated: false })),
    receiptStorage: vi.fn<ConsentServicePorts['receiptStorage']>(async () => ({ writable: true, count: 2 })),
    declarationEvidence: vi.fn<NonNullable<ConsentServicePorts['declarationEvidence']>>(async () => ({ scripts: [], runtimeSlot: true })),
    consentPagePath: vi.fn(({ path }: { path: string }) => {
      if (path === '/') return '/';
      if (path === '/sample/') return '/sample';
      throw new ToolInputError({ message: 'Choose a public page.' });
    }),
    deploymentRefusal: vi.fn<ConsentServicePorts['deploymentRefusal']>(({ problems }) => ({
      code: 'CONSENT_BLOCKED', error: 'Deployment blocked', blockingProblems: problems, choices: [],
    })),
    reportConsentFailure: vi.fn<ConsentServicePorts['reportConsentFailure']>(),
    clock: { nowIso: () => '2026-11-20T00:00:00.000Z' },
    ids: { newId: () => `revision-${++count}` },
  } satisfies ConsentServicePorts;
  return { store, ports, service: createSiteConsentService({ ports }) };
}

it('lets a read-only user inspect settings but denies saving before a draft can change', async () => {
  const h = site();
  const principalId = 'reader-7';
  expect(await h.service.read({ principalId })).toMatchObject({ effective: { title: 'Example privacy' }, categoriesEditable: false });
  await expect(h.service.saveDraft({ principalId, config, expectedDraftId: null })).rejects
    .toThrow("principal 'reader-7' is not authorized for 'settings.workspace.write' (policy denied)");
  expect(h.ports.authorize.mock.calls).toEqual([
    [{ principalId, permission: 'settings.read', workspaceId: 'site-7', entityType: 'site-consent' }],
    [{ principalId, permission: 'settings.workspace.write', workspaceId: 'site-7', entityType: 'site-consent' }],
  ]);
  expect(await h.store.read({})).toEqual({ draft: null, published: null });
});

it('normalizes only invalid legacy text for repair and refuses to open without a durable store', async () => {
  const h = site();
  h.ports.readLegacy.mockResolvedValueOnce({ ...config, title: ' ', policyVersion: 'x'.repeat(65), secondaryLinkLabel: '' });
  const result = await h.service.read(editor);
  expect(result.effective).toMatchObject({ title: 'Your cookie choices', policyVersion: '1', secondaryLinkLabel: '', privacyPolicyUrl: '/privacy' });
  const { store: _unavailable, ...ports } = h.ports;
  await expect(createSiteConsentService({ ports }).read(editor)).rejects.toThrow('The durable site consent policy store is unavailable.');
});

it('saves an immutable draft, rejects stale publication, and keeps a committed publication if refresh fails', async () => {
  const h = site();
  const error = new Error('construction unavailable');
  const published = vi.fn(async () => {
    // Capture the snapshot while refresh is in progress to prove that it sees the committed value.
    const live = await h.store.readPublished({});
    if (live?.id !== 'revision-1') throw new Error('refresh ran before commit');
    throw error;
  });
  const service = createSiteConsentService({ ports: { ...h.ports, published } });
  expect(await service.saveDraft({ ...editor, config, expectedDraftId: null })).toEqual({
    revision: { config, id: 'revision-1', actorId: 'owner-7', createdAt: '2026-11-20T00:00:00.000Z' }, blockingProblems: [],
  });
  expect(await h.store.readPublished({})).toBeNull();
  await expect(service.publish({ ...editor, draftId: 'stale-draft', expectedPublishedId: null })).rejects.toBeInstanceOf(SiteConsentConflict);
  expect(published).not.toHaveBeenCalled();
  expect(await service.publish({ ...editor, draftId: 'revision-1', expectedPublishedId: null })).toEqual({ published: true, revisionId: 'revision-1' });
  expect(await h.store.readPublished({})).toMatchObject({ id: 'revision-1', config });
  expect(h.ports.reportConsentFailure.mock.calls).toEqual([[{
    message: 'Cookie preferences were published, but the public preview could not refresh. A later request will try again.', error,
  }]]);
});

it('allows saving an unlinked policy as a draft but blocks publishing until its page exists', async () => {
  const h = site();
  const result = await h.service.saveDraft({ ...editor, config: { ...config, privacyPolicyUrl: '/missing' }, expectedDraftId: null });
  expect(result.blockingProblems).toEqual([{
    code: 'PRIVACY_PAGE_MISSING', field: 'privacyPolicyUrl', message: 'Publish the linked privacy page before enabling consent.',
  }]);
  expect((await h.store.read({})).draft?.id).toBe('revision-1');
  await expect(h.service.publish({ ...editor, draftId: 'revision-1', expectedPublishedId: null }))
    .rejects.toThrow('Publish the linked privacy page before enabling consent.');
  expect(await h.store.readPublished({})).toBeNull();
});

it('previews unsaved copy first, then draft copy, without executing a render or exposing a consent client', async () => {
  const h = site();
  await h.service.saveDraft({ ...editor, config: { ...config, title: 'Draft & pending' }, expectedDraftId: null });
  const proposed = await h.service.preview({ ...editor, path: '/sample/', config: { ...config, title: 'Unsaved <proposal>' } });
  expect(proposed).toMatchObject({ revisionId: 'revision-1', sandbox: '', blockingProblems: [] });
  expect(proposed.html).toContain('Unsaved &lt;proposal&gt;');
  expect(proposed.html).not.toContain('<script src=');
  const saved = await h.service.preview(editor);
  expect(saved.html).toContain('Draft &amp; pending');
  expect(saved.html).not.toContain('Unsaved &lt;proposal&gt;');
  expect(h.ports.consentPagePath.mock.calls).toEqual([[{ path: '/sample/' }], [{ path: '/' }]]);
  expect(h.ports.renderPage).not.toHaveBeenCalled();
});

it('samples a normalized path and reports unavailable evidence without treating it as a clean audit', async () => {
  const h = site();
  expect(await h.service.readiness({ ...editor, path: '/sample/' })).toMatchObject({
    ready: true, receipts: { writable: true, count: 2 }, sampledPaths: ['/sample'], blockingProblems: [], sampleOnly: true,
  });
  expect(h.ports.renderPage.mock.calls).toEqual([[{ path: '/sample' }]]);
  h.ports.receiptStorage.mockRejectedValueOnce(new Error('private store path'));
  h.ports.renderPage.mockResolvedValueOnce({ html: '<h1>Truncated sample</h1>', ok: true, truncated: true });
  const { declarationEvidence: _unavailable, ...ports } = h.ports;
  const degraded = await createSiteConsentService({ ports }).readiness(editor);
  expect(degraded).toMatchObject({ ready: false, truncated: true, receipts: { writable: false, count: null } });
  expect(degraded.blockingProblems.map(({ code }) => code)).toEqual(['RECEIPT_STORAGE_UNAVAILABLE', 'PAGE_UNAVAILABLE', 'DECLARATIONS_UNAVAILABLE']);
});

it('does not mistake rendering failure for an empty scan and logs only through the host port', async () => {
  const h = site();
  const error = new Error('private renderer details');
  h.ports.renderPage.mockRejectedValueOnce(error);
  const output = await h.service.readiness(editor);
  expect(output).toMatchObject({ ready: false, declarations: [], limitations: ['Rendered evidence unavailable.'] });
  expect(output.blockingProblems).toEqual([{ code: 'RENDER_FAILED', message: 'The page could not be rendered safely. Readiness cannot be established.' }]);
  expect(h.ports.reportConsentFailure.mock.calls).toEqual([[{ message: 'The page could not be rendered; readiness remains unavailable.', error }]]);
});

it('allows default-only and explicit off deployments but refuses invalid or unavailable enforcement', async () => {
  const h = site();
  const request = { ...editor, permission: 'deployments.publish' as const };
  h.ports.defaultOnly.mockResolvedValueOnce(true);
  expect(await h.service.deploymentCheck(request)).toBeNull();
  expect(h.ports.readLegacy).not.toHaveBeenCalled();
  h.ports.readLegacy.mockResolvedValueOnce({ ...config, enabled: false, title: '' });
  expect(await h.service.deploymentCheck(request)).toBeNull();
  expect(await h.service.deploymentCheck(request)).toBeNull();

  h.ports.readLegacy.mockResolvedValueOnce({ ...config, privacyPolicyUrl: '/missing' });
  expect(await h.service.deploymentCheck(request)).toMatchObject({
    code: 'CONSENT_BLOCKED', blockingProblems: [{ code: 'PRIVACY_PAGE_MISSING' }],
  });
  const error = new Error('consent store unavailable');
  h.ports.readLegacy.mockRejectedValueOnce(error);
  expect(await h.service.deploymentCheck(request)).toMatchObject({
    code: 'CONSENT_BLOCKED', blockingProblems: [{ code: 'CONSENT_UNAVAILABLE' }],
  });
  expect(h.ports.reportConsentFailure.mock.calls).toEqual([[{ message: 'The consent policy could not be verified; deployment remains blocked.', error }]]);
});
