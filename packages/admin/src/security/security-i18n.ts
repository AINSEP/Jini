import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary, interpolate, localeEntry } from "@jini-ai/core/text";

import { bindDictionaryNames } from "../core/bind-dictionary-names.js";
import { SECURITY_DICT_PART_1 } from "./i18n/security-dict-1.js";
import { SECURITY_DICT_PART_2 } from "./i18n/security-dict-2.js";
import { SECURITY_DICT_PART_3 } from "./i18n/security-dict-3.js";
import { SECURITY_DICT_PART_4 } from "./i18n/security-dict-4.js";
import { SECURITY_DICT_PART_5 } from "./i18n/security-dict-5.js";
import { SECURITY_DICT_PART_6 } from "./i18n/security-dict-6.js";

/** Feature-specific Security copy. Shared chrome such as Save and Cancel falls back to COMMON_I18N. */
const SECURITY_DICT: Record<string, Record<string, string>> = { ...SECURITY_DICT_PART_1, ...SECURITY_DICT_PART_2, ...SECURITY_DICT_PART_3, ...SECURITY_DICT_PART_4, ...SECURITY_DICT_PART_5, ...SECURITY_DICT_PART_6 };


/** What `createSecurityDictionary` returns: the translator plus the helpers that name the product. */
export interface SecurityDictionary {
  t: DictionaryTranslator;
  copyKeysUpgradeMessage: (args: { site: string; t: (key: string) => string }, _options?: object) => string;
  removeDialogTitle: (args: { locale: string; name: string }, _options?: object) => string;
  removeDialogBody: (args: { locale: string; credentialLabel: string; vendor: string }, _options?: object) => string;
  otherCredentialRemoveDialogBody: (args: { locale: string; store: { id: string; purposeLabel: string } }, _options?: object) => string;
}

/** The host binds its commonDictionary and product name once. `t` is the bound translator; the four helpers beside it
 *  are the copy that names the product inside a template or a lookup key, so they close over `productName`. */
export function createSecurityDictionary(
  { commonDictionary, productName }: { commonDictionary: LocaleDictionary; productName: string },
  _optional = {},
): SecurityDictionary {
  const featureDictionary = bindDictionaryNames({ dictionary: SECURITY_DICT, names: { productName } });
  const bindName = (text: string): string => text.split("{productName}").join(productName);
  return {
    t: createDictionaryTranslator({ featureDictionary }, { commonDictionary }),
    copyKeysUpgradeMessage,
    removeDialogTitle,
    removeDialogBody,
    otherCredentialRemoveDialogBody,
  };

  /** One complete template preserves the reviewed upgrade instruction. */
  function copyKeysUpgradeMessage({ site, t }: { site: string; t: (key: string) => string }, _options = {}): string {
    return interpolate({ template: t(bindName("Start {site} once in {productName} to upgrade it, then copy.")), vars: { site } });
  }

  function removeDialogTitle({ locale, name }: { locale: string; name: string }, _options = {}): string {
    return interpolate({ template: bindName(localeEntry({ table: REMOVE_DIALOG_TITLE_TEMPLATE, locale })), vars: { name } });
  }

  function removeDialogBody({ locale, credentialLabel, vendor }: { locale: string; credentialLabel: string; vendor: string }, _options = {}): string {
    return interpolate({ template: bindName(localeEntry({ table: REMOVE_DIALOG_BODY_TEMPLATE, locale })), vars: { credentialLabel, vendor } });
  }

  /** The Tier-2 Remove dialog's body, per store — the non-replaceable `external-mcp` store gets its own
   *  wording (above), the other three keep {@link removeDialogBody} with `purposeLabel` for both
   *  placeholders, exactly as before (Tier 2 has no vendor/destination split — its deep links go to
   *  {productName}'s own screens). @complexity O(1). */
  function otherCredentialRemoveDialogBody({ locale, store }: { locale: string; store: { id: string; purposeLabel: string } }, _options = {}): string {
    if (store.id === "external-mcp") return localeEntry({ table: REMOVE_DIALOG_EXTERNAL_MCP_BODY, locale });
    return removeDialogBody({ locale, credentialLabel: store.purposeLabel, vendor: store.purposeLabel });
  }
}

/** Replace on a project key rewrites the one shared row, so every other site using it switches
 *  too; the owner is warned before saving (Opus UI review 2026-10-26 item 2). Null when no other
 *  site uses the key. */
