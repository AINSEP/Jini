import { ADMIN_COMMON_I18N } from "../core/i18n-common.js";
import { SOURCE_CONTROL_ES_TO_KO } from "./source-control-i18n/source-control-es-to-ko.js";
import { SOURCE_CONTROL_PL_TO_BN } from "./source-control-i18n/source-control-pl-to-bn.js";

import { interpolate, localeEntry, createDictionaryTranslator, type LocaleDictionary } from '@jini-ai/core/text';
/**
 * @file Translations for the Source Control page (`/admin/source-control`). Same shape as
 * `@jini-ai/admin/deployment/deployment-i18n`: a flat `DICT[locale][englishKey] = translation` map, `t =
 * createDictionaryTranslator(DICT)`, and two `{error}`-carrying templates handled the same way that
 * file's own `publishCredentialsLoadErrorMessage`/`publishCredentialSaveErrorMessage` are — English
 * only, mirroring that exact same file's own documented "partial-coverage precedent" for its two
 * newest, most-recently-added error templates: an English banner in an otherwise-translated screen
 * degrades legibly (falls back through `createDictionaryTranslator`'s own `?? key` chain), it does
 * not break. The duplicate-label and generic-error strings are fully translated because they show
 * directly in credential rows.
 *
 * Every OTHER string here — headings, field labels, hints — gets the full locale set this app's nav
 * and every other stable feature dictionary carries, since those are read on every visit, not just
 * an error path. A host's own scope guidance is not here: its plugin ships it with its translations
 * (the host's `lib/descriptor-i18n.ts`). Entries that name the host's product arrive through
 * `createSourceControlTranslator`'s `hostDictionary`.
 */

const SOURCE_CONTROL_TRANSLATIONS: Record<string, Record<string, string>> = {
  ...SOURCE_CONTROL_ES_TO_KO,
  ...SOURCE_CONTROL_PL_TO_BN,
};

const ACCESS_TOKEN_LINK_TRANSLATIONS: Record<string, Record<string, string>> = {
  es: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "¿Necesitas guardar más de un token, cambiarle el nombre a uno o administrar todas las credenciales guardadas en un solo lugar?", "Create access token": "Crear token de acceso" },
  id: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Perlu menyimpan lebih dari satu token, mengganti namanya, atau mengelola semua kredensial tersimpan di satu tempat?", "Create access token": "Buat token akses" },
  de: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Möchten Sie mehr als ein Token speichern, eines umbenennen oder alle gespeicherten Zugangsdaten an einem Ort verwalten?", "Create access token": "Zugriffstoken erstellen" },
  "zh-CN": { "Need to save more than one token, rename one, or manage every saved credential in one place?": "需要保存多个令牌、重命名令牌，或在一个地方管理所有已保存的凭据吗？", "Create access token": "创建访问令牌" },
  "zh-TW": { "Need to save more than one token, rename one, or manage every saved credential in one place?": "需要儲存多個權杖、重新命名權杖，或在同一處管理所有已儲存的認證嗎？", "Create access token": "建立存取權杖" },
  "pt-BR": { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Precisa salvar mais de um token, renomear um ou gerenciar todas as credenciais salvas em um só lugar?", "Create access token": "Criar token de acesso" },
  ru: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Нужно сохранить несколько токенов, переименовать один или управлять всеми сохранёнными учётными данными в одном месте?", "Create access token": "Создать токен доступа" },
  fa: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "می‌خواهید بیش از یک توکن ذخیره کنید، نام یکی را تغییر دهید یا همهٔ اعتبارنامه‌های ذخیره‌شده را در یک جا مدیریت کنید؟", "Create access token": "ایجاد توکن دسترسی" },
  ar: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "هل تحتاج إلى حفظ أكثر من رمز مميز واحد أو إعادة تسمية أحدها أو إدارة كل بيانات الاعتماد المحفوظة في مكان واحد؟", "Create access token": "إنشاء رمز وصول" },
  ja: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "複数のトークンを保存したり、名前を変更したり、保存済みの認証情報を一か所で管理したりする必要がありますか？", "Create access token": "アクセストークンを作成" },
  ko: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "토큰을 여러 개 저장하거나 이름을 바꾸거나 저장된 모든 자격 증명을 한곳에서 관리해야 하나요?", "Create access token": "액세스 토큰 만들기" },
  pl: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Chcesz zapisać więcej niż jeden token, zmienić nazwę tokenu lub zarządzać wszystkimi zapisanymi poświadczeniami w jednym miejscu?", "Create access token": "Utwórz token dostępu" },
  hu: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Több tokent szeretne menteni, átnevezni egyet, vagy minden mentett hitelesítő adatot egy helyen kezelni?", "Create access token": "Hozzáférési token létrehozása" },
  fr: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Besoin d’enregistrer plusieurs jetons, d’en renommer un ou de gérer tous les identifiants enregistrés au même endroit ?", "Create access token": "Créer un jeton d’accès" },
  uk: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Потрібно зберегти кілька токенів, перейменувати один або керувати всіма збереженими обліковими даними в одному місці?", "Create access token": "Створити токен доступу" },
  tr: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Birden fazla belirteç kaydetmeniz, birinin adını değiştirmeniz veya tüm kayıtlı kimlik bilgilerini tek yerde yönetmeniz mi gerekiyor?", "Create access token": "Erişim belirteci oluştur" },
  th: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "ต้องการบันทึกโทเค็นมากกว่าหนึ่งรายการ เปลี่ยนชื่อ หรือจัดการข้อมูลรับรองที่บันทึกไว้ทั้งหมดในที่เดียวหรือไม่?", "Create access token": "สร้างโทเค็นการเข้าถึง" },
  it: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "Devi salvare più di un token, rinominarne uno o gestire tutte le credenziali salvate in un unico posto?", "Create access token": "Crea token di accesso" },
  hi: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "क्या आपको एक से अधिक टोकन सहेजने, किसी का नाम बदलने या सभी सहेजे गए क्रेडेंशियल एक ही जगह प्रबंधित करने हैं?", "Create access token": "एक्सेस टोकन बनाएँ" },
  ur: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "کیا آپ کو ایک سے زیادہ ٹوکن محفوظ کرنے، کسی کا نام بدلنے، یا تمام محفوظ اسناد ایک جگہ منظم کرنے کی ضرورت ہے؟", "Create access token": "رسائی ٹوکن بنائیں" },
  bn: { "Need to save more than one token, rename one, or manage every saved credential in one place?": "একাধিক টোকেন সংরক্ষণ, কোনোটি পুনঃনামকরণ বা সব সংরক্ষিত পরিচয়পত্র এক জায়গায় পরিচালনা করতে চান?", "Create access token": "অ্যাক্সেস টোকেন তৈরি করুন" },
};

