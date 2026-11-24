import { ADMIN_COMMON_I18N } from "../core/i18n-common.js";
import { mergeLocaleOverlays, createDictionaryTranslator } from '@jini-ai/core/text';
import { ROLES_TRANSLATIONS_A } from "./i18n/roles-translations-a.js";
import { ROLES_TRANSLATIONS_B } from "./i18n/roles-translations-b.js";
import { ROLES_TRANSLATIONS_C } from "./i18n/roles-translations-c.js";
/**
 * @file Spanish translation for the Roles & Permissions screen (`Roles.tsx`) — this feature's own
 * dictionary, not the shared `lib/admin-nav-i18n.ts` one, so parallel translation passes over
 * other admin sections can't collide on the same file. Same two-step fallback every other `t()`
 * in this app uses: translated value, else the English source string itself.
 */

const ROLES_TRANSLATIONS: Record<string, Record<string, string>> = {
  ...ROLES_TRANSLATIONS_A,
  ...ROLES_TRANSLATIONS_B,
  ...ROLES_TRANSLATIONS_C,
};

const ROLES_AUDIT_STRINGS: Record<string, Record<string, string>> = {
  es: { Custom: "Personalizado", Permission: "Permiso", Add: "Agregar" },
  id: { Custom: "Kustom", Permission: "Izin", Add: "Tambah" },
  de: { Custom: "Benutzerdefiniert", Permission: "Berechtigung", Add: "Hinzufügen" },
  "zh-CN": { Custom: "自定义", Permission: "权限", Add: "添加" },
  "zh-TW": { Custom: "自訂", Permission: "權限", Add: "新增" },
  "pt-BR": { Custom: "Personalizado", Permission: "Permissão", Add: "Adicionar" },
  ru: { Custom: "Пользовательский", Permission: "Разрешение", Add: "Добавить" },
  fa: { Custom: "سفارشی", Permission: "مجوز", Add: "افزودن" },
  ar: { Custom: "مخصص", Permission: "إذن", Add: "إضافة" },
  ja: { Custom: "カスタム", Permission: "権限", Add: "追加" },
  ko: { Custom: "사용자 지정", Permission: "권한", Add: "추가" },
  pl: { Custom: "Niestandardowe", Permission: "Uprawnienie", Add: "Dodaj" },
  hu: { Custom: "Egyéni", Permission: "Engedély", Add: "Hozzáadás" },
  fr: { Custom: "Personnalisé", Permission: "Autorisation", Add: "Ajouter" },
  uk: { Custom: "Користувацький", Permission: "Дозвіл", Add: "Додати" },
  tr: { Custom: "Özel", Permission: "İzin", Add: "Ekle" },
  th: { Custom: "กำหนดเอง", Permission: "สิทธิ์", Add: "เพิ่ม" },
  it: { Custom: "Personalizzato", Permission: "Autorizzazione", Add: "Aggiungi" },
  hi: { Custom: "कस्टम", Permission: "अनुमति", Add: "जोड़ें" },
  ur: { Custom: "حسب ضرورت", Permission: "اجازت", Add: "شامل کریں" },
  bn: { Custom: "কাস্টম", Permission: "অনুমতি", Add: "যোগ করুন" },
};

const ROLES_DICT: Record<string, Record<string, string>> = mergeLocaleOverlays({ base: ROLES_TRANSLATIONS }, { overlays: [ROLES_AUDIT_STRINGS] });

export const t = createDictionaryTranslator({ featureDictionary: ROLES_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