export function sharedKeyReplaceWarning({ usedBy, usedByThisSite, t }: { usedBy?: readonly string[] | undefined; usedByThisSite?: boolean | undefined; t: (key: string) => string }, _options = {}): string | null {
  const others = (usedBy?.length ?? 0) - (usedByThisSite ? 1 : 0);
  if (others < 1) return null;
  if (others === 1) return t("Used by 1 other site; it will use the new token too.");
  return interpolate({ template: t("Used by {count} other sites; they will use the new token too."), vars: { count: String(others) } });
}

const COPY_REASON_TEXT: Record<string, string> = {
  "target-exists": "skipped (already there)", "conflict": "Changed during copy; try again.",
  "source-missing": "Key no longer available; reopen to refresh.",
  "requires-mcp-configuration": "Requires its MCP server configuration.",
  "kind-not-copyable": "This kind cannot be copied.", "source-needs-upgrade": "Finish the source upgrade first.",
  "context": "Incompatible credential context.", "invalid-meta": "Invalid credential metadata.",
  "invalid-record": "Invalid credential record.",
};
/** Only fixed status/reason copy and the server's four-character hint are rendered. */
export function copyKeysResultText({ result, t }: {
  result: import("@jini-ai/admin/security/api/security-api.types").AdminCredentialCopyResult; t: (key: string) => string;
}, _options = {}): string {
  if (result.status === "copied") return t("copied ✓") + (result.last4?.length === 4 ? " …" + result.last4 : "");
  return t(COPY_REASON_TEXT[result.reasonCode ?? ""] ?? "Copying keys failed. Try again.");
}

/** Load error banner — same `{error}`-interpolated template shape
 *  `publishCredentialsLoadErrorMessage`/`sourceControlCredentialsLoadErrorMessage` use. */
const ACCESS_TOKENS_LOAD_ERROR_TEMPLATE: Record<string, string> = {
  en: "Couldn't load saved access tokens: {error}",
};
export function accessTokensLoadErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: ACCESS_TOKENS_LOAD_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** One row's save-error banner — mirrors `publishCredentialSaveErrorMessage`'s exact shape. */
const ACCESS_TOKEN_SAVE_ERROR_TEMPLATE: Record<string, string> = {
  en: "Couldn't save this token: {error}",
};
export function accessTokenSaveErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: ACCESS_TOKEN_SAVE_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** A failed Remove — its own action-specific wording, distinct from
 *  {@link accessTokenSaveErrorMessage}'s "save" copy, so a failed removal never reads as a failed
 *  save (Terra audit MEDIUM finding, 2026-08-19: `removeToken` used to await its API call with no
 *  error handling at all, so a rejected call produced no visible change). */
const ACCESS_TOKEN_REMOVE_ERROR_TEMPLATE: Record<string, string> = {
  en: "Couldn't remove this token: {error}",
};
export function accessTokenRemoveErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: ACCESS_TOKEN_REMOVE_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** A failed "Make default" — same action-specific reasoning as {@link accessTokenRemoveErrorMessage}. */
const ACCESS_TOKEN_MAKE_DEFAULT_ERROR_TEMPLATE: Record<string, string> = {
  en: "Couldn't make this token the default: {error}",
};
export function accessTokenMakeDefaultErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: ACCESS_TOKEN_MAKE_DEFAULT_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** A duplicate-name rejection — this page's own case, since neither origin store's dictionary has a
 *  template naming a PROVIDER + a NAME the way this page's uniqueness check does (`rules.ts`'s
 *  `accessTokenNameTaken`). */
const ACCESS_TOKEN_DUPLICATE_NAME_TEMPLATE: Record<string, string> = {
  en: 'A token named "{name}" already exists for {provider}.',
};
export function accessTokenDuplicateNameMessage({ locale, name, provider }: { locale: string; name: string; provider: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: ACCESS_TOKEN_DUPLICATE_NAME_TEMPLATE, locale }), vars: { name, provider } });
}

/** The Remove confirm dialog's three pieces of copy (`rules.ts`'s own "Remove from {productName}, never
 *  Revoke" load-bearing constraint — `development/todos.md:1208`) — kept as templates rather than
 *  built from `t()` fragments plus raw JSX spans, since the load-bearing FACT here (removing here
 *  does not revoke there) is exactly the kind of sentence that must not fragment across a
 *  flat-dictionary boundary and risk a future translator reordering it into something that drops or
 *  inverts the claim. */
