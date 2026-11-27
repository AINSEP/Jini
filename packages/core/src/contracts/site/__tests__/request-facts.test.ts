import { expect, it } from 'vitest';
import { readRequestFacts } from '../request-facts.js';

const hostFacts = { clientAddress: '192.0.2.8', servingProtocol: 'https', secure: false, query: { tag: ['one', 'two'] } };

it('reads the host adapter key and preserves parsed query and the independent cookie-security decision', () => {
  expect(readRequestFacts({ locals: { jiniRequestFacts: hostFacts } })).toStrictEqual({
    clientAddress: '192.0.2.8', servingProtocol: 'https', secure: false, query: { tag: ['one', 'two'] },
  });
});

it('refuses missing facts and each malformed fact without substituting a shared quota address', () => {
  for (const facts of [undefined, null, 5, { ...hostFacts, clientAddress: 5 }, { ...hostFacts, servingProtocol: 5 },
    { ...hostFacts, secure: 'false' }, { ...hostFacts, query: null }, { ...hostFacts, query: 'tag=one' }]) {
    expect(() => readRequestFacts({ locals: { jiniRequestFacts: facts } })).toThrow(
      'request facts are missing from locals.jiniRequestFacts: the route was mounted without mountJiniRoutes or requestHookInput',
    );
  }
});
