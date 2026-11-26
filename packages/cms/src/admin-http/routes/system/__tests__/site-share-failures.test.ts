import { expect, it, vi } from 'vitest';
import { requireSavedKeysOwnerSession } from '../site-share-password.js';

it('refuses a publish-trust credential before owner and origin reads', async () => {
  const ownerPrincipalId = vi.fn(async () => 'owner');
  const sameOrigin = vi.fn(() => true);
  const reveal = vi.fn();
  const json = vi.fn();
  if (await requireSavedKeysOwnerSession({ deps: { noStore: () => {}, foreignWorkspace: () => false, requireSession: () => true,
    publishTrustContext: () => ({}), principalId: () => 'owner', ownerPrincipalId, sameOrigin, json, ownerMessage: 'owner browser required',
  } })) reveal();
  expect(reveal).not.toHaveBeenCalled();
  expect(ownerPrincipalId).not.toHaveBeenCalled();
  expect(sameOrigin).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledWith({ code: 'FORBIDDEN', message: 'owner browser required' }, 403);
});

it('redacts password refusal details and preserves export-stage failure projection', async () => {
  const { sendSiteShareFailure } = await import('../site-share-password.js');
  class Refusal extends Error { code = 'FORBIDDEN'; }
  class ExportFailure extends Error { step = 'archive' as const; appVersion = '1'; jiniVersion = '2'; time = 'now'; }
  const json = vi.fn();
  const failure = vi.fn();
  const deps = { refusal: Refusal, exportFailure: ExportFailure, json, failure };
  sendSiteShareFailure({ error: new Refusal('private'), deps }, { password: true });
  expect(json).toHaveBeenCalledWith({ code: 'FORBIDDEN', message: 'Export password is unavailable for this site.' }, 403);
  sendSiteShareFailure({ error: new ExportFailure('private'), deps });
  expect(failure).toHaveBeenCalledWith(expect.any(ExportFailure), expect.objectContaining({ message: 'The export stopped while building the ZIP.', failure: expect.objectContaining({ step: 'archive', metadata: { appVersion: '1', jiniVersion: '2', time: 'now' } }) }));
});
