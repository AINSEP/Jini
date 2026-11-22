import { describe, expect, it } from 'vitest';
import { resolveTrustProxySetting } from '../trust-proxy.js';

describe('resolveTrustProxySetting', () => {
  it('trusts no proxy when nothing is set', () => {
    expect(resolveTrustProxySetting({ override: undefined })).toBe(false);
  });
  it('uses the platform hop count only when the override is empty', () => {
    let reads = 0;
    const platformHops = () => { reads++; return 1; };
    expect(resolveTrustProxySetting({ override: '' }, { platformHops })).toBe(1);
    expect(resolveTrustProxySetting({ override: '2' }, { platformHops })).toBe(2);
    expect(reads).toBe(1);
  });
  it('lets the override turn the platform default off, or name addresses', () => {
    const platformHops = () => 1;
    for (const off of ['false', '0', 'OFF', 'no']) expect(resolveTrustProxySetting({ override: off }, { platformHops })).toBe(false);
    expect(resolveTrustProxySetting({ override: ' loopback, 10.0.0.0/8 ' })).toBe('loopback, 10.0.0.0/8');
  });
  it("refuses 'true', naming the setting and the server", () => {
    expect(() => resolveTrustProxySetting({ override: 'true' }, { overrideName: 'APP_TRUST_PROXY', serverLabel: 'the app' })).toThrow(
      'APP_TRUST_PROXY="true" would trust X-Forwarded-For from any client. Set the number of proxy hops in front of the app (e.g. 1), or a list of proxy addresses/subnets.',
    );
  });
});
