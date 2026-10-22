import { expect, it } from 'vitest';
import { applyGuestWebPreferences } from '../electron/navigation-policy/webview-guest-policy.js';

it('preserves the missing-preload diagnostic and leaves preferences untouched on refusal', () => {
  for (const preloadPath of ['', undefined, null, 7]) {
    const webPreferences = { preload: '/old.js', nodeIntegration: true, contextIsolation: false };
    expect(() => applyGuestWebPreferences({
      webPreferences,
      // @ts-expect-error -- exercise invalid runtime callers as well as an empty string.
      preloadPath,
    })).toThrow(new Error('applyGuestWebPreferences: options.preloadPath is required — a guest with no preload has no voice API.'));
    expect(webPreferences).toEqual({ preload: '/old.js', nodeIntegration: true, contextIsolation: false });
  }
});
