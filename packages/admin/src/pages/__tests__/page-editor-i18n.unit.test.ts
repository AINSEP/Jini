import { describe, expect, it, vi } from "vitest";

import { createPageEditorTranslator, PAGE_EDITOR_DICT, SCRIPT_BLOCK_DICT } from "../page-editor-i18n.js";

/**
 * @file The Page editor translator's routing, now that the host's common dictionary and its Posts
 * editor translator are injected rather than imported: each of the five branches (script-block copy,
 * shared editor vocabulary, editor controls, markup copy, hook copy) and the fallback chain.
 */

const COMMON = { de: { Save: "Speichern (common)" } };

describe("createPageEditorTranslator", () => {
  it("sends exactly the shared editor vocabulary to the injected translator", () => {
    const sharedEditorTranslator = vi.fn(({ locale, key }: { locale: string; key: string }) => `shared:${locale}:${key}`);
    const t = createPageEditorTranslator({ commonDictionary: COMMON }, { sharedEditorTranslator });

    expect(t({ locale: "de", key: "Back" })).toBe("shared:de:Back");
    expect(t({ locale: "ja", key: "No changes found · nothing new saved (version {version})" })).toBe(
      "shared:ja:No changes found · nothing new saved (version {version})",
    );
    expect(t({ locale: "de", key: "Saved" })).toBe(PAGE_EDITOR_DICT.de?.Saved);
    expect(sharedEditorTranslator).toHaveBeenCalledTimes(2);
  });

  it("resolves the script-block, control, markup and hook branches from this module's dictionaries", () => {
    const t = createPageEditorTranslator({ commonDictionary: COMMON }, { sharedEditorTranslator: () => "unused" });

    expect(t({ locale: "de", key: "Canvas" })).toBe(SCRIPT_BLOCK_DICT.de?.Canvas);
    expect(t({ locale: "de", key: "Canvas" })).toBe("Leinwand");
    expect(t({ locale: "ja", key: "Desktop" })).toBe("デスクトップ");
    expect(t({ locale: "de", key: "Load latest" })).toBe("Neueste Version laden");
    expect(t({ locale: "ja", key: "Saved" })).toBe("保存しました");
  });

  it("falls back to the injected common dictionary, then to the English key", () => {
    const t = createPageEditorTranslator({ commonDictionary: COMMON });

    expect(t({ locale: "de", key: "Save" })).toBe("Speichern (common)");
    expect(t({ locale: "de", key: "totally unknown key" })).toBe("totally unknown key");
    // No shared translator: the shared vocabulary resolves through this module's own chain.
    expect(t({ locale: "de", key: "Back" })).toBe("Back");
  });
});
