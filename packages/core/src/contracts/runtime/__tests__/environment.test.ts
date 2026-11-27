import { expect, it } from 'vitest';
import { omitEnvironmentKeys } from '../environment.js';

it.each([
  { caseInsensitive: false, remaining: { Path: '/alternate', HOME_DIR: '/users/demo', Optional: undefined } },
  { caseInsensitive: true, remaining: { HOME_DIR: '/users/demo', Optional: undefined } },
])('copies a child environment with caseInsensitive=$caseInsensitive and reports only configured, defined names',
  ({ caseInsensitive, remaining }) => {
    const parent = Object.freeze({ PATH: '/local/bin', Path: '/alternate', HOME_DIR: '/users/demo', Optional: undefined, UNSET: undefined });
    expect(omitEnvironmentKeys({ env: parent, keys: ['PATH', 'UNSET', 'ABSENT'] }, { caseInsensitive }))
      .toStrictEqual({ env: remaining, omitted: ['PATH'] });
    expect(parent).toStrictEqual({ PATH: '/local/bin', Path: '/alternate', HOME_DIR: '/users/demo', Optional: undefined, UNSET: undefined });
  });

it('defaults to exact matching and does not report alternate spellings', () => {
  expect(omitEnvironmentKeys({ env: { Cache: '/cache' }, keys: ['CACHE'] }))
    .toStrictEqual({ env: { Cache: '/cache' }, omitted: [] });
});
