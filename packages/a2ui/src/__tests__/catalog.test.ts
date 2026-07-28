import { describe, expect, it } from 'vitest';
import { callableFromOf, createLabCatalog, isComponentAllowed, isFunctionRegistered } from '../catalog.js';

describe('createLabCatalog', () => {
  it('whitelists exactly the 4 implemented component types', () => {
    const catalog = createLabCatalog();
    expect(isComponentAllowed(catalog, 'Text')).toBe(true);
    expect(isComponentAllowed(catalog, 'Column')).toBe(true);
    expect(isComponentAllowed(catalog, 'Row')).toBe(true);
    expect(isComponentAllowed(catalog, 'Button')).toBe(true);
  });

  it('adversarial: a component type not in the catalog is not allowed (e.g. real basic-catalog types this port does not implement)', () => {
    const catalog = createLabCatalog();
    for (const type of ['Image', 'Icon', 'Video', 'Modal', 'TextField', 'CheckBox', 'DateTimeInput', 'TotallyMadeUp']) {
      expect(isComponentAllowed(catalog, type)).toBe(false);
    }
  });

  it('exposes all three callableFrom values across its function set', () => {
    const catalog = createLabCatalog();
    expect(callableFromOf(catalog, 'adminReset')).toBe('rendererOnly');
    expect(callableFromOf(catalog, 'logServerEvent')).toBe('agentOnly');
    expect(callableFromOf(catalog, 'greetUser')).toBe('rendererOrAgent');
  });

  it('an unregistered function defaults to rendererOnly per the spec (absent == explicit rendererOnly)', () => {
    const catalog = createLabCatalog();
    expect(isFunctionRegistered(catalog, 'nope')).toBe(false);
    expect(callableFromOf(catalog, 'nope')).toBe('rendererOnly');
  });

  it('produces a fresh, independently-mutable catalog on every call', () => {
    const a = createLabCatalog();
    const b = createLabCatalog();
    expect(a.functions).not.toBe(b.functions);
    expect(a.components).not.toBe(b.components);
  });
});
