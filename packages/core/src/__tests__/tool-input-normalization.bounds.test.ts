import { describe, expect, it } from 'vitest';
import { normalizeToolInput } from '../tool-input-normalization.js';

const registration = (properties: Record<string, unknown>) => ({
  descriptor: { id: 'bounded_tool', inputSchema: { type: 'object', additionalProperties: false, properties } },
});

describe('normalizeToolInput and numeric bounds (today: it never touches a value that is already a number)', () => {
  it('passes a number above its declared maximum through unchanged, with no note', async () => {
    const result = await normalizeToolInput({ input: { limit: 8300 }, registration: registration({ limit: { type: 'integer', minimum: 1, maximum: 8000 } }) });
    expect(result).toEqual({ input: { limit: 8300 }, notes: [] });
  });

  it('turns an integer string into the integer and notes only that coercion', async () => {
    const result = await normalizeToolInput({ input: { limit: '8300' }, registration: registration({ limit: { type: 'integer', minimum: 1, maximum: 8000 } }) });
    expect(result).toEqual({ input: { limit: 8300 }, notes: ['limit: string→integer'] });
  });
});
