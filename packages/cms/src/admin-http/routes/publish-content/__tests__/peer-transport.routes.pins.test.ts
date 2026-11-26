import { expect, it } from 'vitest';
import { PublishContentPeerTransportError } from '../../../../publish/content/peer-transport.js';
import { knownPeerActionRefusal } from '../peer-transport.js';

it('keeps typed peer transport codes and leaves unknown failures to the incident writer', () => {
  const err = new PublishContentPeerTransportError({ code: 'EGRESS_REFUSED', message: 'destination refused', redact: ({ text }) => ({ text }) });
  expect(knownPeerActionRefusal({ err })).toEqual({ status: 502, body: { error: 'destination refused', code: 'EGRESS_REFUSED' } });
  expect(knownPeerActionRefusal({ err: new Error('private detail') })).toBeUndefined();
});

it('refuses overwrite selection before the deferred peer secret read', async () => {
  const { peerPushPlanRoute } = await import('../peer-transport.js');
  let opened = false;
  await expect(peerPushPlanRoute.handle({ input: { peerId: 'peer', body: { overwriteEntityKeys: ['post:p'] } }, context: { id: 'owner' }, authorize: async () => {}, deps: {
    requireOverwriteSession: () => { throw new Error('session required'); },
    openPeer: async () => { opened = true; throw new Error('opened secret'); }, plan: async () => ({}),
  } })).rejects.toThrow('session required');
  expect(opened).toBe(false);
});
