import { expect, it } from 'vitest';
import { evaluateFeatureFlag } from '../feature-flags.js';

it('defaults to disabled and retains explicit false at each layer', () => {
  expect(evaluateFeatureFlag({ key: 'preview' })).toEqual({ enabled: false, source: 'default' });
  expect(evaluateFeatureFlag({ key: 'preview' }, { workspace: false, defaultEnabled: true })).toEqual({ enabled: false, source: 'workspace' });
  expect(evaluateFeatureFlag({ key: 'preview' }, { runtime: false, workspace: true })).toEqual({ enabled: false, source: 'runtime' });
  expect(evaluateFeatureFlag({ key: 'preview' }, { environment: 'false', runtime: true, workspace: true })).toEqual({ enabled: false, source: 'environment' });
});
it.each(['true', '1'])('enables only explicit environment values: %s', environment => {
  expect(evaluateFeatureFlag({ key: 'preview' }, { environment, runtime: false })).toEqual({ enabled: true, source: 'environment' });
});
it.each(['false', '0', '', 'TRUE', 'yes', null, true])('disables malformed or false environment overrides: %j', environment => {
  expect(evaluateFeatureFlag({ key: 'preview' }, { environment, workspace: true }).enabled).toBe(false);
});
it('accepts only booleans from runtime and persisted state', () => {
  expect(evaluateFeatureFlag({ key: 'preview' }, { runtime: 'true', workspace: true })).toEqual({ enabled: false, source: 'runtime' });
  expect(evaluateFeatureFlag({ key: 'preview' }, { workspace: 'true' })).toEqual({ enabled: false, source: 'workspace' });
  expect(evaluateFeatureFlag({ key: 'preview' }, { workspace: true })).toEqual({ enabled: true, source: 'workspace' });
  expect(evaluateFeatureFlag({ key: 'preview' }, { runtime: true })).toEqual({ enabled: true, source: 'runtime' });
});
