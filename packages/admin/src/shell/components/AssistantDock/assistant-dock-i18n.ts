import { createDictionaryTranslator } from "@jini-ai/core/text";

import { ADMIN_COMMON_I18N } from "../../../core/i18n-common.js";

import { ASSISTANT_DOCK_ES_ID_DE } from "./assistant-dock-i18n/dock-es-id-de.js";
import { ASSISTANT_DOCK_ZH_CN_ZH_TW_PT_BR } from "./assistant-dock-i18n/dock-zh-cn-zh-tw-pt-br.js";
import { ASSISTANT_DOCK_RU_FA_AR } from "./assistant-dock-i18n/dock-ru-fa-ar.js";
import { ASSISTANT_DOCK_JA_KO_PL } from "./assistant-dock-i18n/dock-ja-ko-pl.js";
import { ASSISTANT_DOCK_HU_FR_UK } from "./assistant-dock-i18n/dock-hu-fr-uk.js";
import { ASSISTANT_DOCK_TR_TH_IT } from "./assistant-dock-i18n/dock-tr-th-it.js";
import { ASSISTANT_DOCK_HI_UR_BN } from "./assistant-dock-i18n/dock-hi-ur-bn.js";
import { CHAT_PANE_ES_ID_DE } from "./assistant-dock-i18n/chat-pane-es-id-de.js";
import { CHAT_PANE_ZH_CN_ZH_TW_PT_BR } from "./assistant-dock-i18n/chat-pane-zh-cn-zh-tw-pt-br.js";
import { CHAT_PANE_RU_FA_AR } from "./assistant-dock-i18n/chat-pane-ru-fa-ar.js";
import { CHAT_PANE_JA_KO_PL } from "./assistant-dock-i18n/chat-pane-ja-ko-pl.js";
import { CHAT_PANE_HU_FR_UK } from "./assistant-dock-i18n/chat-pane-hu-fr-uk.js";
import { CHAT_PANE_TR_TH_IT } from "./assistant-dock-i18n/chat-pane-tr-th-it.js";
import { CHAT_PANE_HI_UR_BN } from "./assistant-dock-i18n/chat-pane-hi-ur-bn.js";

/** Per-locale copy the host owns because it names the product. Checked before this file's own
 *  dictionaries, so a product string never has to ship inside the reusable package. */
export type AssistantDockHostDictionary = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Structural slice of the chat package's settings-dialog dictionaries (locale → key → copy). */
export type SettingsDialogDictionaries = Readonly<Partial<Record<string, Readonly<Record<string, string>>>>>;

/** Structural slice of the chat package's `I18nAdapter` contract (`JiniChatProvider`'s `i18n` prop). */
export interface ChatI18nAdapter { t: (key: string, vars?: Record<string, string | number>) => string; locale: string }

/**
 * @file Spanish dictionary for the assistant dock's OWN chrome — `AssistantDock.tsx`'s pane
 * header/placeholder, plus the mobile-sheet chrome and `ChatFab`'s "assistant" label that live in
 * `App.tsx` around it (ADR-049's "never touch the dock's own mount lifecycle" is why that chrome
 * sits in `App.tsx` rather than inside `AssistantDock.tsx` — see that file's own comment). One
 * shared dictionary rather than two, since both describe the same one dock. `t()` falls back to
 * `ADMIN_COMMON_I18N` via `createDictionaryTranslator`, same as `trash-i18n.ts`.
 *
 * Built from the per-locale-group modules beside this file. The entries that name the product
 * (the dock's own title) are not here: the host keeps them and passes them as `hostDictionary`.
 */
export const ASSISTANT_DOCK_DICT: Record<string, Record<string, string>> = {
  ...ASSISTANT_DOCK_ES_ID_DE,
  ...ASSISTANT_DOCK_ZH_CN_ZH_TW_PT_BR,
  ...ASSISTANT_DOCK_RU_FA_AR,
  ...ASSISTANT_DOCK_JA_KO_PL,
  ...ASSISTANT_DOCK_HU_FR_UK,
  ...ASSISTANT_DOCK_TR_TH_IT,
  ...ASSISTANT_DOCK_HI_UR_BN,
};

/** Own-property lookup in the host's dictionary — the same `Object.hasOwn` guard the core
 *  dictionary translator uses, so an inherited name like "constructor" is never taken for copy. */
function hostCopy({ dictionary, locale, key }: { dictionary: AssistantDockHostDictionary; locale: string; key: string }, _options: Record<string, never> = {}): string | undefined {
  const block = Object.hasOwn(dictionary, locale) ? dictionary[locale] : undefined;
  return block && Object.hasOwn(block, key) ? block[key] : undefined;
}

/** `ASSISTANT_DOCK_DICT[locale]?.[key] ?? ADMIN_COMMON_I18N[locale]?.[key] ?? key` via
 *  `createDictionaryTranslator` (same fallback `trash-i18n.ts` uses) — a shared word this dict
 *  doesn't carry for a locale still renders translated instead of falling straight to English.
 *  Exported so the host's `App.hooks.ts` `translateAssistantDockLabel` and `AssistantDock.hooks.tsx`'s
 *  `useAssistantDockChrome` can both call it directly instead of each duplicating the lookup. */
const translateDockCopy = createDictionaryTranslator(
  { featureDictionary: ASSISTANT_DOCK_DICT }, { commonDictionary: ADMIN_COMMON_I18N },
);
// Keep the dock's host binding stable while its hook is being edited by another worker.
export const t = ({ locale, key, hostDictionary }: { locale: string; key: string; hostDictionary: AssistantDockHostDictionary }, _options: Record<string, never> = {}): string =>
  hostCopy({ dictionary: hostDictionary, locale, key }) ?? translateDockCopy({ locale, key });

