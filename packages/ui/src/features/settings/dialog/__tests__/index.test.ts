import { describe, expect, it } from 'vitest';
import * as SettingsDialogBarrel from '../index.js';

// Smoke-tests the public barrel: every runtime export actually resolves to
// something (catches a typo'd re-export name that `tsc` alone won't always
// flag when the source and barrel drift), and doubles as the only test that
// ever imports `index.ts` itself (its own module-evaluation line is
// otherwise unexercised by tests that import the underlying files directly).
describe('settings-dialog barrel', () => {
  it('exports the shell rules, hook, and component', () => {
    expect(typeof SettingsDialogBarrel.findActiveTab).toBe('function');
    expect(typeof SettingsDialogBarrel.resolveInitialActiveTabId).toBe('function');
    expect(typeof SettingsDialogBarrel.useSettingsDialogShell).toBe('function');
    expect(typeof SettingsDialogBarrel.SettingsDialogShell).toBe('function');
  });
});
