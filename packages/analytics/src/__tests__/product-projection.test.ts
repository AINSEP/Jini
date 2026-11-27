import { describe, expect, it } from 'vitest';
import { freezeProductEventCatalog, projectDeclaredProductEvent } from '../product/index.js';

const INSTALL = '00000000-0000-4000-8000-000000000001';
const catalog = freezeProductEventCatalog({ catalog: {
  app_started: { launchMode: ['fresh', 'update'] },
  plugin_toggled: { pluginKind: ['cms'], enabled: 'boolean' },
  media_uploaded: { sizeKb: 'number', kind: ['image'] },
  empty_event: {},
} });

describe('freezeProductEventCatalog', () => {
  it('freezes the catalog, every rule set and every enum array', () => {
    expect(Object.isFrozen(catalog)).toBe(true);
    for (const rules of Object.values(catalog)) {
      expect(Object.isFrozen(rules)).toBe(true);
      for (const rule of Object.values(rules)) if (Array.isArray(rule)) expect(Object.isFrozen(rule)).toBe(true);
    }
    expect(catalog.plugin_toggled?.enabled).toBe('boolean');
  });
});

describe('projectDeclaredProductEvent', () => {
  it('keeps declared properties and replaces caller identity with the installation id', () => {
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'plugin_toggled', userId: 'private', properties: { enabled: true, pluginKind: 'cms', pluginId: 'custom-private-name' } } }))
      .toEqual({ name: 'plugin_toggled', userId: INSTALL, properties: { enabled: true, pluginKind: 'cms' } });
  });

  it('omits an enum value outside the allow-list but keeps the event', () => {
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'app_started', userId: 'private', properties: { launchMode: 'private mode' } } }))
      .toEqual({ name: 'app_started', userId: INSTALL, properties: {} });
  });

  it('never coerces: a non-string value for an enum rule is omitted', () => {
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'media_uploaded', userId: 'u', properties: { kind: 1, sizeKb: 3 } } }))
      .toEqual({ name: 'media_uploaded', userId: INSTALL, properties: { sizeKb: 3 } });
  });

  it('refuses the event for an invalid boolean or non-finite number', () => {
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'plugin_toggled', userId: 'u', properties: { enabled: 'yes', pluginKind: 'cms' } } })).toBeUndefined();
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'media_uploaded', userId: 'u', properties: { sizeKb: Number.NaN } } })).toBeUndefined();
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'media_uploaded', userId: 'u', properties: { sizeKb: Number.POSITIVE_INFINITY } } })).toBeUndefined();
  });

  it('preserves explicitly supplied false and zero but does not coerce a numeric string', () => {
    const upload = { name: 'upload_result', userId: 'ignored' };
    const mixedCatalog = freezeProductEventCatalog({ catalog: { upload_result: { sizeKb: 'number', cached: 'boolean' } } });
    expect(projectDeclaredProductEvent({ catalog: mixedCatalog, installationId: INSTALL, event: { ...upload, properties: { sizeKb: 0, cached: false } } }))
      .toEqual({ name: 'upload_result', userId: INSTALL, properties: { sizeKb: 0, cached: false } });
    expect(projectDeclaredProductEvent({ catalog: mixedCatalog, installationId: INSTALL, event: { ...upload, properties: { sizeKb: '0', cached: false } } }))
      .toBeUndefined();
  });

  it('returns empty properties for a declared event without caller properties', () => {
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'empty_event', userId: 'u', properties: { anything: 'x' } } }))
      .toEqual({ name: 'empty_event', userId: INSTALL, properties: {} });
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'app_started', userId: 'u' } }))
      .toEqual({ name: 'app_started', userId: INSTALL, properties: {} });
  });

  it('drops unknown and inherited event names', () => {
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'unknown_event', userId: 'u' } })).toBeUndefined();
    expect(projectDeclaredProductEvent({ catalog, installationId: INSTALL, event: { name: 'toString', userId: 'private' } })).toBeUndefined();
  });

  it('drops every event without an installation id', () => {
    expect(projectDeclaredProductEvent({ catalog, installationId: null, event: { name: 'app_started', userId: 'u' } })).toBeUndefined();
    expect(projectDeclaredProductEvent({ catalog, installationId: '', event: { name: 'app_started', userId: 'u' } })).toBeUndefined();
  });
});
