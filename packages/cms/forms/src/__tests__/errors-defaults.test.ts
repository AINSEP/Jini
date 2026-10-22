import { expect, it } from 'vitest';
import { FormFieldValidationError, FormSubmissionValidationError } from '../errors.js';

it.each([FormFieldValidationError, FormSubmissionValidationError])('%s defaults message-only validation errors to an independent empty list', (ErrorType) => {
  const first = new ErrorType({ message: 'invalid' });
  const second = new ErrorType({ message: 'another invalid value', fieldErrors: undefined });
  expect(first).toBeInstanceOf(Error);
  expect(first.message).toBe('invalid');
  expect(first.fieldErrors).toEqual([]);
  expect(second.fieldErrors).toEqual([]);
  expect(first.fieldErrors).not.toBe(second.fieldErrors);
  first.fieldErrors.push({ field: 'name', reason: 'missing' });
  expect(second.fieldErrors).toEqual([]);
});

it.each([FormFieldValidationError, FormSubmissionValidationError])('%s preserves caller-supplied field details', (ErrorType) => {
  const fieldErrors = [{ field: 'email', reason: 'required' }];
  expect(new ErrorType({ message: 'invalid', fieldErrors }).fieldErrors).toBe(fieldErrors);
});
