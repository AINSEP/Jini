import { expect, test } from 'vitest';
import { planAgentPluginToolGrant } from '../../enable-grants.js';

const declared = { allow: ['models', 'generate'], write: ['generate'] };
const current = { enabled: false, allow: ['existing'], write: [] };

test('sign-in preserves operator lists; explicit owner enable grants exactly the declared additions', () => {
  expect(planAgentPluginToolGrant({ declared, current })).toBeNull();
  expect(planAgentPluginToolGrant({ declared, current }, { reason: 'owner-enable' })).toEqual({ enabled: true, allow: ['existing', 'models', 'generate'], write: ['generate'] });
  expect(current).toEqual({ enabled: false, allow: ['existing'], write: [] });
});

test('empty sign-in grants, re-enables existing grants, and refuses undeclared writes', () => {
  expect(planAgentPluginToolGrant({ declared, current: { enabled: false, allow: [], write: [] } })).toEqual({ enabled: true, ...declared });
  expect(planAgentPluginToolGrant({ declared, current: { enabled: false, ...declared } }, { reason: 'owner-enable' })).toEqual({ enabled: true, ...declared });
  expect(planAgentPluginToolGrant({ declared, current: { enabled: true, ...declared } }, { reason: 'owner-enable' })).toBeNull();
  expect(planAgentPluginToolGrant({ declared: { write: ['surprise'] }, current }, { reason: 'owner-enable' })).toBeNull();
  expect(() => planAgentPluginToolGrant({ declared: { allow: ['models'], write: ['surprise'] }, current }, { reason: 'owner-enable' })).toThrow(/write.*allow/i);
});
