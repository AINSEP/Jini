import { describe, expect, it } from 'vitest';
import * as entry from '../index.js';
import * as copyable from '../copyable-details.js';
import * as expandedMode from '../expanded-mode.js';
import * as siteToastView from '../SiteToast.js';
import * as deleteConfirmation from '../use-delete-confirmation.hooks.js';
import * as expandedModeHook from '../use-expanded-mode.hooks.js';
import * as siteToast from '../use-site-toast.hooks.js';
import * as themePreference from '../use-theme-preference.hooks.js';

/** `index.ts` is the published `./app-shell` subpath: a dropped, renamed or re-pointed export is a
 *  breaking change for every host that imports it. */
describe('app-shell public entry', () => {
  it('exposes exactly its runtime surface, each bound to the implementing module', () => {
    const expected = {
      COLLAPSE_KEY: expandedMode.COLLAPSE_KEY,
      chromeVisibility: expandedMode.chromeVisibility,
      expandedAfterKeyDown: expandedMode.expandedAfterKeyDown,
      expandedAfterWorkspaceChange: expandedMode.expandedAfterWorkspaceChange,
      nextExpanded: expandedMode.nextExpanded,
      workspaceOnScreen: expandedMode.workspaceOnScreen,
      useExpandedMode: expandedModeHook.useExpandedMode,
      dismissOnEscape: deleteConfirmation.dismissOnEscape,
      useDeleteConfirmation: deleteConfirmation.useDeleteConfirmation,
      readStoredPreference: themePreference.readStoredPreference,
      useThemePreference: themePreference.useThemePreference,
      AUTO_HIDE_MS: siteToast.AUTO_HIDE_MS,
      AUTO_HIDE_WITH_NOTE_MS: siteToast.AUTO_HIDE_WITH_NOTE_MS,
      toastLifetime: siteToast.toastLifetime,
      useSiteToast: siteToast.useSiteToast,
      SiteToast: siteToastView.SiteToast,
      copyableDetails: copyable.copyableDetails,
    };
    expect(Object.keys(entry).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, value] of Object.entries(expected)) {
      expect(value, name).not.toBeUndefined();
      expect(entry[name as keyof typeof entry], name).toBe(value);
    }
  });
});
