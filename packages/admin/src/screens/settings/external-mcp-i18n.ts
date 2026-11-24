import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { createDictionaryTranslator } from '@jini-ai/core/text';
import { EXTERNAL_MCP_LOCALES_A } from "./external-mcp-i18n.locales-a.js";
import { EXTERNAL_MCP_LOCALES_B } from "./external-mcp-i18n.locales-b.js";
import { EXTERNAL_MCP_LOCALES_C } from "./external-mcp-i18n.locales-c.js";
/**
 * @file Operator-facing copy for the external-MCP write-tool picker (badges, failure states, and
 * the restart-drift prompt) — `ADS-memory/reports/pipeline/external-mcp-write-tools/
 * implementation-outline.md` §3.2–§3.4, Phase 2C. New keys only: this codebase treats an admin
 * copy string as its own i18n key (`dictionary-translator.ts`'s `featureDict[locale]?.[key] ??
 * COMMON_I18N[locale]?.[key] ?? key`), so editing an EXISTING string's literal text in place would
 * silently revert it to English in every locale below instead of updating a translation — that is
 * why this file only ever gains new entries. Consumed by the (not-yet-built) `ExternalMcpToolPicker`
 * and `ExternalMcpSettingsPanel` — see the outline's File Map, Phase 4.
 *
 * Two entries are parameterized (`interpolate()` + `{token}`, per `Jini packages/ui/src/features/i18n/template-i18n.ts`) rather
 * than flat: the empty-allowlist count and the live/saved drift line, both of which carry a runtime
 * number or name list that can't be baked into a dictionary key.
 *
 * Copy discipline carried over from the outline verbatim (§3.2, called out as load-bearing there
 * and in the Phase 2C dispatch): the "hints absent" badge must never read as "read-only" or imply
 * safety. Absent hints mean the remote server said nothing about a tool — and a tool with no
 * annotations is admitted and writes TODAY, with no operator override in the current admission
 * gate (`mcp-federation/trust.ts`'s `refusalForRemoteToolHints`, which only demotes on an explicit
 * `=== true` / `=== false` hint). The badge text below states that plainly instead of dressing
 * silence as safety.
 *
 * `allowlist` and the host's product name are kept as untranslated technical/product terms across every locale,
 * matching the host's `settings-capabilities-i18n.ts` keeping `backend` un-translated —
 * there is no established localized term for either in this codebase's existing dictionaries.
 *
 * The product name is host copy (K3): every key and translation that names it carries the
 * `{productName}` token instead, and the consumer fills it through the `vars` it already passes to
 * `interpolate()` (an admissions row's `messageVars`, a picker row's lock sentence). Five keys carry it;
 * an unfilled token renders literally, so a host that forgets it is visible rather than silently
 * naming another product.
 *
 * Split for the 500-line limit: the 21 locale blocks live in `external-mcp-i18n.locales-a/-b/-c.ts`;
 * the end-of-file copy blocks below still merge into those same per-locale objects.
 */

/** All 21 locales, in the original order; locale keys are disjoint, so the spread order is the old literal order. */
const EXTERNAL_MCP_DICT: Record<string, Record<string, string>> = { ...EXTERNAL_MCP_LOCALES_A, ...EXTERNAL_MCP_LOCALES_B, ...EXTERNAL_MCP_LOCALES_C };

/** Bound translator — call as `t(locale, "<exact English copy>")`. Falls back to `ADMIN_COMMON_I18N`,
 *  then to the English key itself, per `dictionary-translator.ts`. */