const REMOVE_DIALOG_TITLE_TEMPLATE: Record<string, string> = { en: 'Remove "{name}" from {productName}?' };

/** Two placeholders, not one: `{credentialLabel}` (what the saved row is FOR — `AccessTokenProviderInfo.label`,
 *  e.g. "GitHub Pages") and `{vendor}` (who actually issues/revokes it — `AccessTokenProviderInfo.vendorLabel`,
 *  e.g. "GitHub"). Collapsing both into one `{provider}` placeholder was the owner-reported bug: this
 *  sentence told an operator to revoke "on GitHub Pages", which has no revoke console of its own. See
 *  `rules.ts`'s `AccessTokenProviderInfo.vendorLabel` doc for the full reasoning. */
const REMOVE_DIALOG_BODY_TEMPLATE: Record<string, string> = {
  en: "This deletes {productName}'s saved copy of this {credentialLabel} token. It does NOT revoke the token on {vendor} — it stays valid there until you revoke it yourself.",
};

/** `external-mcp`'s Remove body — the shared {@link removeDialogBody} does not fit: there is no
 *  vendor console to revoke on, and what is lost (a sealed OAuth secret the read API never returns)
 *  cannot be restored. Fully translated, unlike this file's other templates (see its header's KNOWN
 *  GAP): this sentence guards an unrecoverable delete, so it must not degrade to English. */
const REMOVE_DIALOG_EXTERNAL_MCP_BODY: Record<string, string> = {
  en: "This deletes the server and its saved credentials. It can't be undone — you'd have to set it up again, and sign in again if it uses OAuth.",
  es: "Esto elimina el servidor y sus credenciales guardadas. No se puede deshacer: tendrías que configurarlo de nuevo y volver a iniciar sesión si usa OAuth.",
  id: "Ini menghapus server dan kredensial tersimpannya. Tindakan ini tidak dapat dibatalkan — Anda harus menyiapkannya lagi, dan masuk lagi jika menggunakan OAuth.",
  de: "Dadurch werden der Server und seine gespeicherten Zugangsdaten gelöscht. Das lässt sich nicht rückgängig machen – Sie müssten ihn neu einrichten und sich erneut anmelden, falls er OAuth verwendet.",
  "zh-CN": "这会删除该服务器及其已保存的凭据。此操作无法撤销——你需要重新设置它；如果它使用 OAuth，还需要重新登录。",
  "zh-TW": "這會刪除該伺服器及其已儲存的憑證。此操作無法復原——你需要重新設定它；如果它使用 OAuth，還需要重新登入。",
  "pt-BR": "Isso exclui o servidor e as credenciais salvas dele. Não é possível desfazer — você teria que configurá-lo de novo e entrar novamente se ele usar OAuth.",
  ru: "Это удалит сервер и его сохранённые учётные данные. Отменить это нельзя — придётся настроить его заново и снова войти, если он использует OAuth.",
  fa: "این کار سرور و اطلاعات ورود ذخیره‌شده‌اش را حذف می‌کند. قابل بازگشت نیست — باید دوباره آن را راه‌اندازی کنید و اگر از OAuth استفاده می‌کند، دوباره وارد شوید.",
  ar: "سيؤدي هذا إلى حذف الخادم وبيانات الاعتماد المحفوظة الخاصة به. لا يمكن التراجع عن ذلك — سيتعين عليك إعداده من جديد، وتسجيل الدخول مرة أخرى إذا كان يستخدم OAuth.",
  ja: "サーバーと保存済みの認証情報を削除します。元に戻せません。再度使うにはセットアップし直す必要があり、OAuth を使う場合はもう一度サインインが必要です。",
  ko: "서버와 저장된 자격 증명이 삭제됩니다. 되돌릴 수 없습니다. 다시 사용하려면 새로 설정해야 하며, OAuth를 사용하는 경우 다시 로그인해야 합니다.",
  pl: "Spowoduje to usunięcie serwera i jego zapisanych danych uwierzytelniających. Tej operacji nie można cofnąć — trzeba będzie skonfigurować go od nowa i zalogować się ponownie, jeśli używa OAuth.",
  hu: "Ez törli a szervert és a mentett hitelesítő adatait. Nem vonható vissza — újra be kellene állítani, és ha OAuth-ot használ, újra be kellene jelentkezni.",
  fr: "Cela supprime le serveur et ses identifiants enregistrés. Cette action est irréversible : vous devriez le reconfigurer, et vous reconnecter s'il utilise OAuth.",
  uk: "Це видалить сервер і його збережені облікові дані. Скасувати це неможливо — доведеться налаштувати його заново й знову увійти, якщо він використовує OAuth.",
  tr: "Bu işlem sunucuyu ve kayıtlı kimlik bilgilerini siler. Geri alınamaz — yeniden kurmanız ve OAuth kullanıyorsa yeniden oturum açmanız gerekir.",
  th: "การดำเนินการนี้จะลบเซิร์ฟเวอร์และข้อมูลรับรองที่บันทึกไว้ ไม่สามารถเลิกทำได้ — คุณจะต้องตั้งค่าใหม่ และลงชื่อเข้าใช้อีกครั้งหากใช้ OAuth",
  it: "Questa operazione elimina il server e le relative credenziali salvate. Non è reversibile: dovresti configurarlo di nuovo e accedere di nuovo se usa OAuth.",
  hi: "इससे सर्वर और उसके सहेजे गए क्रेडेंशियल हट जाएंगे। इसे पूर्ववत नहीं किया जा सकता — आपको इसे फिर से सेट अप करना होगा, और यदि यह OAuth का उपयोग करता है तो फिर से साइन इन करना होगा।",
  ur: "اس سے سرور اور اس کی محفوظ کردہ اسناد حذف ہو جائیں گی۔ اسے واپس نہیں لیا جا سکتا — آپ کو اسے دوبارہ سیٹ اپ کرنا ہوگا، اور اگر یہ OAuth استعمال کرتا ہے تو دوبارہ سائن ان کرنا ہوگا۔",
  bn: "এটি সার্ভার এবং এর সংরক্ষিত ক্রেডেনশিয়াল মুছে ফেলবে। এটি পূর্বাবস্থায় ফেরানো যাবে না — আপনাকে এটি আবার সেট আপ করতে হবে, এবং OAuth ব্যবহার করলে আবার সাইন ইন করতে হবে।",
};

