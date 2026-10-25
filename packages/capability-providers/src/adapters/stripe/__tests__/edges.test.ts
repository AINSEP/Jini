import { describe, expect, it, vi } from 'vitest';
import { StripePaymentsProvider, StripePaymentsProviderError } from '../index.js';

/** Edges of the Stripe adapter (Stryker L6: 18 survivors — status mapping, error-envelope fields,
 * apiBase normalisation, refund failure error, JSON shape guards). */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const charge = (over: Record<string, unknown> = {}) => ({ id: 'ch_1', amount: 500, currency: 'usd', customer: 'cus_1', status: 'succeeded', refunded: false, created: 1_700_000_000, ...over });
function provider(...responses: Response[]) {
  const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => responses.shift() ?? json(500, {}));
  return { p: new StripePaymentsProvider({ secretKey: 'sk_test_1' }, { fetchFn: fetchFn as unknown as typeof fetch, now: () => 42 }), fetchFn };
}

describe('charge status mapping', () => {
  it.each([
    [{ status: 'succeeded' }, 'succeeded'],
    [{ status: 'pending' }, 'pending'],
    [{ status: 'failed' }, 'failed'],
    [{ status: 'succeeded', refunded: true }, 'refunded'],
    [{ status: 'failed', refunded: true }, 'refunded'],
    [{ status: 'succeeded', refunded: 'true' }, 'succeeded'],
    [{ status: 'SUCCEEDED' }, 'pending'],
    [{ status: undefined }, 'pending'],
  ])('%j → %s', async (over, expected) => {
    const { p } = provider(json(200, charge(over)));
    expect((await p.getCharge({ id: 'ch_1' }))?.status).toBe(expected);
  });
});

describe('toCharge shape guards', () => {
  it('maps every field and converts created seconds → ms', async () => {
    const { p } = provider(json(200, charge()));
    expect(await p.getCharge({ id: 'ch_1' })).toEqual({ id: 'ch_1', status: 'succeeded', amountCents: 500, currency: 'usd', customerRef: 'cus_1', createdAt: 1_700_000_000_000 });
  });
  it('wrong-typed fields fall back to safe defaults and the injected clock', async () => {
    const { p } = provider(json(200, { id: 7, amount: '500', currency: 1, customer: null, status: 'succeeded', created: '1700000000' }));
    expect(await p.getCharge({ id: 'ch_1' })).toEqual({ id: '', status: 'succeeded', amountCents: 0, currency: '', customerRef: '', createdAt: 42 });
  });
});

describe('error envelope', () => {
  it('keeps string type/code and drops non-string ones', async () => {
    const { p } = provider(json(402, { error: { message: 'Card declined', type: 'card_error', code: 'card_declined' } }), json(400, { error: { message: '', type: 5, code: {} } }));
    const first = await p.charge({ amountCents: 1, currency: 'usd', customerRef: 'cus_1' }).catch((e) => e);
    expect(first).toBeInstanceOf(StripePaymentsProviderError);
    expect(first).toMatchObject({ message: 'Card declined', status: 402, stripeType: 'card_error', stripeCode: 'card_declined' });
    const second = await p.charge({ amountCents: 1, currency: 'usd', customerRef: 'cus_1' }).catch((e) => e);
    expect(second).toMatchObject({ message: 'Stripe request failed (400).', status: 400 });
    expect(second.stripeType).toBeUndefined();
    expect(second.stripeCode).toBeUndefined();
  });

  it.each([0, -1])('amountCents %i is refused locally with status 400 and no request', async (amountCents) => {
    const { p, fetchFn } = provider();
    await expect(p.charge({ amountCents, currency: 'usd', customerRef: 'cus_1' })).rejects.toMatchObject({ message: 'amountCents must be positive', status: 400 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('an amount of 1 cent is sent', async () => {
    const { p, fetchFn } = provider(json(200, charge({ amount: 1 })));
    await p.charge({ amountCents: 1, currency: 'usd', customerRef: 'cus_1' });
    expect(String(fetchFn.mock.calls[0]?.[1]?.body)).toBe('amount=1&currency=usd&customer=cus_1');
  });
});

describe('refund failure', () => {
  it.each(['failed', 'canceled'])('a %s refund throws status 402 with stripeType api_error', async (status) => {
    const { p } = provider(json(200, charge()), json(200, { status }));
    await expect(p.refund({ id: 'ch_1' })).rejects.toMatchObject({ name: 'StripePaymentsProviderError', status: 402, stripeType: 'api_error', message: `Stripe refund ${status} for charge ch_1` });
  });
  it.each(['pending', 'failed'])('a %s charge is not refundable (400) and no refund is posted', async (status) => {
    const { p, fetchFn } = provider(json(200, charge({ status })));
    await expect(p.refund({ id: 'ch_1' })).rejects.toMatchObject({ status: 400, message: `charge ch_1 is not refundable from status "${status}"` });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('apiBase normalisation and id encoding', () => {
  it('strips every trailing slash and percent-encodes the charge id', async () => {
    const fetchFn = vi.fn(async (_url: string) => json(200, charge()));
    const p = new StripePaymentsProvider({ secretKey: 'sk' }, { fetchFn: fetchFn as unknown as typeof fetch, apiBase: 'https://stripe.test/v1///' });
    await p.getCharge({ id: 'ch/../x' });
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://stripe.test/v1/charges/ch%2F..%2Fx');
  });
});
