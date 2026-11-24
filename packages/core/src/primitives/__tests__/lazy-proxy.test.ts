import { describe, expect, it } from 'vitest';

import { createLazyProxy } from '../lazy-proxy.js';

class Doubler {
  n = 2;
  double(): number {
    return this.n * 2;
  }
}

describe('createLazyProxy', () => {
  it('builds the instance on first property read only, once, and binds methods to it', () => {
    let built = 0;
    const proxy = createLazyProxy({ factory: () => { built++; return new Doubler(); } });
    expect(built).toBe(0);
    const { double } = proxy;
    expect(built).toBe(1);
    expect(double()).toBe(4);
    expect(proxy.n).toBe(2);
    expect(built).toBe(1);
  });

  it('answers `in` from the real instance, building it on demand', () => {
    let built = 0;
    const proxy = createLazyProxy({ factory: () => { built++; return { $client: {} }; } });
    expect('$client' in proxy).toBe(true);
    expect('missing' in proxy).toBe(false);
    expect(built).toBe(1);
  });
});
