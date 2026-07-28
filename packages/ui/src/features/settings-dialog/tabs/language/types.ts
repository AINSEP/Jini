/**
 * Origin: the inline `language` tab body in `SettingsDialog.tsx` (a
 * radio-tile grid over a fixed locale list), GENERIC per
 * `foundry/docs/jini-port/recon/r6-god-component-internals.md` §1.3. OD's own fixed
 * 19-locale `LOCALES`/`LOCALE_LABEL` tables are product content, not ported
 * — a host supplies its own `LocaleOption[]`, same convention
 * `@jini-ai/ui`'s `features/i18n` already established for
 * `I18nProvider`'s `dictionaries` prop.
 *
 * Reuses the `LocaleOption` shape already shipped for `LanguageMenu`
 * (`{ code, label }`) rather than declaring a near-duplicate — the two
 * components pick from the same kind of host-supplied locale list.
 */
export type { LocaleOption } from '../../../../react/components/LanguageMenu.js';
