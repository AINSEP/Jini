import { expect, it } from 'vitest';
import { describeReportedError } from '../../errors.js';
import { redactOperationAttributes } from '../../otel.js';
import { observabilityProviderContract } from '../../provider-contract.js';
import { createNoopObservabilityPort } from '@jini-ai/core/contracts/observability';

it('accepts a real port and refuses anything missing a tracking method', () => {
  expect(observabilityProviderContract.validate({ provider: createNoopObservabilityPort({}) })).toBeUndefined();
  expect(observabilityProviderContract.validate({ provider: { trackRequest() {} } })).toBe('not an ObservabilityPort');
  expect(observabilityProviderContract.validate({ provider: null })).toBe('not an ObservabilityPort');
});

it('hands providers the domain\'s own helpers as context', () => {
  expect(observabilityProviderContract.context.redactOperationAttributes).toBe(redactOperationAttributes);
  expect(observabilityProviderContract.context.describeReportedError).toBe(describeReportedError);
});
