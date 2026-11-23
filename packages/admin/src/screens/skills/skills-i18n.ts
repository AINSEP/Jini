

import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { SKILLS_PAGE_DICT } from "./skills-page-dictionary.js";

import { createDictionaryTranslator } from '@jini-ai/core/text';
/**
 * @file Translations for the Skills page and skill-install confirmation, which
 * renders both on the Skills page and inside the translated chat dock. Before this existed its
 * "Dismiss" button and "Install skill" dialog name were English for every locale (bug 11-02 o2).
 * "Cancel" comes from `ADMIN_COMMON_I18N`. Same lookup shape as `database-i18n.tsx`: feature keys first,
 * shared chrome second, English key on a miss.
 */
const SKILLS_DICT: Record<string, Record<string, string>> = {
  es: { Dismiss: "Descartar", "Install skill": "Instalar habilidad", "Install skill?": "¿Instalar habilidad?", "Review instructions from sources you trust. Installation runs no code.": "Revisa las instrucciones de fuentes en las que confíes. La instalación no ejecuta código.", "Confirm install": "Confirmar instalación" },
  fr: { Dismiss: "Ignorer", "Install skill": "Installer la compétence", "Install skill?": "Installer la compétence ?", "Review instructions from sources you trust. Installation runs no code.": "Vérifiez les instructions provenant de sources fiables. L'installation n'exécute aucun code.", "Confirm install": "Confirmer l'installation" },
  de: { Dismiss: "Schließen", "Install skill": "Skill installieren", "Install skill?": "Skill installieren?", "Review instructions from sources you trust. Installation runs no code.": "Prüfe Anweisungen aus vertrauenswürdigen Quellen. Bei der Installation wird kein Code ausgeführt.", "Confirm install": "Installation bestätigen" },
  it: { Dismiss: "Ignora", "Install skill": "Installa skill", "Install skill?": "Installare la skill?", "Review instructions from sources you trust. Installation runs no code.": "Esamina le istruzioni provenienti da fonti attendibili. L'installazione non esegue codice.", "Confirm install": "Conferma installazione" },
  "pt-BR": { Dismiss: "Dispensar", "Install skill": "Instalar habilidade", "Install skill?": "Instalar habilidade?", "Review instructions from sources you trust. Installation runs no code.": "Revise instruções de fontes confiáveis. A instalação não executa código.", "Confirm install": "Confirmar instalação" },
  id: { Dismiss: "Tutup", "Install skill": "Pasang skill", "Install skill?": "Pasang skill?", "Review instructions from sources you trust. Installation runs no code.": "Tinjau instruksi dari sumber yang Anda percayai. Pemasangan tidak menjalankan kode.", "Confirm install": "Konfirmasi pemasangan" },
  pl: { Dismiss: "Zamknij", "Install skill": "Zainstaluj umiejętność", "Install skill?": "Zainstalować umiejętność?", "Review instructions from sources you trust. Installation runs no code.": "Sprawdzaj instrukcje ze źródeł, którym ufasz. Instalacja nie uruchamia żadnego kodu.", "Confirm install": "Potwierdź instalację" },
  tr: { Dismiss: "Kapat", "Install skill": "Beceri yükle", "Install skill?": "Beceri yüklensin mi?", "Review instructions from sources you trust. Installation runs no code.": "Güvendiğiniz kaynaklardan gelen talimatları inceleyin. Yükleme hiçbir kod çalıştırmaz.", "Confirm install": "Yüklemeyi onayla" },
  hu: { Dismiss: "Bezárás", "Install skill": "Készség telepítése", "Install skill?": "Telepíti a készséget?", "Review instructions from sources you trust. Installation runs no code.": "Tekintse át a megbízható forrásokból származó utasításokat. A telepítés nem futtat kódot.", "Confirm install": "Telepítés megerősítése" },
  ru: { Dismiss: "Закрыть", "Install skill": "Установить навык", "Install skill?": "Установить навык?", "Review instructions from sources you trust. Installation runs no code.": "Проверяйте инструкции из источников, которым доверяете. Установка не запускает код.", "Confirm install": "Подтвердить установку" },
  uk: { Dismiss: "Закрити", "Install skill": "Встановити навичку", "Install skill?": "Встановити навичку?", "Review instructions from sources you trust. Installation runs no code.": "Перевіряйте інструкції з джерел, яким довіряєте. Встановлення не запускає код.", "Confirm install": "Підтвердити встановлення" },
  ar: { Dismiss: "إغلاق", "Install skill": "تثبيت المهارة", "Install skill?": "تثبيت المهارة؟", "Review instructions from sources you trust. Installation runs no code.": "راجع التعليمات الواردة من مصادر تثق بها. لا يشغّل التثبيت أي تعليمات برمجية.", "Confirm install": "تأكيد التثبيت" },
  fa: { Dismiss: "بستن", "Install skill": "نصب مهارت", "Install skill?": "مهارت نصب شود؟", "Review instructions from sources you trust. Installation runs no code.": "دستورالعمل‌های منابع مورد اعتماد خود را بررسی کنید. نصب هیچ کدی اجرا نمی‌کند.", "Confirm install": "تأیید نصب" },
  ur: { Dismiss: "بند کریں", "Install skill": "مہارت انسٹال کریں", "Install skill?": "مہارت انسٹال کریں؟", "Review instructions from sources you trust. Installation runs no code.": "اپنے بھروسے کے ذرائع سے ملنے والی ہدایات کا جائزہ لیں۔ انسٹالیشن کوئی کوڈ نہیں چلاتی۔", "Confirm install": "انسٹال کی تصدیق کریں" },
  hi: { Dismiss: "खारिज करें", "Install skill": "स्किल इंस्टॉल करें", "Install skill?": "स्किल इंस्टॉल करें?", "Review instructions from sources you trust. Installation runs no code.": "भरोसेमंद स्रोतों से मिले निर्देशों की समीक्षा करें। इंस्टॉलेशन कोई कोड नहीं चलाता।", "Confirm install": "इंस्टॉल की पुष्टि करें" },
  bn: { Dismiss: "খারিজ করুন", "Install skill": "স্কিল ইনস্টল করুন", "Install skill?": "স্কিল ইনস্টল করবেন?", "Review instructions from sources you trust. Installation runs no code.": "বিশ্বস্ত উৎসের নির্দেশনা পর্যালোচনা করুন। ইনস্টলেশন কোনো কোড চালায় না।", "Confirm install": "ইনস্টল নিশ্চিত করুন" },
  th: { Dismiss: "ปิด", "Install skill": "ติดตั้งสกิล", "Install skill?": "ติดตั้งสกิลไหม", "Review instructions from sources you trust. Installation runs no code.": "ตรวจสอบคำแนะนำจากแหล่งที่คุณเชื่อถือ การติดตั้งไม่เรียกใช้โค้ดใดๆ", "Confirm install": "ยืนยันการติดตั้ง" },
  ja: { Dismiss: "閉じる", "Install skill": "スキルをインストール", "Install skill?": "スキルをインストールしますか？", "Review instructions from sources you trust. Installation runs no code.": "信頼できる提供元の手順か確認してください。インストール時にコードは実行されません。", "Confirm install": "インストールを確定" },
  ko: { Dismiss: "닫기", "Install skill": "스킬 설치", "Install skill?": "스킬을 설치할까요?", "Review instructions from sources you trust. Installation runs no code.": "신뢰할 수 있는 출처의 지침인지 검토하세요. 설치 시 코드는 실행되지 않습니다.", "Confirm install": "설치 확인" },
  "zh-CN": { Dismiss: "关闭", "Install skill": "安装技能", "Install skill?": "要安装技能吗？", "Review instructions from sources you trust. Installation runs no code.": "请审阅来自可信来源的说明。安装不会运行任何代码。", "Confirm install": "确认安装" },
  "zh-TW": { Dismiss: "關閉", "Install skill": "安裝技能", "Install skill?": "要安裝技能嗎？", "Review instructions from sources you trust. Installation runs no code.": "請檢閱來自可信來源的說明。安裝不會執行任何程式碼。", "Confirm install": "確認安裝" },
};

const dictionary = Object.fromEntries(Object.entries(SKILLS_DICT).map(([locale, confirmation]) => [locale, { ...SKILLS_PAGE_DICT[locale], ...confirmation }]));
export const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary: ADMIN_COMMON_I18N });
