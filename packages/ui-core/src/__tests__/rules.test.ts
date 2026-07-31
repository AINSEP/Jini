import { describe, expect, it } from 'vitest';
import { findActiveTab, resolveInitialActiveTabId } from '../rules.js';

const tabs = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
];

describe('resolveInitialActiveTabId', () => {
  it('returns the requested id when present', () => {
    expect(resolveInitialActiveTabId(tabs, 'notifications')).toBe('notifications');
  });

  it('falls back to the first tab when the requested id is missing', () => {
    expect(resolveInitialActiveTabId(tabs, 'does-not-exist')).toBe('appearance');
  });

  it('falls back to the first tab when no id is requested', () => {
    expect(resolveInitialActiveTabId(tabs)).toBe('appearance');
  });

  it('returns null for an empty tab list', () => {
    expect(resolveInitialActiveTabId([], 'anything')).toBeNull();
  });
});

describe('findActiveTab', () => {
  it('finds the tab matching activeTabId', () => {
    expect(findActiveTab(tabs, 'notifications')?.label).toBe('Notifications');
  });

  it('returns undefined when activeTabId is null', () => {
    expect(findActiveTab(tabs, null)).toBeUndefined();
  });

  it('returns undefined when activeTabId matches no tab', () => {
    expect(findActiveTab(tabs, 'missing')).toBeUndefined();
  });
});
