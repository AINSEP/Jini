import { describe, expect, it } from 'vitest';
import { sanitizeUnknownDeep } from '../redact.js';

describe('sanitizeUnknownDeep', () => {
  it('sanitizes string leaves inside a nested object', () => {
    const secret = 'C'.repeat(30);
    const input = { outer: { inner: [`value=${secret}`, 'fine'] } };
    const result = sanitizeUnknownDeep({ value: input }) as { outer: { inner: string[] } };
    expect(result.outer.inner[0]).not.toContain(secret);
    expect(result.outer.inner[1]).toBe('fine');
  });

  it('passes numbers, booleans, and null through unchanged', () => {
    expect(sanitizeUnknownDeep({ value: 42 })).toBe(42);
    expect(sanitizeUnknownDeep({ value: true })).toBe(true);
    expect(sanitizeUnknownDeep({ value: null })).toBeNull();
  });

  it('caps recursion depth with a placeholder instead of recursing forever', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    const result = JSON.stringify(sanitizeUnknownDeep({ value: deep }));
    expect(result).toContain('omitted');
  });

  it('caps array length', () => {
    const input = Array.from({ length: 200 }, (_, i) => i);
    const result = sanitizeUnknownDeep({ value: input }) as unknown[];
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('caps object key count', () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 200; i++) input[`k${i}`] = i;
    const result = sanitizeUnknownDeep({ value: input }) as Record<string, number>;
    expect(Object.keys(result).length).toBeLessThanOrEqual(50);
  });
});
