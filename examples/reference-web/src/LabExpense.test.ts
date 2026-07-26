import { describe, expect, it } from 'vitest';

import {
  EMPTY_EXPENSE_FORM,
  EXPENSE_CLAIMS,
  expenseTotal,
  findExpenseErrors,
  type ExpenseForm,
} from './LabExpense.js';

/**
 * The workflow's rules, tested without a browser.
 *
 * These are what make the lab a real exercise rather than a demo: the form has to refuse things
 * for reasons an agent can only discover by reading state back. If the rules were wrong, a run
 * that "passed" would prove nothing.
 */

const VALID: ExpenseForm = {
  vendor: 'Atlas Hardware',
  amount: '120.00',
  category: 'equipment',
  justification: '',
};

describe('findExpenseErrors', () => {
  it('accepts a complete small claim with no justification', () => {
    expect(findExpenseErrors(VALID)).toEqual({});
  });

  it('names every missing field rather than reporting one generic failure', () => {
    // An agent that has to parse "the form is invalid" cannot tell what to fix.
    expect(findExpenseErrors(EMPTY_EXPENSE_FORM)).toEqual({
      vendor: 'Vendor is required.',
      amount: 'Amount is required.',
      category: 'Choose a category.',
    });
  });

  it('rejects an amount that is not a positive number', () => {
    for (const amount of ['0', '-5', 'abc']) {
      expect(findExpenseErrors({ ...VALID, amount }).amount)
        .toBe('Amount must be a positive number.');
    }
  });

  it('treats whitespace as absent rather than as a value', () => {
    expect(findExpenseErrors({ ...VALID, vendor: '   ' }).vendor).toBe('Vendor is required.');
  });

  it('demands a justification only once the amount crosses the threshold', () => {
    // The rule the agent cannot see coming: it appears *after* a fill that looked complete,
    // which is the whole point of making the surface readable after a write.
    expect(findExpenseErrors({ ...VALID, amount: '1000' }).justification).toBeUndefined();
    expect(findExpenseErrors({ ...VALID, amount: '1000.01' }).justification)
      .toBe('Claims over 1000 need a justification of at least 20 characters.');
  });

  it('accepts a large claim once the justification is long enough', () => {
    const long = { ...VALID, amount: '1180.50', justification: 'Replacement bench power supply for the hardware lab.' };
    expect(findExpenseErrors(long)).toEqual({});
    const short = { ...VALID, amount: '1180.50', justification: 'Needed it.' };
    expect(findExpenseErrors(short).justification).toBeDefined();
  });
});

describe('expenseTotal', () => {
  it('adds tax to a valid amount', () => {
    expect(expenseTotal('100')).toBe('120.00');
    expect(expenseTotal('1180.50')).toBe('1416.60');
  });

  it('reports an em dash rather than NaN for anything not yet a positive number', () => {
    for (const amount of ['', '   ', 'abc', '0', '-1']) {
      expect(expenseTotal(amount)).toBe('—');
    }
  });
});

describe('the claim queue', () => {
  it('flags exactly one claim, so the row to act on has to be read rather than guessed', () => {
    const flagged = EXPENSE_CLAIMS.filter((claim) => claim.status === 'flagged');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.id).toBe('atlas-hardware');
  });

  it('gives the flagged claim an amount over the justification threshold', () => {
    // Otherwise the workflow never reaches the interesting failure and the test is hollow.
    const flagged = EXPENSE_CLAIMS.find((claim) => claim.status === 'flagged')!;
    expect(Number(flagged.amount)).toBeGreaterThan(1000);
  });

  it('publishes no claim whose vendor name reveals its status', () => {
    for (const claim of EXPENSE_CLAIMS) {
      expect(claim.vendor.toLowerCase()).not.toContain(claim.status);
    }
  });
});
