import { expect, it } from 'vitest';
import { moneyProblem } from '../../money/money.js';
import { paymentError } from '../contract/provider.js';
import { paymentsProviderContract } from '../provider-contract.js';

it('hands providers the kernel\'s own error and money helpers as context', () => {
  expect(paymentsProviderContract.context.paymentError).toBe(paymentError);
  expect(paymentsProviderContract.context.moneyProblem).toBe(moneyProblem);
});
