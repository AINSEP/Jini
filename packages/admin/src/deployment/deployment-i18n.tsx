import { ADMIN_COMMON_I18N } from "../core/i18n-common.js";
import { DEPLOYMENT_ES_ID_DE_ZH_CN_ZH_TW_PT_BR } from "./deployment-i18n/deployment-es-id-de-zh-cn-zh-tw-pt-br.js";
import { DEPLOYMENT_RU_FA_AR_JA_KO_PL } from "./deployment-i18n/deployment-ru-fa-ar-ja-ko-pl.js";
import { DEPLOYMENT_HU_FR_UK_TR } from "./deployment-i18n/deployment-hu-fr-uk-tr.js";
import { DEPLOYMENT_TH_IT_HI_UR_BN } from "./deployment-i18n/deployment-th-it-hi-ur-bn.js";
import { DEPLOYMENT_AUDIT_TRANSLATIONS } from "./deployment-i18n/deployment-audit.js";
import { DEPLOYMENT_CANDIDATE_GAP_TRANSLATIONS } from "./deployment-i18n/deployment-candidate-gap.js";
import { DEPLOYMENT_CREDENTIAL_TRANSLATIONS } from "./deployment-i18n/deployment-credential.js";

import { interpolate, localeEntry, createDictionaryTranslator } from '@jini-ai/core/text';
/**
 * @file Translations for the Deployment panel (`/admin/deployment`) — five tabs (Overview, Static
 * Site, Full Site, Dockerfile, History). Same shape as `integrations-i18n.tsx`/`recovery-i18n.tsx`:
 * a flat `DICT[locale][englishKey] = translation` map, `t = createDictionaryTranslator(DICT)`, and
 * two `{error}`-carrying templates handled the same way `actionsForWebhookLabel` handles its own
 * (`interpolate` + a per-locale template map, not embedded in the flat dict).
 *
 * Every string here is chrome/explanatory copy, not data — the actual runtime values (paths, env
 * var names, provider names) are never translated, matching how `AdminExternalMcpServer.serverId`
 * or a webhook's own `label` are rendered verbatim elsewhere in this app.
 */

const DEPLOYMENT_TRANSLATIONS: Record<string, Record<string, string>> = {
  ...DEPLOYMENT_ES_ID_DE_ZH_CN_ZH_TW_PT_BR,
  ...DEPLOYMENT_RU_FA_AR_JA_KO_PL,
  ...DEPLOYMENT_HU_FR_UK_TR,
  ...DEPLOYMENT_TH_IT_HI_UR_BN,
};

const DEPLOYMENT_DICT: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(DEPLOYMENT_TRANSLATIONS).map(([locale, entries]) => [
    locale,
    {
      ...entries,
      ...DEPLOYMENT_AUDIT_TRANSLATIONS[locale],
      ...DEPLOYMENT_CANDIDATE_GAP_TRANSLATIONS[locale],
      ...DEPLOYMENT_CREDENTIAL_TRANSLATIONS[locale],
    },
  ]),
);

/** Per-locale entries a host layers over this dictionary: the strings that name its product, its
 *  owner-password env var or its server. They are keyed exactly as the host's rules and screens look
 *  them up; a locale this dictionary does not cover is ignored, same as before the split. */
export type DeploymentHostDictionary = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * The Deployment screen's translator: this package's dictionary with the host's own entries laid on
 * top per locale (a host entry wins a key collision), falling back to `ADMIN_COMMON_I18N`, then to the
 * English key itself. Same two-step fallback every other `t()` in the admin uses — never a raw
 * dictionary-miss placeholder. Build it once at module level in the host.
 */
export function createDeploymentTranslator({ hostDictionary }: { hostDictionary: DeploymentHostDictionary }, _optional: Record<string, never> = {}) {
  const featureDictionary: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(DEPLOYMENT_DICT).map(([locale, entries]) => [locale, { ...entries, ...hostDictionary[locale] }]),
  );
  return createDictionaryTranslator({ featureDictionary }, { commonDictionary: ADMIN_COMMON_I18N });
}

/**
 * "{count} lines" for the Dockerfile viewer's header.
 *
 * Takes a bound `t` rather than a `locale` and its own per-locale template map (the shape the two
 * error messages below use) because its only caller, `DockerfileSourceViewer`, receives `t` from the
 * hook and has no locale in hand. Routing through the same dictionary keeps the string translatable
 * on exactly the same terms as every other string on these tabs: absent from a locale's map, `t`
 * returns the key itself, and `interpolate` then fills `{count}` in either case.
 *
 * @complexity O(1) — one lookup and one substitution.
 */
export function dockerfileLineCountLabel({ translate, count }: { translate: (key: string) => string; count: number }, _options = {}): string {
  return interpolate({ template: translate("{count} lines"), vars: { count: String(count) } });
}

