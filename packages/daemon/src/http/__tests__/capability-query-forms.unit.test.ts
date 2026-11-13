import { describe, expect, it } from 'vitest';
import { readQuery } from '@jini-ai/http-kit/server-port';
import { parseCapabilityQuery } from '../frontend-sessions.js';

// The stream route moves from Express's `req.query` to `readQuery`; every query spelling a client
// could send must reach the existing capability parser with the same verdict as before.
const capabilities = (search: string) =>
  parseCapabilityQuery({ raw: readQuery({ request: new Request(`http://local/api/frontend-sessions/s1/stream${search}`) }).capability });

describe('capability query forms through readQuery', () => {
  it.each([
    ['?capability=a', ['a']],
    ['?capability=a&capability=b', ['a', 'b']],
    ['?capability[]=a&capability[]=b', ['a', 'b']],
    ['?capability=a&capability[]=b', ['a', 'b']],
    ['?capability[0]=a&capability[1]=b', ['a', 'b']],
    ['', []],
  ])('accepts %s', (search, expected) => {
    expect(capabilities(search)).toEqual(expected);
  });

  it.each(['?capability[x]=a', '?capability[21]=a', '?capability=a&capability[x]=b', '?capability='])('refuses %s', (search) => {
    expect(capabilities(search)).toBeNull();
  });
});
