import { expect, it } from 'vitest';
import * as root from '../index.js';

it('the root entry is only a domain marker: it exposes no runtime exports', () => {
  expect(Object.keys(root)).toEqual([]);
});
