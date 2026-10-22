import { expect, it } from 'vitest';
import { FormFieldValidationError, FormSubmissionNotFoundError, FormSubmissionValidationError } from '../errors.js';

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

it('FormSubmissionNotFoundError carries the caller message as a plain Error a host can map to 404', () => {
  const error = new FormSubmissionNotFoundError({ message: "submission 's-1' was not found" });
  expect(error).toBeInstanceOf(Error);
  expect(error).toBeInstanceOf(FormSubmissionNotFoundError);
  expect(error.message).toBe("submission 's-1' was not found");
});
