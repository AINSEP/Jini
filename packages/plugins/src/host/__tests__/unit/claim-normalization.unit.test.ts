import { describe, expect, it } from 'vitest';
import { normalizeIdentifier, normalizeRoute } from '../../claim-conflicts.js';

/** L2 §4 claim-conflicts: route keys normalise trim/case/slashes/params exactly, and the param
 *  regex is anchored (a segment merely CONTAINING `:` or braces is a literal). */
const ALL = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

describe('normalizeRoute', () => {
  it.each([
    ['GET /a/:id', ['GET /a/:']],
    ['  get   /A//B/  ', ['GET /a/b']],
    ['POST /x/{id}/[slug]', ['POST /x/:/:']],
    ['GET /', ['GET /']],
    ['GET /a/*', ['GET /a/*']],
    ['DELETE a/b', ['DELETE /a/b']],
  ])('%j → %j', (key, expected) => {
    expect(normalizeRoute({ key })).toEqual(expected);
  });
  it.each([['/a'], ['* /a'], ['ANY /a'], ['any /a'], ['  /a  ']])('%j claims every method', (key) => {
    expect(normalizeRoute({ key })).toEqual(ALL.map(method => `${method} /a`));
  });
  it.each([['GET /a/x:id', 'GET /a/x:id'], ['GET /a/{id', 'GET /a/{id'], ['GET /a/id}', 'GET /a/id}'], ['GET /a/[x]y', 'GET /a/[x]y'], ['GET /a/:', 'GET /a/:'], ['GET /a/{}', 'GET /a/{}']])('literal segment %j stays literal', (key, expected) => {
    expect(normalizeRoute({ key })).toEqual([expected]);
  });
  it('routes differing only by parameter name collide; by literal do not', () => {
    expect(normalizeRoute({ key: 'GET /u/:id' })).toEqual(normalizeRoute({ key: 'get /U/{userId}/' }));
    expect(normalizeRoute({ key: 'GET /u/me' })).not.toEqual(normalizeRoute({ key: 'GET /u/:id' }));
  });
});

describe('normalizeIdentifier', () => {
  it('trims and lower-cases', () => {
    expect(normalizeIdentifier({ key: '  Foo_Bar ' })).toEqual(['foo_bar']);
  });
});
