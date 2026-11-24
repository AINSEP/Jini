import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { createDictionaryTranslator } from '@jini-ai/core/text';
import { SETTINGS_MEMORY_LOCALES_A } from "./settings-memory-i18n.locales-a.js";
import { SETTINGS_MEMORY_LOCALES_B } from "./settings-memory-i18n.locales-b.js";
/**
 * @file Settings -> Memory tab: the copy `@jini-ai/ui`'s `MemorySettingsPanel` renders (the header
 * card, the "Memories | How it works" switch, `MemoryList`'s empty state, `MemoryHowPanel` and
 * `MemoryHooksPanel`), in all 21 non-English locales.
 *
 * Those components translate through `@jini-ai/ui`'s own `useT()`, which reads the nearest
 * `I18nProvider`. The provider the host's `SettingsUi.tsx` mounts carries `SETTINGS_DIALOG_DICTIONARIES`, and
 * neither that dictionary nor `@jini-ai/core/settings`' has the memory panel's keys, so the whole
 * panel rendered English in every locale. The host's `SettingsUi.tsx` now wraps the panel in a nested
 * `I18nProvider` fed by {@link memoryPanelDictionaries} — the package's existing host-dictionary
 * mechanism, no change to `@jini-ai/ui`. Keys are the package's literal English strings; English
 * itself needs no block (a miss renders the key).
 */

/** All 21 locales, in the original order; locale keys are disjoint, so the spread order is the old literal order. */
const SETTINGS_MEMORY_DICT: Record<string, Record<string, string>> = { ...SETTINGS_MEMORY_LOCALES_A, ...SETTINGS_MEMORY_LOCALES_B };

export const t = createDictionaryTranslator({ featureDictionary: SETTINGS_MEMORY_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

/** Every `t()` key the mounted memory panel renders, as the package spells it. */
const MEMORY_PANEL_KEYS: readonly string[] = [
  "Memory",
  "Control whether saved facts, preferences, and project context are reused in future chats.",
  "Memory view",
  "Memories",
  "How it works",
  "Add memory",
  "Advanced",
  "On",
  "Off",
  "Enable memory",
  "Saved memory",
  "Saved facts, preferences, and project context available to future chats.",
  "saved",
  "All",
  "Clear extraction history",
  "Clear",
  "Refresh",
  "Refreshing",
  "No saved memories yet",
  "Tell the assistant a fact in chat — e.g.",
  "I prefer dark mode",
  "— and it will be saved here automatically.",
  "Onboarding",
  "Brand context",
  "Chat signals",
  "Memory is gathered automatically from profile setup, project and brand extraction, connected apps, and useful facts learned during chats. The saved list below is the review surface; everything else stays quiet unless you open Add or Advanced.",
  "Memory hooks",
  "Fine-tune how memory is captured and used, without turning it off entirely.",
  "Profile injection",
  "Include your saved profile in the prompt.",
  "Query rewrite",
  "Expand short requests into a fuller task brief first.",
  "Self-verify",
  "Check responses against saved rules and report a scorecard.",
  "Chat extraction",
  "Learn new facts and preferences from chat turns.",
];

/**
 * `I18nProvider`-ready dictionaries for the memory panel in `locale`: one entry, the active locale,
 * each key resolved through {@link t} (so a key this file lacks still reaches `ADMIN_COMMON_I18N`, then
 * English). Pass `locale` as the provider's `initialLocale` too.
 *
 * @complexity O(k) in the key count.
 */
export function memoryPanelDictionaries({ locale }: { locale: string }, _options = {}): Record<string, Record<string, string>> {
  return { [locale]: Object.fromEntries(MEMORY_PANEL_KEYS.map((key) => [key, t({ locale: locale, key: key })])) };
}