const REMOVE_DIALOG_LAST_ROW_TEMPLATE: Record<string, string> = {
  en: "This is the only saved {provider} token — after removing it, nothing here will be marked as connected.",
};
export function removeDialogLastRowNote({ locale, provider }: { locale: string; provider: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: REMOVE_DIALOG_LAST_ROW_TEMPLATE, locale }), vars: { provider } });
}

/** site key tab's load-error banner — same `{error}`-interpolated shape as
 *  {@link accessTokensLoadErrorMessage}. */
const SITE_KEY_LOAD_ERROR_TEMPLATE: Record<string, string> = {
  "en": "Couldn't load the site key's status: {error}",
  "es": "No se pudo cargar el estado de la clave del sitio: {error}",
  "de": "Der Status des Website-Schlüssels konnte nicht geladen werden: {error}",
  "fr": "Impossible de charger l'état de la clé du site : {error}",
  "it": "Impossibile caricare lo stato della chiave del sito: {error}",
  "pt-BR": "Não foi possível carregar o estado da chave do site: {error}",
  "pl": "Nie udało się wczytać stanu klucza witryny: {error}",
  "hu": "Nem sikerült betölteni a webhelykulcs állapotát: {error}",
  "tr": "Site anahtarının durumu yüklenemedi: {error}",
  "ru": "Не удалось загрузить состояние ключа сайта: {error}",
  "uk": "Не вдалося завантажити стан ключа сайту: {error}",
  "id": "Tidak dapat memuat status kunci situs: {error}",
  "ar": "تعذر تحميل حالة مفتاح الموقع: {error}",
  "fa": "وضعیت کلید سایت بارگیری نشد: {error}",
  "hi": "साइट कुंजी की स्थिति लोड नहीं हो सकी: {error}",
  "bn": "সাইট কী-এর অবস্থা লোড করা যায়নি: {error}",
  "ur": "سائٹ کی کلید کی حالت لوڈ نہیں ہو سکی: {error}",
  "ja": "サイトキーの状態を読み込めませんでした: {error}",
  "ko": "사이트 키 상태를 불러올 수 없습니다: {error}",
  "th": "โหลดสถานะคีย์เว็บไซต์ไม่ได้: {error}",
  "zh-CN": "无法加载站点密钥状态：{error}",
  "zh-TW": "無法載入網站金鑰狀態：{error}",
};
export function siteKeyLoadErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: SITE_KEY_LOAD_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** site key tab's generic generate-error banner — used only for a `"generic"` failure; a known
 *  409 (`KEY_DEPENDENT_DATA`/`KEY_MISMATCH`/`KEY_INVALID`/`SITE_META_UNREADABLE`/`ALREADY_EXISTS`)
 *  is shown with its own words in `SiteKeyTab.tsx`, not wrapped in this template. */
