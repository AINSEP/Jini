import { describe, expect, it } from 'vitest';
import * as NotificationsBarrel from '../index.js';

describe('notifications tab barrel', () => {
  it('exports DEFAULT_NOTIFICATIONS_PREFERENCES and the NotificationsTab component', () => {
    expect(NotificationsBarrel.DEFAULT_NOTIFICATIONS_PREFERENCES).toBeTruthy();
    expect(typeof NotificationsBarrel.NotificationsTab).toBe('function');
  });
});
