/**
 * @file The browser-agent (WebMCP) settings copy: the opt-out toggle's label and hints, the
 * approval prompt and its Confirm button, in every admin locale. Only the dictionary lives here —
 * the host builds its translator from {@link WEBMCP_DICT} with its own dictionary translator and its
 * own common dictionary as the fallback (same two-step as `../../shell/lib/admin-nav-i18n.ts`), so
 * a host-specific common word never ships inside this package.
 */
import type { LocaleDictionary } from '@jini-ai/core/text';

export const WEBMCP_KEYS = [
  "Browser-agent access (WebMCP)",
  "Enabled by default. This choice applies to the admin in this browser on this site.",
  "Compatible browsers can operate tagged admin controls. Destructive and publish actions require approval.",
  "Allow the browser agent to perform this admin action?",
] as const;

const translations: Record<string, readonly [string, string, string, string]> = {
  en: WEBMCP_KEYS,
  es: ["Acceso del agente del navegador (WebMCP)", "Activado por defecto. Esta opción se aplica al administrador de este sitio en este navegador.", "Los navegadores compatibles pueden operar los controles de administración etiquetados. Las acciones destructivas y de publicación requieren aprobación.", "¿Permitir que el agente del navegador realice esta acción de administración?"],
  id: ["Akses agen browser (WebMCP)", "Aktif secara default. Pilihan ini berlaku untuk admin situs ini di browser ini.", "Browser yang kompatibel dapat mengoperasikan kontrol admin bertanda. Tindakan merusak dan penerbitan memerlukan persetujuan.", "Izinkan agen browser melakukan tindakan admin ini?"],
  de: ["Zugriff für Browseragenten (WebMCP)", "Standardmäßig aktiviert. Diese Auswahl gilt für die Verwaltung dieser Website in diesem Browser.", "Kompatible Browser können markierte Admin-Steuerelemente bedienen. Destruktive Aktionen und Veröffentlichungen erfordern eine Genehmigung.", "Darf der Browseragent diese Verwaltungsaktion ausführen?"],
  "zh-CN": ["浏览器代理访问（WebMCP）", "默认开启。此选项适用于此浏览器中此网站的管理界面。", "兼容的浏览器可以操作带标记的管理控件。更改需要您的确认。", "允许浏览器代理执行此管理操作吗？"],
  "zh-TW": ["瀏覽器代理存取（WebMCP）", "預設開啟。此選項適用於此瀏覽器中此網站的管理介面。", "相容的瀏覽器可以操作帶標記的管理控制項。變更需要您的確認。", "允許瀏覽器代理執行此管理操作嗎？"],
  "pt-BR": ["Acesso do agente do navegador (WebMCP)", "Ativado por padrão. Esta escolha se aplica à administração deste site neste navegador.", "Navegadores compatíveis podem operar controles de administração marcados. Alterações exigem sua confirmação.", "Permitir que o agente do navegador execute esta ação de administração?"],
  ru: ["Доступ агента браузера (WebMCP)", "Включено по умолчанию. Этот выбор действует для панели управления этим сайтом в этом браузере.", "Совместимые браузеры могут управлять отмеченными элементами администратора. Разрушительные действия и публикация требуют одобрения.", "Разрешить агенту браузера выполнить это действие в панели управления?"],
  fa: ["دسترسی عامل مرورگر (WebMCP)", "به‌طور پیش‌فرض فعال است. این انتخاب برای مدیریت این سایت در این مرورگر اعمال می‌شود.", "مرورگرهای سازگار می‌توانند کنترل‌های علامت‌گذاری‌شده مدیریت را به کار بگیرند. اقدامات مخرب و انتشار به تأیید نیاز دارند.", "به عامل مرورگر اجازه می‌دهید این اقدام مدیریتی را انجام دهد؟"],
  ar: ["وصول وكيل المتصفح (WebMCP)", "مفعّل افتراضيًا. ينطبق هذا الخيار على إدارة هذا الموقع في هذا المتصفح.", "يمكن للمتصفحات المتوافقة تشغيل عناصر الإدارة المعلّمة. تتطلب الإجراءات التخريبية والنشر موافقة.", "هل تسمح لوكيل المتصفح بتنفيذ إجراء الإدارة هذا؟"],
  ja: ["ブラウザーエージェントのアクセス（WebMCP）", "既定で有効です。この設定は、このブラウザーでのこのサイトの管理画面に適用されます。", "対応ブラウザーは、タグ付きの管理コントロールを操作できます。破壊的な操作と公開には承認が必要です。", "ブラウザーエージェントによるこの管理操作を許可しますか？"],
  ko: ["브라우저 에이전트 접근 (WebMCP)", "기본적으로 켜져 있습니다. 이 선택은 이 브라우저에서 이 사이트의 관리자 화면에 적용됩니다.", "호환 브라우저는 태그가 지정된 관리자 컨트롤을 조작할 수 있습니다. 파괴적 작업과 게시에는 승인이 필요합니다.", "브라우저 에이전트가 이 관리자 작업을 수행하도록 허용하시겠습니까?"],
  pl: ["Dostęp agenta przeglądarki (WebMCP)", "Domyślnie włączony. Ten wybór dotyczy panelu administracyjnego tej witryny w tej przeglądarce.", "Zgodne przeglądarki mogą obsługiwać oznaczone elementy panelu. Działania destrukcyjne i publikacja wymagają zatwierdzenia.", "Zezwolić agentowi przeglądarki na wykonanie tej czynności administracyjnej?"],
  hu: ["Böngészőügynök hozzáférése (WebMCP)", "Alapértelmezés szerint engedélyezve. Ez a beállítás e webhely adminisztrációjára vonatkozik ebben a böngészőben.", "A kompatibilis böngészők kezelhetik a megjelölt adminisztrációs vezérlőket. A romboló műveletekhez és a közzétételhez jóváhagyás szükséges.", "Engedélyezi a böngészőügynöknek ezt az adminisztrációs műveletet?"],
  fr: ["Accès de l’agent du navigateur (WebMCP)", "Activé par défaut. Ce choix s’applique à l’administration de ce site dans ce navigateur.", "Les navigateurs compatibles peuvent utiliser les commandes d’administration balisées. Les actions destructives et de publication nécessitent une approbation.", "Autoriser l’agent du navigateur à effectuer cette action d’administration ?"],
  uk: ["Доступ агента браузера (WebMCP)", "Увімкнено за замовчуванням. Цей вибір діє для панелі керування цим сайтом у цьому браузері.", "Сумісні браузери можуть керувати позначеними елементами адміністратора. Руйнівні дії та публікація потребують схвалення.", "Дозволити агенту браузера виконати цю дію в панелі керування?"],
  tr: ["Tarayıcı aracısı erişimi (WebMCP)", "Varsayılan olarak açık. Bu seçim, bu tarayıcıda bu sitenin yönetim paneli için geçerlidir.", "Uyumlu tarayıcılar etiketli yönetici kontrollerini kullanabilir. Yıkıcı işlemler ve yayınlama onay gerektirir.", "Tarayıcı aracısının bu yönetim işlemini yapmasına izin verilsin mi?"],
  th: ["การเข้าถึงของเอเจนต์เบราว์เซอร์ (WebMCP)", "เปิดใช้งานโดยค่าเริ่มต้น ตัวเลือกนี้ใช้กับส่วนผู้ดูแลของเว็บไซต์นี้ในเบราว์เซอร์นี้", "เบราว์เซอร์ที่รองรับสามารถใช้ตัวควบคุมผู้ดูแลที่มีแท็กได้ การทำลายข้อมูลและการเผยแพร่ต้องได้รับการอนุมัติ", "อนุญาตให้เอเจนต์เบราว์เซอร์ทำรายการผู้ดูแลนี้หรือไม่?"],
  it: ["Accesso dell’agente del browser (WebMCP)", "Attivo per impostazione predefinita. Questa scelta riguarda l’amministrazione di questo sito in questo browser.", "I browser compatibili possono usare i controlli di amministrazione contrassegnati. Le azioni distruttive e di pubblicazione richiedono approvazione.", "Consentire all’agente del browser di eseguire questa azione di amministrazione?"],
  hi: ["ब्राउज़र एजेंट की पहुँच (WebMCP)", "डिफ़ॉल्ट रूप से चालू है। यह विकल्प इस ब्राउज़र में इस साइट के व्यवस्थापक क्षेत्र पर लागू होता है।", "संगत ब्राउज़र टैग किए गए व्यवस्थापक नियंत्रण चला सकते हैं। विनाशकारी और प्रकाशन कार्रवाइयों के लिए स्वीकृति आवश्यक है।", "क्या ब्राउज़र एजेंट को यह व्यवस्थापक कार्रवाई करने दें?"],
  ur: ["براؤزر ایجنٹ کی رسائی (WebMCP)", "ڈیفالٹ طور پر فعال ہے۔ یہ انتخاب اس براؤزر میں اس سائٹ کی انتظامیہ پر لاگو ہوتا ہے۔", "مطابقت رکھنے والے براؤزر نشان زدہ انتظامی کنٹرول استعمال کر سکتے ہیں۔ تباہ کن اقدامات اور اشاعت کے لیے منظوری ضروری ہے۔", "کیا براؤزر ایجنٹ کو یہ انتظامی کارروائی کرنے کی اجازت دیں؟"],
  bn: ["ব্রাউজার এজেন্টের প্রবেশাধিকার (WebMCP)", "ডিফল্টভাবে চালু। এই পছন্দ এই ব্রাউজারে এই সাইটের প্রশাসন অংশে প্রযোজ্য।", "সমর্থিত ব্রাউজার ট্যাগযুক্ত প্রশাসনিক নিয়ন্ত্রণ ব্যবহার করতে পারে। ধ্বংসাত্মক কাজ এবং প্রকাশনার জন্য অনুমোদন প্রয়োজন।", "ব্রাউজার এজেন্টকে এই প্রশাসনিক কাজ করার অনুমতি দেবেন?"],
};

const confirmLabels: Record<string, string> = {
  "en": "Confirm",
  "es": "Confirmar",
  "id": "Konfirmasi",
  "de": "Bestätigen",
  "zh-CN": "确认",
  "zh-TW": "確認",
  "ru": "Подтвердить",
  "pt-BR": "Confirmar",
  "fa": "تأیید",
  "ar": "تأكيد",
  "ja": "確認",
  "ko": "확인",
  "pl": "Potwierdź",
  "hu": "Megerősítés",
  "fr": "Confirmer",
  "uk": "Підтвердити",
  "tr": "Onayla",
  "th": "ยืนยัน",
  "it": "Conferma",
  "hi": "पुष्टि करें",
  "ur": "تصدیق کریں",
  "bn": "নিশ্চিত করুন"
};

export const WEBMCP_DICT: LocaleDictionary = Object.fromEntries(
  Object.entries(translations).map(([locale, values]) => [locale, { ...Object.fromEntries(WEBMCP_KEYS.map((key, index) => [key, values[index]])), Confirm: confirmLabels[locale] ?? "Confirm" }]),
);
