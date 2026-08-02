import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACCENT_COLOR, applyAppearanceToDocument } from '../appearance.js';

// `normalizeAccentColor`/`resolveAccentColor`/`ACCENT_SWATCHES` (and
// `accentVars`, this function's other, DOM-free half) are pure and covered
// in this package's own suite
// (packages/ui/src/__tests__/features/appearance/rules.test.ts). This file
// only needs to cover the DOM write `applyAppearanceToDocument` layers on
// top, plus that it still resolves an invalid accent color to the default —
// re-exported here, not reimplemented.
describe('applyAppearanceToDocument', () => {
  function installFakeDocumentElement() {
    const setAttribute = vi.fn();
    const removeAttribute = vi.fn();
    const setProperty = vi.fn();
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute,
        removeAttribute,
        style: { setProperty },
      },
    });
    return { setAttribute, removeAttribute, setProperty };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets data-theme for a valid theme and writes all five accent vars', () => {
    const { setAttribute, removeAttribute, setProperty } = installFakeDocumentElement();

    applyAppearanceToDocument({ theme: 'dark', accentColor: '#ff0000' });

    expect(setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    expect(removeAttribute).not.toHaveBeenCalled();
    expect(setProperty).toHaveBeenCalledWith('--accent', '#ff0000');
    expect(setProperty).toHaveBeenCalledTimes(5);
  });

  it('removes data-theme when theme is omitted (system/auto)', () => {
    const { removeAttribute, setAttribute } = installFakeDocumentElement();

    applyAppearanceToDocument({});

    expect(removeAttribute).toHaveBeenCalledWith('data-theme');
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it('falls back to the default accent color when accentColor is invalid', () => {
    const { setProperty } = installFakeDocumentElement();

    applyAppearanceToDocument({ accentColor: 'garbage' });

    expect(setProperty).toHaveBeenCalledWith('--accent', DEFAULT_ACCENT_COLOR);
  });
});