/** The Overview tab's load-error banner — embeds `describeApiError`'s already-formatted message
 *  mid-sentence, same `interpolate` + per-locale template shape `actionsForWebhookLabel` uses. */
const OVERVIEW_LOAD_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not load deployment status ({error}).",
  es: "No se pudo cargar el estado del despliegue ({error}).",
  id: "Gagal memuat status deployment ({error}).",
  de: "Bereitstellungsstatus konnte nicht geladen werden ({error}).",
  "zh-CN": "无法加载部署状态({error})。",
  "zh-TW": "無法載入部署狀態({error})。",
  "pt-BR": "Não foi possível carregar o status da implantação ({error}).",
  ru: "Не удалось загрузить статус развёртывания ({error}).",
  fa: "بارگذاری وضعیت استقرار ممکن نشد ({error}).",
  ar: "تعذّر تحميل حالة النشر ({error}).",
  ja: "デプロイ状況を読み込めませんでした({error})。",
  ko: "배포 상태를 불러올 수 없습니다({error}).",
  pl: "Nie udało się wczytać stanu wdrożenia ({error}).",
  hu: "Nem sikerült betölteni a telepítési állapotot ({error}).",
  fr: "Impossible de charger l'état du déploiement ({error}).",
  uk: "Не вдалося завантажити стан розгортання ({error}).",
  tr: "Dağıtım durumu yüklenemedi ({error}).",
  th: "ไม่สามารถโหลดสถานะการปรับใช้ได้ ({error})",
  it: "Impossibile caricare lo stato di distribuzione ({error}).",
  hi: "डिप्लॉयमेंट स्थिति लोड नहीं की जा सकी ({error})।",
  ur: "ڈیپلائے منٹ کی حیثیت لوڈ نہیں ہو سکی ({error})۔",
  bn: "ডিপ্লয়মেন্ট অবস্থা লোড করা যায়নি ({error})।",
};

export function deploymentOverviewLoadErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: OVERVIEW_LOAD_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** The Dockerfile tab's load-error banner — same shape as {@link deploymentOverviewLoadErrorMessage}. */
const DOCKERFILE_LOAD_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not load the Dockerfile ({error}).",
  es: "No se pudo cargar el Dockerfile ({error}).",
  id: "Gagal memuat Dockerfile ({error}).",
  de: "Dockerfile konnte nicht geladen werden ({error}).",
  "zh-CN": "无法加载 Dockerfile({error})。",
  "zh-TW": "無法載入 Dockerfile({error})。",
  "pt-BR": "Não foi possível carregar o Dockerfile ({error}).",
  ru: "Не удалось загрузить Dockerfile ({error}).",
  fa: "بارگذاری Dockerfile ممکن نشد ({error}).",
  ar: "تعذّر تحميل Dockerfile ({error}).",
  ja: "Dockerfileを読み込めませんでした({error})。",
  ko: "Dockerfile을 불러올 수 없습니다({error}).",
  pl: "Nie udało się wczytać Dockerfile ({error}).",
  hu: "Nem sikerült betölteni a Dockerfile-t ({error}).",
  fr: "Impossible de charger le Dockerfile ({error}).",
  uk: "Не вдалося завантажити Dockerfile ({error}).",
  tr: "Dockerfile yüklenemedi ({error}).",
  th: "ไม่สามารถโหลด Dockerfile ได้ ({error})",
  it: "Impossibile caricare il Dockerfile ({error}).",
  hi: "Dockerfile लोड नहीं किया जा सका ({error})।",
  ur: "Dockerfile لوڈ نہیں ہو سکا ({error})۔",
  bn: "Dockerfile লোড করা যায়নি ({error})।",
};

export function dockerfileLoadErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: DOCKERFILE_LOAD_ERROR_TEMPLATE, locale }), vars: { error } });
}

/**
 * The Dockerfile tab's SAVE-error banner (2026-08-15, tab went from read-only to editable) — same
 * shape as {@link dockerfileLoadErrorMessage}, distinct template because a failed save and a failed
 * load are different failures a reader needs to tell apart (the source they were looking at is
 * still fine; the edit they just tried to persist is what didn't go through).
 *
 * Translated for the Latin-script locales already covered elsewhere in this pass (es/id/de/fr/it/
 * pt-BR); every other locale falls back to the English template via `?? DOCKERFILE_SAVE_ERROR_TEMPLATE.en`
 * — `createDictionaryTranslator`'s documented, correct degrade path, not a bug. Widening coverage to
 * the remaining locales is tracked as follow-up, not blocking: an English error banner in an
 * otherwise-translated screen is a legible failure state, not a broken one.
 */
