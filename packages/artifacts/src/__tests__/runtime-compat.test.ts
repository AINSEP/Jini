import { describe, expect, it } from 'vitest';
import { composeRuntimeCompatNormalizers, noopRuntimeCompatNormalizer, type RuntimeCompatNormalizer } from '../runtime-compat.js';

describe('noopRuntimeCompatNormalizer', () => {
  it('returns the body unchanged', () => {
    expect(noopRuntimeCompatNormalizer({ name: 'index.html', body: 'body' })).toBe('body');
    const obj = { x: 1 };
    expect(noopRuntimeCompatNormalizer({ name: 'index.html', body: obj })).toBe(obj);
  });
});

describe('composeRuntimeCompatNormalizers', () => {
  it('applies each normalizer in order, threading the output forward', () => {
    const appendA: RuntimeCompatNormalizer = ({ body }) => `${body as string}-A`;
    const appendB: RuntimeCompatNormalizer = ({ body }) => `${body as string}-B`;
    const composed = composeRuntimeCompatNormalizers({ normalizers: [appendA, appendB] });
    expect(composed({ name: 'index.html', body: 'start' })).toBe('start-A-B');
  });

  it('with zero normalizers, returns the body unchanged', () => {
    const composed = composeRuntimeCompatNormalizers({ normalizers: [] });
    expect(composed({ name: 'index.html', body: 'unchanged' })).toBe('unchanged');
  });

  it('passes the name through to every normalizer', () => {
    const seen: string[] = [];
    const record: RuntimeCompatNormalizer = ({ name, body }) => {
      seen.push(name);
      return body;
    };
    composeRuntimeCompatNormalizers({ normalizers: [record, record] })({ name: 'a.html', body: 'x' });
    expect(seen).toEqual(['a.html', 'a.html']);
  });
});
