import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsentRevisionsPort, type ConsentRequest } from '../settings.hooks.js';
import { CONSENT_CONFIG, RequestFailure } from './consent-fixtures.js';

/** A request fake that records each call and answers by status code, like the real routes. */
function fakeRequest(status = 200, body: unknown = { ok: true }) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const request = (async (input: { method: string; path: string; body?: unknown }, _optional = {}) => {
    calls.push(input);
    if (status >= 400) throw new RequestFailure({ message: String((body as { error?: string }).error ?? ''), status }, { code: (body as { code?: string }).code, body: body as Record<string, unknown> });
    return body;
  }) as ConsentRequest;
  return { calls, request };
}

describe('createConsentRevisionsPort', () => {
  it('maps each method onto its workspace-scoped route with the exact body', async () => {
    const { calls, request } = fakeRequest();
    const port = createConsentRevisionsPort({ request, workspaceId: 'site a' });
    await port.get();
    await port.readiness();
    await port.readiness({ path: '/about us' });
    await port.dryRun({ config: CONSENT_CONFIG });
    await port.preview({ config: CONSENT_CONFIG, path: '/' });
    await port.saveDraft({ config: CONSENT_CONFIG, expectedDraftId: null });
    await port.publish({ draftId: 'd1', expectedPublishedId: null });
    expect(calls).toEqual([
      { method: 'GET', path: '/workspaces/site%20a/consent/settings' },
      { method: 'GET', path: '/workspaces/site%20a/consent/readiness' },
      { method: 'GET', path: '/workspaces/site%20a/consent/readiness?path=%2Fabout%20us' },
      { method: 'POST', path: '/workspaces/site%20a/consent/dry-run', body: { config: CONSENT_CONFIG } },
      { method: 'POST', path: '/workspaces/site%20a/consent/preview', body: { config: CONSENT_CONFIG, path: '/' } },
      { method: 'PUT', path: '/workspaces/site%20a/consent/settings', body: { config: CONSENT_CONFIG, expectedDraftId: null } },
      { method: 'POST', path: '/workspaces/site%20a/consent/publish', body: { draftId: 'd1', expectedPublishedId: null } },
    ]);
  });

  it.each([
    [400, 'CONSENT_VALIDATION_FAILED', 'policyVersion must contain 1–64 characters.'],
    [404, undefined, 'workspace was not found'],
    [409, 'CONSENT_REVISION_CONFLICT', 'Cookie consent changed. Reload and review.'],
    [503, 'CONSENT_UNAVAILABLE', 'Cookie consent settings are unavailable.'],
  ])('passes a %i through as the request failure it is, never a success', async (status, code, error) => {
    const { request } = fakeRequest(status, { code, error });
    const failure = await createConsentRevisionsPort({ request, workspaceId: 'site' }).saveDraft({ config: CONSENT_CONFIG, expectedDraftId: 'd1' }).catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(RequestFailure);
    expect(failure).toMatchObject({ status, code, message: error });
  });

});

afterEach(() => { vi.unstubAllGlobals(); });

describe('unsafe-eval revisions transport', () => {
  it.each([true, false])('round-trips the optional boolean %s without filtering fields', async allowUnsafeEval => {
    const config = { ...CONSENT_CONFIG, allowUnsafeEval };
    const body = { revision: { id: 'd2', config }, blockingProblems: [] };
    const { calls, request } = fakeRequest(200, body);
    const port = createConsentRevisionsPort({ request, workspaceId: 'site' });
    await expect(port.saveDraft({ config, expectedDraftId: 'd1' })).resolves.toEqual(body);
    expect(calls[0]?.body).toEqual({ config, expectedDraftId: 'd1' });
  });
});
