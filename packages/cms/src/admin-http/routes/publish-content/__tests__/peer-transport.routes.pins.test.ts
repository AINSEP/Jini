import { expect, it } from 'vitest';
import { PublishContentPeerTransportError } from '../../../../publish/content/peer-transport.js';
import { knownPeerActionRefusal } from '../peer-transport.js';

it('keeps typed peer transport codes and leaves unknown failures to the incident writer', () => {
  const err = new PublishContentPeerTransportError({ code: 'EGRESS_REFUSED', message: 'destination refused', redact: ({ text }) => ({ text }) });
  expect(knownPeerActionRefusal({ err })).toEqual({ status: 502, body: { error: 'destination refused', code: 'EGRESS_REFUSED' } });
  expect(knownPeerActionRefusal({ err: new Error('private detail') })).toBeUndefined();
});