const SITE_KEY_GENERATE_ERROR_TEMPLATE: Record<string, string> = {
  "en": "Couldn't generate a site key: {error}",
  "es": "No se pudo generar una clave del sitio: {error}",
  "de": "Ein Website-Schlüssel konnte nicht erzeugt werden: {error}",
  "fr": "Impossible de générer une clé du site : {error}",
  "it": "Impossibile generare una chiave del sito: {error}",
  "pt-BR": "Não foi possível gerar uma chave do site: {error}",
  "pl": "Nie udało się wygenerować klucza witryny: {error}",
  "hu": "Nem sikerült webhelykulcsot létrehozni: {error}",
  "tr": "Site anahtarı oluşturulamadı: {error}",
  "ru": "Не удалось создать ключ сайта: {error}",
  "uk": "Не вдалося створити ключ сайту: {error}",
  "id": "Tidak dapat membuat kunci situs: {error}",
  "ar": "تعذر إنشاء مفتاح الموقع: {error}",
  "fa": "کلید سایت ایجاد نشد: {error}",
  "hi": "साइट कुंजी बनाई नहीं जा सकी: {error}",
  "bn": "সাইট কী তৈরি করা যায়নি: {error}",
  "ur": "سائٹ کی کلید بنائی نہیں جا سکی: {error}",
  "ja": "サイトキーを生成できませんでした: {error}",
  "ko": "사이트 키를 생성할 수 없습니다: {error}",
  "th": "สร้างคีย์เว็บไซต์ไม่ได้: {error}",
  "zh-CN": "无法生成站点密钥：{error}",
  "zh-TW": "無法產生網站金鑰：{error}",
};
export function siteKeyGenerateErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: SITE_KEY_GENERATE_ERROR_TEMPLATE, locale }), vars: { error } });
}

/** site key tab's reveal-error banner — same `{error}`-interpolated shape. Unlike generate,
 *  reveal has no known-marker cases to special-case (a reveal either works or fails outright), so
 *  this is the only error template that call site needs. */
const SITE_KEY_REVEAL_ERROR_TEMPLATE: Record<string, string> = {
  "en": "Couldn't reveal the site key: {error}",
  "es": "No se pudo revelar la clave del sitio: {error}",
  "de": "Der Website-Schlüssel konnte nicht angezeigt werden: {error}",
  "fr": "Impossible de révéler la clé du site : {error}",
  "it": "Impossibile mostrare la chiave del sito: {error}",
  "pt-BR": "Não foi possível revelar a chave do site: {error}",
  "pl": "Nie udało się ujawnić klucza witryny: {error}",
  "hu": "Nem sikerült megjeleníteni a webhelykulcsot: {error}",
  "tr": "Site anahtarı gösterilemedi: {error}",
  "ru": "Не удалось показать ключ сайта: {error}",
  "uk": "Не вдалося показати ключ сайту: {error}",
  "id": "Tidak dapat menampilkan kunci situs: {error}",
  "ar": "تعذر إظهار مفتاح الموقع: {error}",
  "fa": "کلید سایت نمایش داده نشد: {error}",
  "hi": "साइट कुंजी दिखाई नहीं जा सकी: {error}",
  "bn": "সাইট কী দেখানো যায়নি: {error}",
  "ur": "سائٹ کی کلید دکھائی نہیں جا سکی: {error}",
  "ja": "サイトキーを表示できませんでした: {error}",
  "ko": "사이트 키를 표시할 수 없습니다: {error}",
  "th": "แสดงคีย์เว็บไซต์ไม่ได้: {error}",
  "zh-CN": "无法显示站点密钥：{error}",
  "zh-TW": "無法顯示網站金鑰：{error}",
};
export function siteKeyRevealErrorMessage({ locale, error }: { locale: string; error: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: SITE_KEY_REVEAL_ERROR_TEMPLATE, locale }), vars: { error } });
}