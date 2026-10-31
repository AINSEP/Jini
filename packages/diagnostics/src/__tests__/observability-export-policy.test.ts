import { expect, test } from 'vitest';
import { observabilityExportAllowed } from '../observability/index.js';

test.each([
  ['missing evidence', {}, false],
  ['checkout', { development: true }, false],
  ['unpackaged desktop', { packagedDesktop: false }, false],
  ['packaged desktop', { packagedDesktop: true }, true],
  ['deployed production', { deployedProduction: true }, true],
  ['checkout beats production', { development: true, deployedProduction: true }, false],
  ['checkout beats packaging hint', { development: true, packagedDesktop: true }, false],
  ['debug override', { development: true, forceEnable: true }, true],
] as const)('%s', (_name, facts, allowed) => {
  expect(observabilityExportAllowed(facts)).toBe(allowed);
});
