import { expect, it } from 'vitest';
import { AdminConfigError } from '../admin-config-error.js';

it('lists every issue as a bullet and freezes a copy of them', () => {
  const issues = ['first problem', 'second problem'];
  const error = new AdminConfigError({ issues });
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe('AdminConfigError');
  expect(error.message).toBe('Invalid admin configuration:\n- first problem\n- second problem');
  issues.push('added later');
  expect(error.issues).toEqual(['first problem', 'second problem']);
  expect(Object.isFrozen(error.issues)).toBe(true);
});