const DOCKERFILE_SAVE_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not save the Dockerfile ({error}).",
  es: "No se pudo guardar el Dockerfile ({error}).",
  id: "Gagal menyimpan Dockerfile ({error}).",
  de: "Dockerfile konnte nicht gespeichert werden ({error}).",
  fr: "Impossible d'enregistrer le Dockerfile ({error}).",
  it: "Impossibile salvare il Dockerfile ({error}).",
  "pt-BR": "Não foi possível salvar o Dockerfile ({error}).",
};

export function dockerfileSaveErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: DOCKERFILE_SAVE_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** The Static Site tab's export-status LOAD-error banner (the initial `GET .../system/export` this
 *  hook reads on mount to seed `run` — see `use-static-export.hooks.ts`'s header) — distinct from
 *  {@link exportTriggerErrorMessage}, same split `dockerfileLoadErrorMessage`/
 *  `dockerfileSaveErrorMessage` draw for the Dockerfile tab. */
const EXPORT_LOAD_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not load the export status ({error}).",
  es: "No se pudo cargar el estado de la exportación ({error}).",
  id: "Gagal memuat status ekspor ({error}).",
  de: "Der Exportstatus konnte nicht geladen werden ({error}).",
  fr: "Impossible de charger l'état de l'export ({error}).",
  it: "Impossibile caricare lo stato dell'esportazione ({error}).",
  "pt-BR": "Não foi possível carregar o status da exportação ({error}).",
};

export function exportLoadErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: EXPORT_LOAD_ERROR_TEMPLATE, locale }), vars: { error } });
}

/**
 * The Static Site tab's "Build static export" trigger-error banner (2026-08-15, the button went
 * from permanently inert to wired against a real `POST .../system/export`) — same
 * `interpolate`/per-locale-template shape as {@link dockerfileSaveErrorMessage}, and the same
 * partial-locale-coverage precedent that file's own doc comment already establishes as
 * non-blocking. Covers both a genuine server rejection (a malformed request) and the expected `409`
 * from clicking while a run is already in flight — the message itself (`describeApiError`'s
 * `ApiError.message`) already distinguishes the two; this template only wraps it.
 */
const EXPORT_TRIGGER_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not start the export ({error}).",
  es: "No se pudo iniciar la exportación ({error}).",
  id: "Gagal memulai ekspor ({error}).",
  de: "Der Export konnte nicht gestartet werden ({error}).",
  fr: "Impossible de démarrer l'export ({error}).",
  it: "Impossibile avviare l'esportazione ({error}).",
  "pt-BR": "Não foi possível iniciar a exportação ({error}).",
};

export function exportTriggerErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: EXPORT_TRIGGER_ERROR_TEMPLATE, locale }), vars: { error } });
}

/**
 * The Static Site tab's export POLL-error banner — shown only once the poll loop's own bound gives
 * up on a status endpoint it can no longer reach (`use-static-export.hooks.ts`'s `POLL_FAILURE_LIMIT`,
 * 2026-08-15 fix for a defect where poll failures retried forever behind a stuck spinner with no way
 * out). Distinct from {@link exportLoadErrorMessage} (the one-shot initial read) and
 * {@link exportTriggerErrorMessage} (the POST that starts a run) — this is the REPEATED read that
 * keeps a `"running"` run's status current. English-only for now, same partial-locale-coverage
 * precedent {@link exportTriggerErrorMessage} documents.
 */
const EXPORT_POLL_ERROR_TEMPLATE: Record<string, string> = {
  en: "Lost track of this export's status and stopped checking ({error}). It may still be running — try again in a moment.",
};

export function exportPollErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: EXPORT_POLL_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** The Static Site tab's publish-status LOAD-error banner (the initial `GET .../system/publish` this
 *  hook reads on mount to seed `run` — see `use-static-publish.hooks.ts`'s header) — distinct from
 *  {@link publishTriggerErrorMessage}, same split {@link exportLoadErrorMessage}/
 *  `exportTriggerErrorMessage` draw for the export half of this tab. */
const PUBLISH_LOAD_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not load the publish status ({error}).",
  es: "No se pudo cargar el estado de la publicación ({error}).",
  id: "Gagal memuat status publikasi ({error}).",
  de: "Der Veröffentlichungsstatus konnte nicht geladen werden ({error}).",
  fr: "Impossible de charger l'état de la publication ({error}).",
  it: "Impossibile caricare lo stato della pubblicazione ({error}).",
  "pt-BR": "Não foi possível carregar o status da publicação ({error}).",
};

export function publishLoadErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PUBLISH_LOAD_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** The Static Site tab's publish-preview error banner — a failed `GET .../system/publish/preview`
 *  itself (network/auth/500), distinct from `preview.validationError` (a normal, expected outcome
 *  for an incomplete form the preview reports at `200`, not a failure this template covers). Same
 *  partial-locale-coverage precedent as {@link exportTriggerErrorMessage}. */
