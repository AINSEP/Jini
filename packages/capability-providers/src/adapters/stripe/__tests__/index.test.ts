import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripePaymentsProvider, StripePaymentsProviderError } from '../index.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stripeCharge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ch_123',
    object: 'charge',
    amount: 1099,
    currency: 'usd',
    customer: 'cus_1',
    status: 'succeeded',
    refunded: false,
    created: 1_700_000_000,
    ...overrides,
  };
}

describe('StripePaymentsProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws at construction when secretKey is empty', () => {
    expect(() => new StripePaymentsProvider({ secretKey: '', fetchFn: vi.fn() })).toThrow(StripePaymentsProviderError);
  });

  it('throws at construction when no fetch implementation is available', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => new StripePaymentsProvider({ secretKey: 'sk_test_x' })).toThrow(/fetch implementation/);
  });

  it('uses globalThis.fetch by default when fetchFn is not supplied', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, stripeCharge()));
    vi.stubGlobal('fetch', fetchSpy);
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x' });
    await provider.getCharge('ch_123');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('charge() rejects a non-positive amount without making a network call', async () => {
    const fetchFn = vi.fn();
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    await expect(provider.charge({ amountCents: 0, currency: 'usd', customerRef: 'cus_1' })).rejects.toThrow(/positive/);
    await expect(provider.charge({ amountCents: -5, currency: 'usd', customerRef: 'cus_1' })).rejects.toThrow(/positive/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('charge() posts a form-encoded body with Basic auth over the secret key, to the real Stripe base URL', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.stripe.com/v1/charges');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Basic ${Buffer.from('sk_test_x:').toString('base64')}`);
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('amount')).toBe('1099');
      expect(body.get('currency')).toBe('usd');
      expect(body.get('customer')).toBe('cus_1');
      expect(body.get('description')).toBe('a widget');
      return jsonResponse(200, stripeCharge({ description: 'a widget' }));
    });
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    const charge = await provider.charge({ amountCents: 1099, currency: 'usd', customerRef: 'cus_1', description: 'a widget' });
    expect(charge).toEqual({
      id: 'ch_123',
      status: 'succeeded',
      amountCents: 1099,
      currency: 'usd',
      customerRef: 'cus_1',
      createdAt: 1_700_000_000_000,
    });
  });

  it('charge() omits the description field entirely when not provided', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.has('description')).toBe(false);
      return jsonResponse(200, stripeCharge());
    });
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    await provider.charge({ amountCents: 1099, currency: 'usd', customerRef: 'cus_1' });
  });

  it('charge() throws a StripePaymentsProviderError carrying Stripe’s error envelope on a non-2xx response', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(402, { error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' } }),
    );
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    const promise = provider.charge({ amountCents: 500, currency: 'usd', customerRef: 'cus_1' });
    await expect(promise).rejects.toThrow('Your card was declined.');
    await expect(promise).rejects.toMatchObject({ status: 402, stripeType: 'card_error', stripeCode: 'card_declined' });
  });

  it('charge() falls back to a generic message when the error response has no error object', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(500, {}));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    await expect(provider.charge({ amountCents: 500, currency: 'usd', customerRef: 'cus_1' })).rejects.toThrow(
      'Stripe request failed (500).',
    );
  });

  it('charge() falls back to a generic message when the error field is present but not an object', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(500, { error: 'not an object' }));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    await expect(provider.charge({ amountCents: 500, currency: 'usd', customerRef: 'cus_1' })).rejects.toThrow(
      'Stripe request failed (500).',
    );
  });

  it('handles a non-JSON, non-2xx response body without throwing an unrelated parse error', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    await expect(provider.charge({ amountCents: 500, currency: 'usd', customerRef: 'cus_1' })).rejects.toThrow(
      'Stripe request failed (502).',
    );
  });

  it('handles a valid-JSON-but-non-object 2xx response body (e.g. a bare number) by treating it as an empty object', async () => {
    const fetchFn = vi.fn(async () => new Response('42', { status: 200 }));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    const charge = await provider.charge({ amountCents: 500, currency: 'usd', customerRef: 'cus_1' });
    expect(charge).toEqual({ id: '', status: 'pending', amountCents: 0, currency: '', customerRef: '', createdAt: expect.any(Number) });
  });

  it('handles a non-JSON 2xx response body by treating it as an empty object', async () => {
    const fetchFn = vi.fn(async () => new Response('not json', { status: 200 }));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    const charge = await provider.charge({ amountCents: 500, currency: 'usd', customerRef: 'cus_1' });
    expect(charge).toEqual({ id: '', status: 'pending', amountCents: 0, currency: '', customerRef: '', createdAt: expect.any(Number) });
  });

  it('getCharge() returns the mapped charge for a known id', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://api.stripe.com/v1/charges/ch_123');
      return jsonResponse(200, stripeCharge());
    });
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    expect(await provider.getCharge('ch_123')).toEqual({
      id: 'ch_123',
      status: 'succeeded',
      amountCents: 1099,
      currency: 'usd',
      customerRef: 'cus_1',
      createdAt: 1_700_000_000_000,
    });
  });

  it('getCharge() returns null for a 404 (unknown charge)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(404, { error: { type: 'invalid_request_error', message: 'No such charge' } }));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    expect(await provider.getCharge('ch_nope')).toBeNull();
  });

  it('getCharge() rethrows a non-404 error', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { error: { type: 'invalid_request_error', message: 'Invalid API key' } }));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_bad', fetchFn });
    await expect(provider.getCharge('ch_123')).rejects.toThrow('Invalid API key');
  });

  it('getCharge() maps refunded:true to status "refunded" even though Stripe leaves status at "succeeded"', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, stripeCharge({ status: 'succeeded', refunded: true })));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    const charge = await provider.getCharge('ch_123');
    expect(charge?.status).toBe('refunded');
  });

  it('getCharge() falls back to "pending" for a status value outside Stripe’s documented enum', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, stripeCharge({ status: 'some_future_status', refunded: false })));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    const charge = await provider.getCharge('ch_123');
    expect(charge?.status).toBe('pending');
  });

  it('refund() posts charge=<id> and returns the charge with status "refunded" on a succeeded Stripe refund', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/charges/ch_123')) return jsonResponse(200, stripeCharge());
      if (url.endsWith('/refunds')) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('charge')).toBe('ch_123');
        return jsonResponse(200, { id: 're_1', object: 'refund', status: 'succeeded', charge: 'ch_123' });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    const refunded = await provider.refund('ch_123');
    expect(refunded).toEqual({
      id: 'ch_123',
      status: 'refunded',
      amountCents: 1099,
      currency: 'usd',
      customerRef: 'cus_1',
      createdAt: 1_700_000_000_000,
    });
  });

  it('refund() treats a "pending" Stripe refund status as accepted (still returns "refunded")', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/charges/ch_123')) return jsonResponse(200, stripeCharge());
      return jsonResponse(200, { id: 're_1', status: 'pending' });
    });
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    expect((await provider.refund('ch_123')).status).toBe('refunded');
  });

  it.each(['failed', 'canceled'])('refund() throws when Stripe reports the refund as %s', async (refundStatus) => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/charges/ch_123')) return jsonResponse(200, stripeCharge());
      return jsonResponse(200, { id: 're_1', status: refundStatus });
    });
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    await expect(provider.refund('ch_123')).rejects.toThrow(new RegExp(refundStatus));
  });

  it('refund() throws for an unknown charge', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(404, { error: { type: 'invalid_request_error', message: 'No such charge' } }));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    await expect(provider.refund('ch_nope')).rejects.toThrow(/unknown charge/);
  });

  it('refund() throws when the charge is not in a refundable state (e.g. already refunded)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, stripeCharge({ refunded: true })));
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn });
    await expect(provider.refund('ch_123')).rejects.toThrow(/not refundable/);
  });

  it('accepts a custom apiBase (trailing slash stripped) for every request', async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://fake-stripe.test/v1/charges/ch_123');
      return jsonResponse(200, stripeCharge());
    });
    const provider = new StripePaymentsProvider({ secretKey: 'sk_test_x', fetchFn, apiBase: 'https://fake-stripe.test/v1/' });
    await provider.getCharge('ch_123');
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
