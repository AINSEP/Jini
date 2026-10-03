import { describe, expect, it, vi } from 'vitest';
import { StripePaymentsProvider } from '../index.js';

describe('universal Stripe adapter effects', () => {
  it('uses browser-safe Basic auth and the injected clock when the response omits created', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Basic c2tfdGVzdF94Og==');
      return {
        ok: true, status: 200,
        json: async () => ({ id: 'ch_1', amount: 100, currency: 'usd', customer: 'cus_1', status: 'succeeded' }),
      } as Response;
    });
    vi.stubGlobal('Buffer', undefined);
    try {
      const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x' }, { fetchFn, now: () => 456 });
      expect((await provider.getCharge({ id: 'ch_1' }))?.createdAt).toBe(456);
      expect(fetchFn).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