const PUBLISH_PREVIEW_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not check this target ({error}).",
  es: "No se pudo comprobar este destino ({error}).",
  id: "Gagal memeriksa target ini ({error}).",
  de: "Dieses Ziel konnte nicht geprüft werden ({error}).",
  fr: "Impossible de vérifier cette cible ({error}).",
  it: "Impossibile verificare questa destinazione ({error}).",
  "pt-BR": "Não foi possível verificar este destino ({error}).",
};

export function publishPreviewErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PUBLISH_PREVIEW_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** The Static Site tab's "Publish" trigger-error banner — same shape and same "409 while already
 *  running" coverage as {@link exportTriggerErrorMessage}, kept as its own template (rather than
 *  reused) because a failed EXPORT trigger and a failed PUBLISH trigger are different operations a
 *  reader needs to tell apart, same reasoning `dockerfileSaveErrorMessage`'s own doc gives for not
 *  sharing a template with `dockerfileLoadErrorMessage`. */
const PUBLISH_TRIGGER_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not start the publish ({error}).",
  es: "No se pudo iniciar la publicación ({error}).",
  id: "Gagal memulai publikasi ({error}).",
  de: "Die Veröffentlichung konnte nicht gestartet werden ({error}).",
  fr: "Impossible de démarrer la publication ({error}).",
  it: "Impossibile avviare la pubblicazione ({error}).",
  "pt-BR": "Não foi possível iniciar a publicação ({error}).",
};

export function publishTriggerErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PUBLISH_TRIGGER_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** The Static Site tab's publish POLL-error banner — same split and same 2026-08-15 fix
 *  {@link exportPollErrorMessage} documents for the export half of this tab, applied to
 *  `use-static-publish.hooks.ts`'s own poll loop. English-only for now, same partial-locale-coverage
 *  precedent as that function. */
const PUBLISH_POLL_ERROR_TEMPLATE: Record<string, string> = {
  en: "Lost track of this publish's status and stopped checking ({error}). It may still be running — try again in a moment.",
};

export function publishPollErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PUBLISH_POLL_ERROR_TEMPLATE, locale }), vars: { error } });
}

/**
 * The credential section's LOAD-error banner (`GET .../system/publish/credentials`) — same split
 * {@link publishLoadErrorMessage} draws for the publish run's own initial read. New 2026-08-15;
 * English-only for now, same partial-coverage precedent {@link exportTriggerErrorMessage} documents
 * — an English banner in an otherwise-translated screen degrades legibly, it does not break.
 */
const PUBLISH_CREDENTIALS_LOAD_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not load publish credentials ({error}).",
};

export function publishCredentialsLoadErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PUBLISH_CREDENTIALS_LOAD_ERROR_TEMPLATE, locale }), vars: { error } });
}

/**
 * One provider row's save-error banner (flat per-provider credential list, 2026-08-15 redesign —
 * StaticSiteTab.tsx's `PublishCredentialsSection`). Also carries a rejected VALIDATION failure's
 * `detail` text, routed here by `classifyCredentialSubmitError` (`lib/credential-submit-error.ts`) instead of the
 * generic `describeApiError` fallback — the `{error}` slot reads naturally either way ("a real
 * transport failure" or "the server's own validation reason").
 */
const PUBLISH_CREDENTIAL_SAVE_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not save this token ({error}).",
};

export function publishCredentialSaveErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PUBLISH_CREDENTIAL_SAVE_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** One provider row's re-verify-error banner — same shape as {@link PUBLISH_CREDENTIAL_SAVE_ERROR_TEMPLATE}
 *  one function up, for the separate "Verify" action `CredentialStepDone` (`StaticSiteTab.tsx`) adds
 *  to an already-connected row. Only a genuine transport/request failure reaches this template — the
 *  server's own `status: "invalid" | "unreachable"` outcomes are not errors at this layer, they are a
 *  normal `AdminPublishCredentialVerification` result the row renders directly (see
 *  `use-publish-credentials.hooks.ts`'s `verify` for the split). */
const PUBLISH_CREDENTIAL_VERIFY_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not verify this token ({error}).",
};

export function publishCredentialVerifyErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PUBLISH_CREDENTIAL_VERIFY_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** The "which saved token publishes" picker's failed-switch banner — same shape as
 *  {@link PUBLISH_CREDENTIAL_SAVE_ERROR_TEMPLATE}. Its second sentence is the point: a refused
 *  promotion leaves the server publishing with the token it had, and the picker goes back to showing
 *  that one, so the operator is told the two still agree rather than left to wonder which is live. */
const PUBLISH_CREDENTIAL_SELECT_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not switch the publishing token ({error}). Publishing still uses the one shown.",
};

export function publishCredentialSelectErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PUBLISH_CREDENTIAL_SELECT_ERROR_TEMPLATE, locale }), vars: { error } });
}
