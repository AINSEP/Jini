import type { FormSubmissionRecord } from './types.js';

/** Legacy answers are objects; the versioned array envelope cannot collide with answer names.
 * @returns Answers plus optional import classification, without reinterpreting legacy records.
 * @throws SyntaxError for corrupt stored JSON.
 * @complexity O(JSON bytes), pure. */
export function decodeSubmissionJson({ json }: { json: string }, _optional = {}): Pick<FormSubmissionRecord, 'data' | 'validation'> {
  const stored = JSON.parse(json);
  if (Array.isArray(stored) && stored[0] === '@jini/form-submission/v1') return { data: stored[1], validation: stored[2] };
  return { data: stored };
}
