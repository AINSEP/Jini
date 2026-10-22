import { describe, expect, it } from 'vitest';
import { createInMemoryPaymentsProvider } from '../payments.js';

describe('createInMemoryPaymentsProvider', () => {
  it('charge() creates a succeeded charge', async () => {
    const payments = createInMemoryPaymentsProvider({});
    const charge = await payments.charge({ amountCents: 1000, currency: 'usd', customerRef: 'cus_1' });
    expect(charge.status).toBe('succeeded');
    expect(charge.amountCents).toBe(1000);
    expect(charge.currency).toBe('usd');
    expect(charge.customerRef).toBe('cus_1');
    expect(charge.id).toBeTypeOf('string');
  });

  it('charge() accepts an optional description without storing it on the record type', async () => {
    const payments = createInMemoryPaymentsProvider({});
    const charge = await payments.charge({ amountCents: 500, currency: 'usd', customerRef: 'cus_1' }, { description: 'widget' });
    expect(charge.amountCents).toBe(500);
  });

  it('charge() rejects a zero or negative amount', async () => {
    const payments = createInMemoryPaymentsProvider({});
    await expect(payments.charge({ amountCents: 0, currency: 'usd', customerRef: 'cus_1' })).rejects.toThrow(/positive/);
    await expect(payments.charge({ amountCents: -5, currency: 'usd', customerRef: 'cus_1' })).rejects.toThrow(/positive/);
  });

  it('getCharge() returns a previously created charge', async () => {
    const payments = createInMemoryPaymentsProvider({});
    const charge = await payments.charge({ amountCents: 1000, currency: 'usd', customerRef: 'cus_1' });
    expect(await payments.getCharge({ id: charge.id })).toEqual(charge);
  });

  it('getCharge() returns null for an unknown id', async () => {
    const payments = createInMemoryPaymentsProvider({});
    expect(await payments.getCharge({ id: 'nope' })).toBeNull();
  });

  it('refund() transitions a succeeded charge to refunded', async () => {
    const payments = createInMemoryPaymentsProvider({});
    const charge = await payments.charge({ amountCents: 1000, currency: 'usd', customerRef: 'cus_1' });
    const refunded = await payments.refund({ id: charge.id });
    expect(refunded.status).toBe('refunded');
    expect(await payments.getCharge({ id: charge.id })).toMatchObject({ status: 'refunded' });
  });

  it('refund() rejects an unknown charge id', async () => {
    const payments = createInMemoryPaymentsProvider({});
    await expect(payments.refund({ id: 'nope' })).rejects.toThrow(/unknown charge/);
  });

  it('refund() rejects a charge that is already refunded', async () => {
    const payments = createInMemoryPaymentsProvider({});
    const charge = await payments.charge({ amountCents: 1000, currency: 'usd', customerRef: 'cus_1' });
    await payments.refund({ id: charge.id });
    await expect(payments.refund({ id: charge.id })).rejects.toThrow(/not refundable/);
  });
});