export const t = createDictionaryTranslator({ featureDictionary: EXTERNAL_MCP_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

// 2026-10-13 scratch-desktop registration incident: banner recovery copy.
// Kept separate at the end so concurrent Tools dialog copy edits stay independent.
// "Remove" is not repeated here: the translator falls back to COMMON_I18N, which has it.
const MISSING_LAUNCHER_COPY: Record<string, Record<"Launcher missing", string>> = {
  es: { "Launcher missing": "Falta el lanzador" },
  id: { "Launcher missing": "Peluncur tidak ditemukan" },
  de: { "Launcher missing": "Startdatei fehlt" },
  "zh-CN": { "Launcher missing": "启动器缺失" },
  "zh-TW": { "Launcher missing": "啟動器遺失" },
  "pt-BR": { "Launcher missing": "Inicializador ausente" },
  ru: { "Launcher missing": "Файл запуска отсутствует" },
  fa: { "Launcher missing": "راه‌انداز موجود نیست" },
  ar: { "Launcher missing": "ملف التشغيل مفقود" },
  ja: { "Launcher missing": "ランチャーが見つかりません" },
  ko: { "Launcher missing": "실행 파일 없음" },
  pl: { "Launcher missing": "Brak pliku uruchamiającego" },
  hu: { "Launcher missing": "Hiányzik az indítófájl" },
  fr: { "Launcher missing": "Lanceur manquant" },
  uk: { "Launcher missing": "Файл запуску відсутній" },
  tr: { "Launcher missing": "Başlatıcı bulunamadı" },
  th: { "Launcher missing": "ไม่พบตัวเรียกใช้งาน" },
  it: { "Launcher missing": "File di avvio mancante" },
  hi: { "Launcher missing": "लॉन्चर नहीं मिला" },
  ur: { "Launcher missing": "لانچر موجود نہیں" },
  bn: { "Launcher missing": "লঞ্চার পাওয়া যায়নি" },
};

for (const [locale, copy] of Object.entries(MISSING_LAUNCHER_COPY)) {
  Object.assign(Reflect.get(EXTERNAL_MCP_DICT, locale), copy);
}

// 2026-10-23: row-level OAuth Connect + the built-in row's toggle/ⓘ. Same end-of-file block
// pattern as MISSING_LAUNCHER_COPY above. Order: Connect, Sign in to {name}, Sign-in could not
// start., Enter this code on the sign-in page:, Finish signing in in the new window., Not signed
// in. Use Connect on this server below., Enable {name}, About {name}, built-in tooltip.
const CONNECT_KEYS = [
  "Connect",
  "Sign in to {name}",
  "Sign-in could not start.",
  "Enter this code on the sign-in page:",
  "Finish signing in in the new window.",
  "Not signed in. Use Connect on this server below.",
  "Enable {name}",
  "About {name}",
  "Lets this site's assistant list your other {productName} sites, add a site pointer, and reveal a site folder.",
] as const;
const CONNECT_COPY: Record<string, readonly string[]> = {
  es: ["Conectar", "Iniciar sesión en {name}", "No se pudo iniciar sesión.", "Introduce este código en la página de inicio de sesión:", "Termina de iniciar sesión en la nueva ventana.", "Sin sesión iniciada. Usa Conectar en este servidor, abajo.", "Activar {name}", "Acerca de {name}", "Permite que el asistente de este sitio liste tus otros sitios de {productName}, añada un acceso a un sitio y muestre la carpeta de un sitio."],
  id: ["Hubungkan", "Masuk ke {name}", "Proses masuk tidak dapat dimulai.", "Masukkan kode ini di halaman masuk:", "Selesaikan proses masuk di jendela baru.", "Belum masuk. Gunakan Hubungkan pada server ini di bawah.", "Aktifkan {name}", "Tentang {name}", "Memungkinkan asisten situs ini menampilkan situs {productName} Anda yang lain, menambahkan penunjuk situs, dan membuka folder situs."],
  de: ["Verbinden", "Bei {name} anmelden", "Die Anmeldung konnte nicht gestartet werden.", "Gib diesen Code auf der Anmeldeseite ein:", "Schließe die Anmeldung im neuen Fenster ab.", "Nicht angemeldet. Nutze „Verbinden“ bei diesem Server unten.", "{name} aktivieren", "Über {name}", "Lässt den Assistenten dieser Website deine anderen {productName}-Websites auflisten, einen Website-Verweis hinzufügen und einen Website-Ordner anzeigen."],
  "zh-CN": ["连接", "登录 {name}", "无法开始登录。", "在登录页面输入此代码：", "请在新窗口中完成登录。", "尚未登录。请使用下方此服务器的“连接”。", "启用 {name}", "关于 {name}", "让此站点的助手列出你的其他 {productName} 站点、添加站点指针并显示站点文件夹。"],
  "zh-TW": ["連線", "登入 {name}", "無法開始登入。", "在登入頁面輸入此代碼：", "請在新視窗中完成登入。", "尚未登入。請使用下方此伺服器的「連線」。", "啟用 {name}", "關於 {name}", "讓此網站的助理列出你的其他 {productName} 網站、新增網站指標並顯示網站資料夾。"],
  "pt-BR": ["Conectar", "Entrar em {name}", "Não foi possível iniciar o login.", "Digite este código na página de login:", "Conclua o login na nova janela.", "Sem login. Use Conectar neste servidor, abaixo.", "Ativar {name}", "Sobre {name}", "Permite que o assistente deste site liste seus outros sites {productName}, adicione um atalho de site e mostre a pasta de um site."],
  ru: ["Подключить", "Войти в {name}", "Не удалось начать вход.", "Введите этот код на странице входа:", "Завершите вход в новом окне.", "Вход не выполнен. Нажмите «Подключить» у этого сервера ниже.", "Включить {name}", "О {name}", "Позволяет ассистенту этого сайта показывать другие ваши сайты {productName}, добавлять ссылку на сайт и открывать папку сайта."],
  fa: ["اتصال", "ورود به {name}", "ورود آغاز نشد.", "این کد را در صفحهٔ ورود وارد کنید:", "ورود را در پنجرهٔ جدید تمام کنید.", "وارد نشده‌اید. از «اتصال» در این سرور در پایین استفاده کنید.", "فعال‌سازی {name}", "دربارهٔ {name}", "به دستیار این سایت اجازه می‌دهد سایت‌های دیگر {productName} شما را فهرست کند، نشانگر سایت اضافه کند و پوشهٔ سایت را نشان دهد."],
  ar: ["اتصال", "تسجيل الدخول إلى {name}", "تعذّر بدء تسجيل الدخول.", "أدخل هذا الرمز في صفحة تسجيل الدخول:", "أكمل تسجيل الدخول في النافذة الجديدة.", "لم يتم تسجيل الدخول. استخدم «اتصال» في هذا الخادم أدناه.", "تفعيل {name}", "حول {name}", "يتيح لمساعد هذا الموقع عرض مواقع {productName} الأخرى الخاصة بك، وإضافة مؤشر موقع، وإظهار مجلد الموقع."],
  ja: ["接続", "{name} にサインイン", "サインインを開始できませんでした。", "サインインページでこのコードを入力してください：", "新しいウィンドウでサインインを完了してください。", "サインインしていません。下のこのサーバーの「接続」を使ってください。", "{name} を有効にする", "{name} について", "このサイトのアシスタントが、ほかの {productName} サイトの一覧表示、サイトへのポインターの追加、サイトフォルダーの表示を行えるようにします。"],
  ko: ["연결", "{name}에 로그인", "로그인을 시작할 수 없습니다.", "로그인 페이지에 이 코드를 입력하세요:", "새 창에서 로그인을 완료하세요.", "로그인되지 않았습니다. 아래 이 서버의 연결을 사용하세요.", "{name} 사용", "{name} 정보", "이 사이트의 어시스턴트가 다른 {productName} 사이트를 나열하고, 사이트 포인터를 추가하고, 사이트 폴더를 표시할 수 있게 합니다."],
  pl: ["Połącz", "Zaloguj się do {name}", "Nie udało się rozpocząć logowania.", "Wpisz ten kod na stronie logowania:", "Dokończ logowanie w nowym oknie.", "Nie zalogowano. Użyj „Połącz” przy tym serwerze poniżej.", "Włącz {name}", "Informacje o {name}", "Pozwala asystentowi tej witryny wyświetlać Twoje inne witryny {productName}, dodawać odnośnik do witryny i pokazywać folder witryny."],
  hu: ["Csatlakozás", "Bejelentkezés: {name}", "A bejelentkezés nem indítható el.", "Írd be ezt a kódot a bejelentkezési oldalon:", "Fejezd be a bejelentkezést az új ablakban.", "Nincs bejelentkezve. Használd lent ennél a szervernél a Csatlakozás gombot.", "{name} engedélyezése", "Névjegy: {name}", "Lehetővé teszi, hogy az oldal asszisztense listázza a többi {productName}-oldaladat, oldalmutatót adjon hozzá, és megmutasson egy oldalmappát."],
  fr: ["Connecter", "Se connecter à {name}", "Impossible de lancer la connexion.", "Saisissez ce code sur la page de connexion :", "Terminez la connexion dans la nouvelle fenêtre.", "Non connecté. Utilisez Connecter sur ce serveur, ci-dessous.", "Activer {name}", "À propos de {name}", "Permet à l’assistant de ce site de lister vos autres sites {productName}, d’ajouter un pointeur de site et d’afficher le dossier d’un site."],
  uk: ["Підключити", "Увійти в {name}", "Не вдалося почати вхід.", "Введіть цей код на сторінці входу:", "Завершіть вхід у новому вікні.", "Вхід не виконано. Натисніть «Підключити» біля цього сервера нижче.", "Увімкнути {name}", "Про {name}", "Дозволяє асистенту цього сайту показувати інші ваші сайти {productName}, додавати посилання на сайт і відкривати теку сайту."],
  tr: ["Bağlan", "{name} hizmetinde oturum aç", "Oturum açma başlatılamadı.", "Bu kodu oturum açma sayfasına girin:", "Oturum açmayı yeni pencerede tamamlayın.", "Oturum açılmadı. Aşağıda bu sunucudaki Bağlan'ı kullanın.", "{name} öğesini etkinleştir", "{name} hakkında", "Bu sitenin asistanının diğer {productName} sitelerinizi listelemesine, site işaretçisi eklemesine ve bir site klasörünü göstermesine izin verir."],
  th: ["เชื่อมต่อ", "ลงชื่อเข้าใช้ {name}", "เริ่มการลงชื่อเข้าใช้ไม่ได้", "ป้อนรหัสนี้ในหน้าลงชื่อเข้าใช้:", "ลงชื่อเข้าใช้ให้เสร็จในหน้าต่างใหม่", "ยังไม่ได้ลงชื่อเข้าใช้ ใช้ปุ่มเชื่อมต่อของเซิร์ฟเวอร์นี้ด้านล่าง", "เปิดใช้ {name}", "เกี่ยวกับ {name}", "ให้ผู้ช่วยของเว็บไซต์นี้แสดงรายการเว็บไซต์ {productName} อื่นของคุณ เพิ่มตัวชี้เว็บไซต์ และแสดงโฟลเดอร์ของเว็บไซต์"],
  it: ["Connetti", "Accedi a {name}", "Impossibile avviare l'accesso.", "Inserisci questo codice nella pagina di accesso:", "Completa l'accesso nella nuova finestra.", "Accesso non effettuato. Usa Connetti su questo server, qui sotto.", "Attiva {name}", "Informazioni su {name}", "Permette all'assistente di questo sito di elencare gli altri tuoi siti {productName}, aggiungere un collegamento a un sito e mostrare la cartella di un sito."],
  hi: ["कनेक्ट करें", "{name} में साइन इन करें", "साइन-इन शुरू नहीं हो सका।", "साइन-इन पेज पर यह कोड डालें:", "नई विंडो में साइन-इन पूरा करें।", "साइन इन नहीं है। नीचे इस सर्वर पर कनेक्ट करें का उपयोग करें।", "{name} चालू करें", "{name} के बारे में", "इस साइट के असिस्टेंट को आपकी अन्य {productName} साइटें दिखाने, साइट पॉइंटर जोड़ने और साइट फ़ोल्डर दिखाने देता है।"],
  ur: ["منسلک کریں", "{name} میں سائن ان کریں", "سائن اِن شروع نہیں ہو سکا۔", "سائن اِن صفحے پر یہ کوڈ درج کریں:", "نئی ونڈو میں سائن اِن مکمل کریں۔", "سائن اِن نہیں ہے۔ نیچے اس سرور پر منسلک کریں استعمال کریں۔", "{name} فعال کریں", "{name} کے بارے میں", "اس سائٹ کے اسسٹنٹ کو آپ کی دوسری {productName} سائٹیں دکھانے، سائٹ پوائنٹر شامل کرنے اور سائٹ فولڈر دکھانے دیتا ہے۔"],
  bn: ["সংযুক্ত করুন", "{name}-এ সাইন ইন করুন", "সাইন-ইন শুরু করা যায়নি।", "সাইন-ইন পেজে এই কোডটি লিখুন:", "নতুন উইন্ডোতে সাইন-ইন শেষ করুন।", "সাইন ইন করা নেই। নিচে এই সার্ভারের সংযুক্ত করুন ব্যবহার করুন।", "{name} চালু করুন", "{name} সম্পর্কে", "এই সাইটের সহকারীকে আপনার অন্য {productName} সাইটগুলো দেখাতে, সাইট পয়েন্টার যোগ করতে এবং সাইট ফোল্ডার দেখাতে দেয়।"],
};

for (const [locale, values] of Object.entries(CONNECT_COPY)) {
  Object.assign(Reflect.get(EXTERNAL_MCP_DICT, locale), Object.fromEntries(CONNECT_KEYS.map((key, index) => [key, values[index]])));
}

// Saved desktop connections use the existing external-MCP copy owner and locale binding.
const SHARED_CONNECTION_KEYS = [
  "Use a saved connection on this Mac",
  "Saved connections are available in the desktop owner profile.",
  "Sign in and save on this Mac",
  "Saved connection",
  "Saved MCP connection",
  "Choose a saved connection",
  "Use this site's local connection",
  "Shared connection: {status}.",
  "This shared connection is stopped on this site.",
  "Stop using here",
  "Saving here lets you grant this connection to other sites on this Mac. Existing local connections stay separate."
] as const;
const SHARED_CONNECTION_COPY: Record<string, readonly string[]> = {
  "es": ["Usar una conexión guardada en este Mac", "Las conexiones guardadas están disponibles en el perfil del propietario de la aplicación de escritorio.", "Iniciar sesión y guardar en este Mac", "Conexión guardada", "Conexión MCP guardada", "Elige una conexión guardada", "Usar la conexión local de este sitio", "Conexión compartida: {status}.", "Esta conexión compartida está detenida en este sitio.", "Dejar de usar aquí", "Guardar aquí te permite conceder esta conexión a otros sitios de este Mac. Las conexiones locales existentes permanecen separadas."],
  "id": ["Gunakan koneksi tersimpan di Mac ini", "Koneksi tersimpan tersedia di profil pemilik aplikasi desktop.", "Masuk dan simpan di Mac ini", "Koneksi tersimpan", "Koneksi MCP tersimpan", "Pilih koneksi tersimpan", "Gunakan koneksi lokal situs ini", "Koneksi bersama: {status}.", "Koneksi bersama ini dihentikan di situs ini.", "Berhenti menggunakan di sini", "Menyimpan di sini memungkinkan Anda memberikan koneksi ini ke situs lain di Mac ini. Koneksi lokal yang ada tetap terpisah."],
  "de": ["Gespeicherte Verbindung auf diesem Mac verwenden", "Gespeicherte Verbindungen sind im Eigentümerprofil der Desktop-App verfügbar.", "Anmelden und auf diesem Mac speichern", "Gespeicherte Verbindung", "Gespeicherte MCP-Verbindung", "Gespeicherte Verbindung auswählen", "Lokale Verbindung dieser Website verwenden", "Geteilte Verbindung: {status}.", "Diese geteilte Verbindung ist auf dieser Website angehalten.", "Hier nicht mehr verwenden", "Durch Speichern kannst du diese Verbindung anderen Websites auf diesem Mac freigeben. Vorhandene lokale Verbindungen bleiben getrennt."],
  "zh-CN": ["使用此 Mac 上保存的连接", "保存的连接可在桌面应用的所有者配置文件中使用。", "登录并保存到此 Mac", "已保存的连接", "已保存的 MCP 连接", "选择已保存的连接", "使用此站点的本地连接", "共享连接：{status}。", "此共享连接已在此站点停止。", "在此停止使用", "在此保存后，你可以将此连接授权给此 Mac 上的其他站点。现有本地连接保持独立。"],
  "zh-TW": ["使用此 Mac 上儲存的連線", "儲存的連線可在桌面應用程式的擁有者設定檔中使用。", "登入並儲存到此 Mac", "已儲存的連線", "已儲存的 MCP 連線", "選擇已儲存的連線", "使用此網站的本機連線", "共用連線：{status}。", "此共用連線已在此網站停止。", "在此停止使用", "在此儲存後，你可以將此連線授權給此 Mac 上的其他網站。現有本機連線保持獨立。"],
  "pt-BR": ["Usar uma conexão salva neste Mac", "As conexões salvas estão disponíveis no perfil do proprietário do aplicativo de desktop.", "Entrar e salvar neste Mac", "Conexão salva", "Conexão MCP salva", "Escolha uma conexão salva", "Usar a conexão local deste site", "Conexão compartilhada: {status}.", "Esta conexão compartilhada está parada neste site.", "Parar de usar aqui", "Salvar aqui permite conceder esta conexão a outros sites neste Mac. As conexões locais existentes permanecem separadas."],
  "ru": ["Использовать сохранённое подключение на этом Mac", "Сохранённые подключения доступны в профиле владельца настольного приложения.", "Войти и сохранить на этом Mac", "Сохранённое подключение", "Сохранённое подключение MCP", "Выберите сохранённое подключение", "Использовать локальное подключение этого сайта", "Общее подключение: {status}.", "Это общее подключение остановлено на этом сайте.", "Прекратить использование здесь", "Сохранение позволяет предоставить это подключение другим сайтам на этом Mac. Существующие локальные подключения остаются отдельными."],
  "fa": ["استفاده از اتصال ذخیره‌شده در این Mac", "اتصال‌های ذخیره‌شده در نمایهٔ مالک برنامهٔ دسکتاپ در دسترس هستند.", "ورود و ذخیره در این Mac", "اتصال ذخیره‌شده", "اتصال MCP ذخیره‌شده", "یک اتصال ذخیره‌شده انتخاب کنید", "استفاده از اتصال محلی این سایت", "اتصال مشترک: {status}.", "این اتصال مشترک در این سایت متوقف شده است.", "توقف استفاده در اینجا", "ذخیره در اینجا اجازه می‌دهد این اتصال را به سایت‌های دیگر این Mac بدهید. اتصال‌های محلی موجود جدا می‌مانند."],
  "ar": ["استخدام اتصال محفوظ على جهاز Mac هذا", "الاتصالات المحفوظة متاحة في ملف مالك تطبيق سطح المكتب.", "تسجيل الدخول والحفظ على جهاز Mac هذا", "اتصال محفوظ", "اتصال MCP محفوظ", "اختر اتصالًا محفوظًا", "استخدام الاتصال المحلي لهذا الموقع", "اتصال مشترك: {status}.", "هذا الاتصال المشترك متوقف على هذا الموقع.", "التوقف عن الاستخدام هنا", "يتيح الحفظ هنا منح هذا الاتصال لمواقع أخرى على جهاز Mac هذا. تظل الاتصالات المحلية الحالية منفصلة."],
  "ja": ["この Mac に保存した接続を使う", "保存した接続はデスクトップアプリの所有者プロファイルで利用できます。", "サインインしてこの Mac に保存", "保存した接続", "保存した MCP 接続", "保存した接続を選択", "このサイトのローカル接続を使う", "共有接続：{status}。", "この共有接続はこのサイトで停止しています。", "ここでの使用を停止", "ここに保存すると、この Mac のほかのサイトにこの接続を許可できます。既存のローカル接続は個別のままです。"],
  "ko": ["이 Mac에 저장된 연결 사용", "저장된 연결은 데스크톱 앱의 소유자 프로필에서 사용할 수 있습니다.", "로그인하고 이 Mac에 저장", "저장된 연결", "저장된 MCP 연결", "저장된 연결 선택", "이 사이트의 로컬 연결 사용", "공유 연결: {status}.", "이 공유 연결은 이 사이트에서 중지되었습니다.", "여기서 사용 중지", "여기에 저장하면 이 Mac의 다른 사이트에 이 연결을 허용할 수 있습니다. 기존 로컬 연결은 별도로 유지됩니다."],
  "pl": ["Użyj zapisanego połączenia na tym Macu", "Zapisane połączenia są dostępne w profilu właściciela aplikacji komputerowej.", "Zaloguj się i zapisz na tym Macu", "Zapisane połączenie", "Zapisane połączenie MCP", "Wybierz zapisane połączenie", "Użyj lokalnego połączenia tej witryny", "Współdzielone połączenie: {status}.", "To współdzielone połączenie jest zatrzymane w tej witrynie.", "Przestań używać tutaj", "Zapisanie tutaj umożliwia udostępnienie tego połączenia innym witrynom na tym Macu. Istniejące lokalne połączenia pozostają oddzielne."],
  "hu": ["Mentett kapcsolat használata ezen a Macen", "A mentett kapcsolatok az asztali alkalmazás tulajdonosi profiljában érhetők el.", "Bejelentkezés és mentés erre a Macre", "Mentett kapcsolat", "Mentett MCP-kapcsolat", "Válassz mentett kapcsolatot", "A webhely helyi kapcsolatának használata", "Megosztott kapcsolat: {status}.", "Ez a megosztott kapcsolat ezen a webhelyen le van állítva.", "Használat leállítása itt", "Az itteni mentés lehetővé teszi a kapcsolat engedélyezését a Mac más webhelyein. A meglévő helyi kapcsolatok külön maradnak."],
  "fr": ["Utiliser une connexion enregistrée sur ce Mac", "Les connexions enregistrées sont disponibles dans le profil du propriétaire de l’application de bureau.", "Se connecter et enregistrer sur ce Mac", "Connexion enregistrée", "Connexion MCP enregistrée", "Choisissez une connexion enregistrée", "Utiliser la connexion locale de ce site", "Connexion partagée : {status}.", "Cette connexion partagée est arrêtée sur ce site.", "Ne plus utiliser ici", "Enregistrer ici permet d’accorder cette connexion à d’autres sites sur ce Mac. Les connexions locales existantes restent séparées."],
  "uk": ["Використати збережене з’єднання на цьому Mac", "Збережені з’єднання доступні в профілі власника настільної програми.", "Увійти й зберегти на цьому Mac", "Збережене з’єднання", "Збережене з’єднання MCP", "Виберіть збережене з’єднання", "Використати локальне з’єднання цього сайту", "Спільне з’єднання: {status}.", "Це спільне з’єднання зупинено на цьому сайті.", "Припинити використання тут", "Збереження тут дозволяє надати це з’єднання іншим сайтам на цьому Mac. Наявні локальні з’єднання залишаються окремими."],
  "tr": ["Bu Mac’te kayıtlı bir bağlantı kullan", "Kayıtlı bağlantılar masaüstü uygulamasının sahip profilinde kullanılabilir.", "Oturum aç ve bu Mac’e kaydet", "Kayıtlı bağlantı", "Kayıtlı MCP bağlantısı", "Kayıtlı bir bağlantı seçin", "Bu sitenin yerel bağlantısını kullan", "Paylaşılan bağlantı: {status}.", "Bu paylaşılan bağlantı bu sitede durdurulmuş.", "Burada kullanmayı bırak", "Buraya kaydetmek bu bağlantıyı bu Mac’teki diğer sitelere vermenizi sağlar. Mevcut yerel bağlantılar ayrı kalır."],
  "th": ["ใช้การเชื่อมต่อที่บันทึกไว้บน Mac เครื่องนี้", "การเชื่อมต่อที่บันทึกไว้มีให้ในโปรไฟล์เจ้าของแอปเดสก์ท็อป", "ลงชื่อเข้าใช้และบันทึกบน Mac เครื่องนี้", "การเชื่อมต่อที่บันทึกไว้", "การเชื่อมต่อ MCP ที่บันทึกไว้", "เลือกการเชื่อมต่อที่บันทึกไว้", "ใช้การเชื่อมต่อภายในของไซต์นี้", "การเชื่อมต่อที่แชร์: {status}", "การเชื่อมต่อที่แชร์นี้หยุดอยู่บนไซต์นี้", "หยุดใช้ที่นี่", "การบันทึกที่นี่ช่วยให้คุณอนุญาตการเชื่อมต่อนี้แก่ไซต์อื่นบน Mac เครื่องนี้ การเชื่อมต่อภายในที่มีอยู่จะยังแยกกัน"],
  "it": ["Usa una connessione salvata su questo Mac", "Le connessioni salvate sono disponibili nel profilo del proprietario dell’app desktop.", "Accedi e salva su questo Mac", "Connessione salvata", "Connessione MCP salvata", "Scegli una connessione salvata", "Usa la connessione locale di questo sito", "Connessione condivisa: {status}.", "Questa connessione condivisa è interrotta su questo sito.", "Smetti di usare qui", "Salvare qui consente di concedere questa connessione ad altri siti su questo Mac. Le connessioni locali esistenti restano separate."],
  "hi": ["इस Mac पर सहेजा गया कनेक्शन इस्तेमाल करें", "सहेजे गए कनेक्शन डेस्कटॉप ऐप के मालिक की प्रोफ़ाइल में उपलब्ध हैं।", "साइन इन करके इस Mac पर सहेजें", "सहेजा गया कनेक्शन", "सहेजा गया MCP कनेक्शन", "सहेजा गया कनेक्शन चुनें", "इस साइट का स्थानीय कनेक्शन इस्तेमाल करें", "साझा कनेक्शन: {status}।", "यह साझा कनेक्शन इस साइट पर बंद है।", "यहाँ इस्तेमाल बंद करें", "यहाँ सहेजने से आप इस कनेक्शन की अनुमति इस Mac की अन्य साइटों को दे सकते हैं। मौजूदा स्थानीय कनेक्शन अलग रहते हैं।"],
  "ur": ["اس Mac پر محفوظ کنکشن استعمال کریں", "محفوظ کنکشن ڈیسک ٹاپ ایپ کے مالک کی پروفائل میں دستیاب ہیں۔", "سائن ان کریں اور اس Mac پر محفوظ کریں", "محفوظ کنکشن", "محفوظ MCP کنکشن", "محفوظ کنکشن منتخب کریں", "اس سائٹ کا مقامی کنکشن استعمال کریں", "مشترکہ کنکشن: {status}۔", "یہ مشترکہ کنکشن اس سائٹ پر بند ہے۔", "یہاں استعمال بند کریں", "یہاں محفوظ کرنے سے آپ اس کنکشن کی اجازت اس Mac کی دوسری سائٹوں کو دے سکتے ہیں۔ موجودہ مقامی کنکشن الگ رہتے ہیں۔"],
  "bn": ["এই Mac-এ সংরক্ষিত সংযোগ ব্যবহার করুন", "সংরক্ষিত সংযোগ ডেস্কটপ অ্যাপের মালিকের প্রোফাইলে পাওয়া যায়।", "সাইন ইন করে এই Mac-এ সংরক্ষণ করুন", "সংরক্ষিত সংযোগ", "সংরক্ষিত MCP সংযোগ", "একটি সংরক্ষিত সংযোগ বেছে নিন", "এই সাইটের স্থানীয় সংযোগ ব্যবহার করুন", "ভাগ করা সংযোগ: {status}।", "এই ভাগ করা সংযোগটি এই সাইটে বন্ধ আছে।", "এখানে ব্যবহার বন্ধ করুন", "এখানে সংরক্ষণ করলে এই Mac-এর অন্য সাইটগুলোকে এই সংযোগের অনুমতি দিতে পারবেন। বিদ্যমান স্থানীয় সংযোগগুলো আলাদা থাকে।"],
};

for (const [locale, values] of Object.entries(SHARED_CONNECTION_COPY)) {
  Object.assign(Reflect.get(EXTERNAL_MCP_DICT, locale), Object.fromEntries(SHARED_CONNECTION_KEYS.map((key, index) => [key, values[index]])));
}