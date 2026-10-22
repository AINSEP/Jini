/** The `./net`, `./web` and `./secrets/testing` subpaths are pure re-export barrels: each must
 * publish exactly its leaves' runtime bindings, by identity, and nothing else. */
import { expect, test } from 'vitest';
import * as net from '../net/index.js';
import * as address from '../net/address.js';
import * as web from '../web/index.js';
import * as webPage from '../web/web-page.js';
import * as htmlDocument from '../web/html-document.js';
import { htmlToMarkdown } from '../web/html-to-markdown.js';
import * as secretsTesting from '../secrets/testing.js';
import { InMemoryKeyring } from '../secrets/keyring.memory.js';
import { FixedRootKeyKeyring } from '../secrets/keyring.env.js';

test('./net publishes the address classifiers by identity', () => {
  expect(Object.keys(net).sort()).toEqual(['expandIpv6', 'isBlockedExternalApiHostname', 'isLoopbackApiHost', 'isLoopbackHostname', 'isPrivateAddress']);
  for (const name of Object.keys(net) as (keyof typeof net)[]) expect(net[name]).toBe(address[name]);
  expect(net.isPrivateAddress({ address: '10.0.0.1' })).toBe(true);
  expect(net.isPrivateAddress({ address: '203.0.113.1' })).toBe(false);
});

test('./web publishes the page reader, the document projections and only the markdown converter', () => {
  const expected = { ...webPage, ...htmlDocument, htmlToMarkdown };
  expect(Object.keys(web).sort()).toEqual(Object.keys(expected).sort());
  for (const [name, binding] of Object.entries(expected)) expect(web[name as keyof typeof web]).toBe(binding);
});

test('./secrets/testing publishes the two test keyrings by identity', () => {
  expect(Object.keys(secretsTesting).sort()).toEqual(['FixedRootKeyKeyring', 'InMemoryKeyring']);
  expect(secretsTesting.InMemoryKeyring).toBe(InMemoryKeyring);
  expect(secretsTesting.FixedRootKeyKeyring).toBe(FixedRootKeyKeyring);
});
