import { describe, expect, it } from 'vitest';
import { useSettingsDialogShell } from '../../../react/hooks/useSettingsDialogShell.js';
import { useTabbedDialog } from '../../../../../tabbed-dialog/react/hooks/useTabbedDialog.js';

// `useSettingsDialogShell` is a straight re-export of `useTabbedDialog` as of the 2026-08-13
// extraction — no separate implementation exists to duplicate-test. Full behavioral coverage
// (active-tab resolution, sidebar/fullscreen toggles, Escape-to-close, …) now lives once, on
// the generic hook, in `../../../../../tabbed-dialog/__tests__/react/hooks/useTabbedDialog.test.ts`.
describe('useSettingsDialogShell', () => {
  it('is the exact same function as useTabbedDialog, not a separate implementation', () => {
    expect(useSettingsDialogShell).toBe(useTabbedDialog);
  });
});
