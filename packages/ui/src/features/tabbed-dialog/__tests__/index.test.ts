import { describe, expect, it } from 'vitest';
import * as TabbedDialogBarrel from '../index.js';

// Smoke-tests the public barrel: every runtime export actually resolves to
// something (catches a typo'd re-export name that `tsc` alone won't always
// flag when the source and barrel drift), and doubles as the only test that
// ever imports `index.ts` itself (its own module-evaluation line is
// otherwise unexercised by tests that import the underlying files directly).
describe('tabbed-dialog barrel', () => {
  it('exports the shell rules, hook, and component', () => {
    expect(typeof TabbedDialogBarrel.findActiveTab).toBe('function');
    expect(typeof TabbedDialogBarrel.resolveInitialActiveTabId).toBe('function');
    expect(typeof TabbedDialogBarrel.useTabbedDialog).toBe('function');
    expect(typeof TabbedDialogBarrel.TabbedDialog).toBe('function');
  });
});