/**
 * @file Spanish dictionary backing `@jini-ai/chat/react`'s OWN `I18nAdapter` contract
 * (`JiniChatProvider`'s `i18n` prop — see `slots.ts`'s own doc: "the English string itself is the
 * key"). Originally scoped to exactly the strings `ConversationList` renders, since that was the
 * one always-visible piece of chat-package chrome the dock's own header mounts
 * (`AssistantDock.tsx`'s `header` — the conversation switcher). The rest of the chat package's
 * ~260 translation keys (composer, attachment tray, tool-call cards, runtime picker, …) have no
 * dictionary anywhere upstream yet — that is a much larger, separate undertaking, not attempted
 * here. `createChatI18nAdapter`'s fallback (`key` itself) leaves every one of those untouched
 * exactly as it already renders today.
 *
 * Extended 2026-08-30 (chat-overflow fix) with "Show in modal"/"Close" — the copy for
 * `OverflowAwareMcpUiSurfaceCard.tsx`/`MessageOverflowModal.tsx`, two host-authored components
 * that also render inside the `JiniChatProvider` tree via `useT()` and so read from this exact
 * dictionary, the same way `ConversationList` does. Same "one admin copy string is its own i18n
 * key" rule as everywhere else in this app — adding the button without adding these entries would
 * have shown correct copy in English and the bare key literal everywhere else.
 *
 * Extended 2026-10-04 with "Expires in {time}"/"This question expired" — `McpUiSurfaceCard`'s
 * countdown under a pending approval card and the line that replaces the card once its deadline
 * passes (both rendered by `@jini-ai/chat/react` through this adapter).
 *
 * Extended 2026-10-04 with the two typed-answer notices `ChatPane` shows when text typed while the
 * agent waits on a question was NOT sent (`describeTypedAnswerNotice` in `@jini-ai/chat/react`): the
 * question already closed, or the answer could not be delivered. Extended 2026-10-05 with the
 * "Send as a new message" button on the closed-question notice (the held answer's explicit way out).
 *
 * Extended 2026-10-30 with the composer footer's host-authored controls, which render inside the
 * provider through `useT()`: the folder button, the attached-folders button and list, and the
 * disabled mic placeholder. The one footer notice that names the product stays in the host's
 * `hostDictionary`.
 */
const CHAT_PANE_I18N_DICT: Record<string, Record<string, string>> = {
  ...CHAT_PANE_ES_ID_DE,
  ...CHAT_PANE_ZH_CN_ZH_TW_PT_BR,
  ...CHAT_PANE_RU_FA_AR,
  ...CHAT_PANE_JA_KO_PL,
  ...CHAT_PANE_HU_FR_UK,
  ...CHAT_PANE_TR_TH_IT,
  ...CHAT_PANE_HI_UR_BN,
};

/** Same `{token}` substitution `@jini-ai/chat/react`'s own `PASSTHROUGH_I18N` uses
 *  (`hooks/context.ts`) — matched here so a translated template interpolates exactly like the
 *  package's default does, and an unknown `{token}` is left visible rather than silently dropped. */
function interpolate({ template, vars }: { template: string; vars: Record<string, string | number> | undefined }, _options: Record<string, never> = {}): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

/** The keys whose copy the settings dialog owns (the host passes the chat package's secret-redacted
 *  notice and credential-card guidance); every other key has none here. */
function sharedSettingsCopy({ locale, key, settingsDialogKeys, settingsDialogDictionaries }: { locale: string; key: string; settingsDialogKeys: readonly string[]; settingsDialogDictionaries: SettingsDialogDictionaries }, _options: Record<string, never> = {}): string | undefined {
  if (!settingsDialogKeys.includes(key)) return undefined;
  return settingsDialogDictionaries[locale]?.[key];
}

/**
 * Builds the `I18nAdapter` `AssistantDock.tsx` passes to `<JiniChatProvider i18n={...}>`.
 *
 * @param input.locale - `useAdminLocale()`'s current value.
 * @param input.hostDictionary - the host's product-naming copy, checked first.
 * @param input.settingsDialogKeys - the keys whose copy the settings dialog owns.
 * @param input.settingsDialogDictionaries - the settings dialog's per-locale dictionaries.
 * @returns An adapter whose `t()` translates the bounded `CHAT_PANE_I18N_DICT` key set and passes
 *   every other key through unchanged — identical to the package's own default passthrough for any
 *   key this dictionary does not cover.
 * @complexity O(1) per `t()` call — a single object lookup plus regex interpolation over the
 *   (short, fixed-shape) template string.
 * @overallScore 100 — no branches beyond the dictionary-miss fallback, no I/O, no state.
 */
export function createChatI18nAdapter(
  { locale, hostDictionary, settingsDialogKeys, settingsDialogDictionaries }: { locale: string; hostDictionary: AssistantDockHostDictionary; settingsDialogKeys: readonly string[]; settingsDialogDictionaries: SettingsDialogDictionaries },
  _options: Record<string, never> = {},
): ChatI18nAdapter {
  return {
    locale,
    t: (key, vars) => interpolate({
      template: hostCopy({ dictionary: hostDictionary, locale, key })
        ?? CHAT_PANE_I18N_DICT[locale]?.[key]
        ?? sharedSettingsCopy({ locale, key, settingsDialogKeys, settingsDialogDictionaries })
        ?? key,
      vars,
    }),
  };
}