/** The base dictionary with the Access Tokens link copy laid over it per locale (overlay wins a
 *  collision; only the base's locales are kept). Expressed as plain data rather than through the
 *  shell's overlay helper so this feature folder does not reach into the shell domain. */
const SOURCE_CONTROL_DICT: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(SOURCE_CONTROL_TRANSLATIONS).map(([locale, entries]) => [locale, { ...entries, ...ACCESS_TOKEN_LINK_TRANSLATIONS[locale] }]),
);

/** Per-locale entries a host layers over this dictionary: the strings that name its product. They are
 *  keyed exactly as the host's screens look them up; a locale this dictionary does not cover is ignored. */
export type SourceControlHostDictionary = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * The Source Control page's translator: this package's dictionary with the host's own entries laid on
 * top per locale (a host entry wins a key collision), falling back to the common dictionary (default
 * `ADMIN_COMMON_I18N`; a host that composes its own product words over it passes that composition),
 * then to the English key itself. Build it once at module level in the host.
 */
export function createSourceControlTranslator(
  { hostDictionary }: { hostDictionary: SourceControlHostDictionary },
  { commonDictionary = ADMIN_COMMON_I18N }: { commonDictionary?: LocaleDictionary } = {},
) {
  const featureDictionary: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(SOURCE_CONTROL_DICT).map(([locale, entries]) => [locale, { ...entries, ...hostDictionary[locale] }]),
  );
  return createDictionaryTranslator({ featureDictionary }, { commonDictionary });
}

/**
 * The row list's LOAD-error banner (`GET .../system/source-control/credentials`) — English only,
 * mirroring `@jini-ai/admin/deployment/deployment-i18n`'s own `publishCredentialsLoadErrorMessage` and its documented
 * "partial-coverage precedent": an English banner in an otherwise-translated page degrades legibly.
 */
const SOURCE_CONTROL_CREDENTIALS_LOAD_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not load source control connections ({error}).",
};

export function sourceControlCredentialsLoadErrorMessage({ locale, error }: { locale: string; error: string }, _optional = {}): string {
  return interpolate({ template: localeEntry({ table: SOURCE_CONTROL_CREDENTIALS_LOAD_ERROR_TEMPLATE, locale }), vars: { error } }
  );
}

/**
 * One row's save-error banner. Also carries a rejected VALIDATION failure's `detail` text, routed
 * here by `classifyCredentialSubmitError` (the host's `lib/credential-submit-error.ts`) instead of the generic
 * `describeApiError` fallback — same shape `publishCredentialSaveErrorMessage` uses.
 */
const SOURCE_CONTROL_CREDENTIAL_SAVE_ERROR_TEMPLATE: Record<string, string> = {
  en: "Could not save this connection ({error}).",
};

export function sourceControlCredentialSaveErrorMessage({ locale, error }: { locale: string; error: string }, _optional = {}): string {
  return interpolate({ template: localeEntry({ table: SOURCE_CONTROL_CREDENTIAL_SAVE_ERROR_TEMPLATE, locale }), vars: { error } }
  );
}
