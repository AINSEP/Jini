import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from "@jini-ai/core/text";

import { bindDictionaryNames } from "../../core/bind-dictionary-names.js";

/**
 * @file Translations for the Integrations page (the host's providers screen, its
 * `/admin/addons/integrations` route) — this feature's own dictionary rather than the shared
 * admin-nav one, the same per-feature convention the integrations and plugins dictionaries
 * follow, so parallel translation passes over different admin sections cannot collide on one file.
 *
 * `Integrations` and `"Add-Ons"` here are the SAME strings the nav row and group heading use — they
 * were lifted from the admin-nav dictionary rather than retyped, so the page kicker/title can never
 * disagree with the group label and row label an operator just clicked. `Providers` and `Media`
 * (plus their own description string below) are unused leftovers from before the 2026-09-10 second
 * pass — kept rather than deleted (harmless, reversible) since the screen no longer renders
 * either; see the host's `providers` panel comment for the rename history.
 *
 * Scope note: the TAB BODIES are not translated from here. `ExternalMcpSettingsPanel` and
 * `IntegrationsTab` both resolve their own copy through `@jini-ai/ui`'s `useT()`, which reads the
 * `I18nProvider` the screen mounts — that provider is load-bearing and not decoration. The
 * Webhooks tab body and the "MCP Server"/"Webhooks" tab LABELS both read from the integrations
 * dictionary instead — carried over unchanged from the developer-API page, not duplicated here.
 *
 * The product name is written `{productName}`; the host binds it once through
 * {@link createProvidersDictionary} and gets back the exact English keys its call sites look up.
 */

const PROVIDERS_DICT: Record<string, Record<string, string>> = {
  es: {
    "Always allow": "Permitir siempre", "These tools run without asking. Revoke one and it asks again.": "Estas herramientas se ejecutan sin preguntar. Revoca una y volverá a preguntar.", "Revoke": "Revocar", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Nada está en Permitir siempre. Elígelo en la tarjeta de aprobación de una herramienta en el chat.", "Loading…": "Cargando…", "Couldn't load this list.": "No se pudo cargar esta lista.", "Couldn't revoke. Try again.": "No se pudo revocar. Inténtalo de nuevo.",
    "Saved — restart {productName} to connect": "Guardado — reinicia {productName} para conectar", "Changes apply when {productName} restarts": "Los cambios se aplican al reiniciar {productName}", "Coming soon": "Próximamente", "Nothing below is connected to anything yet.": "Aún no hay nada conectado abajo.", "Webhooks can't fire yet — nothing here is wired up.": "Los webhooks aún no pueden activarse; aquí no hay nada conectado.",
    Integrations: "Integraciones",
    "Add-Ons": "Complementos",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Conexiones externas en ambas direcciones — servidores de herramientas MCP externos, el propio servidor MCP de esta instalación y webhooks salientes.",
    Providers: "Proveedores",
    Media: "Multimedia",
    "External MCP": "MCP externo",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Servicios externos a los que se conecta este sitio: generación de multimedia, cuentas de terceros y servidores de herramientas MCP externos.",

  },
  id: {
    "Always allow": "Selalu izinkan", "These tools run without asking. Revoke one and it asks again.": "Alat-alat ini berjalan tanpa bertanya. Cabut salah satunya dan alat itu akan bertanya lagi.", "Revoke": "Cabut", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Belum ada yang diatur ke Selalu izinkan. Pilih di kartu persetujuan alat di obrolan.", "Loading…": "Memuat…", "Couldn't load this list.": "Tidak dapat memuat daftar ini.", "Couldn't revoke. Try again.": "Tidak dapat mencabut. Coba lagi.",
    "Saved — restart {productName} to connect": "Tersimpan — mulai ulang {productName} untuk terhubung", "Changes apply when {productName} restarts": "Perubahan berlaku saat {productName} dimulai ulang", "Coming soon": "Segera hadir", "Nothing below is connected to anything yet.": "Belum ada apa pun di bawah yang terhubung.", "Webhooks can't fire yet — nothing here is wired up.": "Webhook belum dapat berjalan — belum ada yang terhubung di sini.",
    Integrations: "Integrasi",
    "Add-Ons": "Pengaya",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Koneksi eksternal dalam dua arah — server alat MCP eksternal, server MCP milik instalasi ini sendiri, dan webhook keluar.",
    Providers: "Penyedia",
    Media: "Media",
    "External MCP": "MCP eksternal",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Layanan luar yang terhubung dengan situs ini — pembuatan media, akun pihak ketiga, dan server alat MCP eksternal.",

  },
  de: {
    "Always allow": "Immer erlauben", "These tools run without asking. Revoke one and it asks again.": "Diese Tools laufen ohne Nachfrage. Widerrufen Sie eines, und es fragt wieder.", "Revoke": "Widerrufen", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Nichts ist auf Immer erlauben gesetzt. Wählen Sie es auf der Freigabekarte eines Tools im Chat.", "Loading…": "Wird geladen…", "Couldn't load this list.": "Diese Liste konnte nicht geladen werden.", "Couldn't revoke. Try again.": "Widerruf fehlgeschlagen. Bitte erneut versuchen.",
    "Saved — restart {productName} to connect": "Gespeichert — starten Sie {productName} neu, um eine Verbindung herzustellen", "Changes apply when {productName} restarts": "Änderungen werden beim Neustart von {productName} wirksam", "Coming soon": "Demnächst", "Nothing below is connected to anything yet.": "Unten ist noch nichts verbunden.", "Webhooks can't fire yet — nothing here is wired up.": "Webhooks können noch nicht ausgelöst werden — hier ist noch nichts verbunden.",
    Integrations: "Integrationen",
    "Add-Ons": "Add-ons",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Externe Verbindungen in beide Richtungen — externe MCP-Tool-Server, der eigene MCP-Server dieser Installation und ausgehende Webhooks.",
    Providers: "Anbieter",
    Media: "Medien",
    "External MCP": "Externes MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Externe Dienste, mit denen diese Website verbunden ist – Medienerzeugung, Drittanbieterkonten und externe MCP-Tool-Server.",

  },
  "zh-CN": {
    "Always allow": "始终允许", "These tools run without asking. Revoke one and it asks again.": "这些工具无需询问即可运行。撤销其中一个，它会再次询问。", "Revoke": "撤销", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "尚无设为始终允许的工具。请在聊天中工具的批准卡片上选择。", "Loading…": "加载中…", "Couldn't load this list.": "无法加载此列表。", "Couldn't revoke. Try again.": "撤销失败，请重试。",
    "Saved — restart {productName} to connect": "已保存 — 重启 {productName} 以连接", "Changes apply when {productName} restarts": "重启 {productName} 后将应用更改", "Coming soon": "即将推出", "Nothing below is connected to anything yet.": "下方尚未连接任何内容。", "Webhooks can't fire yet — nothing here is wired up.": "Webhook 还无法触发 — 此处尚未连接任何内容。",
    Integrations: "集成",
    "Add-Ons": "附加组件",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "双向的外部连接 — 外部 MCP 工具服务器、本安装自身的 MCP 服务器，以及出站 Webhook。",
    Providers: "服务商",
    Media: "媒体",
    "External MCP": "外部 MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "本站连接的外部服务 — 媒体生成、第三方账户，以及外部 MCP 工具服务器。",

  },
  "zh-TW": {
    "Always allow": "一律允許", "These tools run without asking. Revoke one and it asks again.": "這些工具無需詢問即可執行。撤銷其中一個，它會再次詢問。", "Revoke": "撤銷", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "尚無設為一律允許的工具。請在聊天中工具的核准卡片上選擇。", "Loading…": "載入中…", "Couldn't load this list.": "無法載入此清單。", "Couldn't revoke. Try again.": "撤銷失敗，請再試一次。",
    "Saved — restart {productName} to connect": "已儲存 — 重新啟動 {productName} 以連線", "Changes apply when {productName} restarts": "重新啟動 {productName} 時會套用變更", "Coming soon": "即將推出", "Nothing below is connected to anything yet.": "下方尚未連線任何內容。", "Webhooks can't fire yet — nothing here is wired up.": "Webhook 尚無法觸發 — 此處尚未連線任何內容。",
    Integrations: "整合",
    "Add-Ons": "附加元件",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "雙向的外部連線 — 外部 MCP 工具伺服器、本安裝自身的 MCP 伺服器，以及出站 Webhook。",
    Providers: "服務商",
    Media: "媒體",
    "External MCP": "外部 MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "本站連接的外部服務 — 媒體生成、第三方帳戶，以及外部 MCP 工具伺服器。",

  },
  "pt-BR": {
    "Always allow": "Sempre permitir", "These tools run without asking. Revoke one and it asks again.": "Estas ferramentas rodam sem perguntar. Revogue uma e ela volta a perguntar.", "Revoke": "Revogar", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Nada está em Sempre permitir. Escolha no cartão de aprovação de uma ferramenta no chat.", "Loading…": "Carregando…", "Couldn't load this list.": "Não foi possível carregar esta lista.", "Couldn't revoke. Try again.": "Não foi possível revogar. Tente novamente.",
    "Saved — restart {productName} to connect": "Salvo — reinicie o {productName} para conectar", "Changes apply when {productName} restarts": "As alterações são aplicadas quando o {productName} reinicia", "Coming soon": "Em breve", "Nothing below is connected to anything yet.": "Nada abaixo está conectado a nada ainda.", "Webhooks can't fire yet — nothing here is wired up.": "Os webhooks ainda não podem disparar — nada aqui está conectado.",
    Integrations: "Integrações",
    "Add-Ons": "Complementos",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Conexões externas em ambas as direções — servidores de ferramentas MCP externos, o próprio servidor MCP desta instalação e webhooks de saída.",
    Providers: "Provedores",
    Media: "Mídia",
    "External MCP": "MCP externo",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Serviços externos aos quais este site se conecta — geração de mídia, contas de terceiros e servidores de ferramentas MCP externos.",

  },
  ru: {
    "Always allow": "Всегда разрешать", "These tools run without asking. Revoke one and it asks again.": "Эти инструменты работают без запроса. Отзовите один — и он снова будет спрашивать.", "Revoke": "Отозвать", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Нет инструментов с «Всегда разрешать». Выберите это на карточке подтверждения инструмента в чате.", "Loading…": "Загрузка…", "Couldn't load this list.": "Не удалось загрузить список.", "Couldn't revoke. Try again.": "Не удалось отозвать. Попробуйте ещё раз.",
    "Saved — restart {productName} to connect": "Сохранено — перезапустите {productName} для подключения", "Changes apply when {productName} restarts": "Изменения применятся после перезапуска {productName}", "Coming soon": "Скоро", "Nothing below is connected to anything yet.": "Ниже пока ничего не подключено.", "Webhooks can't fire yet — nothing here is wired up.": "Вебхуки пока не могут срабатывать — здесь ничего не подключено.",
    Integrations: "Интеграции",
    "Add-Ons": "Дополнения",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Внешние подключения в обоих направлениях — внешние MCP-серверы инструментов, собственный MCP-сервер этой установки и исходящие вебхуки.",
    Providers: "Провайдеры",
    Media: "Медиа",
    "External MCP": "Внешний MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Внешние сервисы, к которым подключён этот сайт — генерация медиа, сторонние аккаунты и внешние MCP-серверы инструментов.",

  },
  fa: {
    "Always allow": "همیشه مجاز", "These tools run without asking. Revoke one and it asks again.": "این ابزارها بدون پرسش اجرا می‌شوند. یکی را لغو کنید تا دوباره بپرسد.", "Revoke": "لغو", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "هیچ ابزاری روی «همیشه مجاز» نیست. آن را در کارت تأیید ابزار در گفتگو انتخاب کنید.", "Loading…": "در حال بارگذاری…", "Couldn't load this list.": "بارگذاری این فهرست ممکن نشد.", "Couldn't revoke. Try again.": "لغو ممکن نشد. دوباره تلاش کنید.",
    "Saved — restart {productName} to connect": "ذخیره شد — برای اتصال {productName} را راه‌اندازی مجدد کنید", "Changes apply when {productName} restarts": "تغییرات با راه‌اندازی مجدد {productName} اعمال می‌شوند", "Coming soon": "به‌زودی", "Nothing below is connected to anything yet.": "هنوز چیزی در پایین به چیزی متصل نیست.", "Webhooks can't fire yet — nothing here is wired up.": "وب‌هوک‌ها هنوز نمی‌توانند اجرا شوند — چیزی در اینجا متصل نیست.",
    Integrations: "یکپارچه‌سازی‌ها",
    "Add-Ons": "افزودنی‌ها",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "اتصالات بیرونی در هر دو جهت — سرورهای ابزار MCP خارجی، سرور MCP خود این نصب، و وب‌هوک‌های خروجی.",
    Providers: "ارائه‌دهندگان",
    Media: "رسانه",
    "External MCP": "MCP خارجی",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "سرویس‌های خارجی که این سایت به آن‌ها متصل می‌شود — تولید رسانه، حساب‌های شخص ثالث و سرورهای ابزار MCP خارجی.",

  },
  ar: {
    "Always allow": "السماح دائمًا", "These tools run without asking. Revoke one and it asks again.": "تعمل هذه الأدوات دون سؤال. ألغِ إحداها وستسأل مجددًا.", "Revoke": "إلغاء", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "لا شيء مضبوط على «السماح دائمًا». اختره من بطاقة الموافقة على الأداة في الدردشة.", "Loading…": "جارٍ التحميل…", "Couldn't load this list.": "تعذّر تحميل هذه القائمة.", "Couldn't revoke. Try again.": "تعذّر الإلغاء. حاول مرة أخرى.",
    "Saved — restart {productName} to connect": "تم الحفظ — أعد تشغيل {productName} للاتصال", "Changes apply when {productName} restarts": "تُطبّق التغييرات عند إعادة تشغيل {productName}", "Coming soon": "قريبًا", "Nothing below is connected to anything yet.": "لا يوجد شيء أدناه متصل بأي شيء بعد.", "Webhooks can't fire yet — nothing here is wired up.": "لا يمكن لخطافات الويب العمل بعد — لا شيء هنا موصول.",
    Integrations: "عمليات التكامل",
    "Add-Ons": "الوظائف الإضافية",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "اتصالات خارجية في كلا الاتجاهين — خوادم أدوات MCP الخارجية، وخادم MCP الخاص بهذا التثبيت، وWebhooks الصادرة.",
    Providers: "المزودون",
    Media: "الوسائط",
    "External MCP": "MCP خارجي",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "الخدمات الخارجية التي يتصل بها هذا الموقع — توليد الوسائط، وحسابات الأطراف الثالثة، وخوادم أدوات MCP الخارجية.",

  },
  ja: {
    "Always allow": "常に許可", "These tools run without asking. Revoke one and it asks again.": "これらのツールは確認なしで実行されます。取り消すと再び確認します。", "Revoke": "取り消す", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "「常に許可」に設定されたものはありません。チャットでツールの承認カードから選べます。", "Loading…": "読み込み中…", "Couldn't load this list.": "この一覧を読み込めませんでした。", "Couldn't revoke. Try again.": "取り消せませんでした。もう一度お試しください。",
    "Saved — restart {productName} to connect": "保存しました — 接続するには {productName} を再起動してください", "Changes apply when {productName} restarts": "{productName} の再起動時に変更が適用されます", "Coming soon": "近日公開", "Nothing below is connected to anything yet.": "下の項目はまだ何にも接続されていません。", "Webhooks can't fire yet — nothing here is wired up.": "Webhook はまだ発火できません — ここでは何も接続されていません。",
    Integrations: "連携",
    "Add-Ons": "アドオン",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "双方向の外部接続 — 外部 MCP ツールサーバー、このインストール自身の MCP サーバー、送信 Webhook。",
    Providers: "プロバイダー",
    Media: "メディア",
    "External MCP": "外部 MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "このサイトが接続する外部サービス — メディア生成、サードパーティのアカウント、外部 MCP ツールサーバー。",

  },
  ko: {
    "Always allow": "항상 허용", "These tools run without asking. Revoke one and it asks again.": "이 도구들은 묻지 않고 실행됩니다. 하나를 취소하면 다시 묻습니다.", "Revoke": "취소", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "항상 허용으로 설정된 항목이 없습니다. 채팅에서 도구의 승인 카드에서 선택하세요.", "Loading…": "불러오는 중…", "Couldn't load this list.": "이 목록을 불러올 수 없습니다.", "Couldn't revoke. Try again.": "취소하지 못했습니다. 다시 시도하세요.",
    "Saved — restart {productName} to connect": "저장됨 — 연결하려면 {productName}를 다시 시작하세요", "Changes apply when {productName} restarts": "{productName}를 다시 시작하면 변경 사항이 적용됩니다", "Coming soon": "곧 제공", "Nothing below is connected to anything yet.": "아래 항목은 아직 아무것에도 연결되어 있지 않습니다.", "Webhooks can't fire yet — nothing here is wired up.": "웹훅은 아직 실행할 수 없습니다 — 여기에는 연결된 항목이 없습니다.",
    Integrations: "통합",
    "Add-Ons": "부가 기능",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "양방향 외부 연결 — 외부 MCP 도구 서버, 이 설치 자체의 MCP 서버, 발신 웹훅.",
    Providers: "공급자",
    Media: "미디어",
    "External MCP": "외부 MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "이 사이트가 연결하는 외부 서비스 — 미디어 생성, 서드파티 계정, 외부 MCP 도구 서버.",

  },
  pl: {
    "Always allow": "Zawsze zezwalaj", "These tools run without asking. Revoke one and it asks again.": "Te narzędzia działają bez pytania. Cofnij jedno, a znów zapyta.", "Revoke": "Cofnij", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Nic nie ma ustawienia Zawsze zezwalaj. Wybierz je na karcie zatwierdzenia narzędzia w czacie.", "Loading…": "Wczytywanie…", "Couldn't load this list.": "Nie udało się wczytać tej listy.", "Couldn't revoke. Try again.": "Nie udało się cofnąć. Spróbuj ponownie.",
    "Saved — restart {productName} to connect": "Zapisano — uruchom ponownie {productName}, aby się połączyć", "Changes apply when {productName} restarts": "Zmiany zostaną zastosowane po ponownym uruchomieniu {productName}", "Coming soon": "Wkrótce", "Nothing below is connected to anything yet.": "Nic poniżej nie jest jeszcze podłączone.", "Webhooks can't fire yet — nothing here is wired up.": "Webhooki nie mogą jeszcze działać — nic tutaj nie jest podłączone.",
    Integrations: "Integracje",
    "Add-Ons": "Dodatki",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Zewnętrzne połączenia w obu kierunkach — zewnętrzne serwery narzędzi MCP, własny serwer MCP tej instalacji oraz wychodzące webhooki.",
    Providers: "Dostawcy",
    Media: "Media",
    "External MCP": "Zewnętrzny MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Zewnętrzne usługi, z którymi łączy się ta witryna — generowanie mediów, konta zewnętrzne i zewnętrzne serwery narzędzi MCP.",

  },
  hu: {
    "Always allow": "Mindig engedélyez", "These tools run without asking. Revoke one and it asks again.": "Ezek az eszközök kérdés nélkül futnak. Vonj vissza egyet, és újra kérdezni fog.", "Revoke": "Visszavonás", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Semmi sincs Mindig engedélyez állapotban. Válaszd ki egy eszköz jóváhagyási kártyáján a csevegésben.", "Loading…": "Betöltés…", "Couldn't load this list.": "Nem sikerült betölteni a listát.", "Couldn't revoke. Try again.": "Nem sikerült visszavonni. Próbáld újra.",
    "Saved — restart {productName} to connect": "Mentve — a csatlakozáshoz indítsa újra a {productName}t", "Changes apply when {productName} restarts": "A módosítások a {productName} újraindításakor lépnek életbe", "Coming soon": "Hamarosan", "Nothing below is connected to anything yet.": "Alább még semmi sincs semmihez csatlakoztatva.", "Webhooks can't fire yet — nothing here is wired up.": "A webhookok még nem indíthatók el — itt még semmi sincs bekötve.",
    Integrations: "Integrációk",
    "Add-Ons": "Kiegészítők",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Külső kapcsolatok mindkét irányban — külső MCP-eszközkiszolgálók, a telepítés saját MCP-kiszolgálója és kimenő webhookok.",
    Providers: "Szolgáltatók",
    Media: "Médiatár",
    "External MCP": "Külső MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Külső szolgáltatások, amelyekhez ez a webhely csatlakozik – médiagenerálás, harmadik féltől származó fiókok és külső MCP-eszközkiszolgálók.",

  },
  fr: {
    "Always allow": "Toujours autoriser", "These tools run without asking. Revoke one and it asks again.": "Ces outils s'exécutent sans demander. Révoquez-en un et il redemandera.", "Revoke": "Révoquer", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Rien n'est en Toujours autoriser. Choisissez-le sur la carte d'approbation d'un outil dans le chat.", "Loading…": "Chargement…", "Couldn't load this list.": "Impossible de charger cette liste.", "Couldn't revoke. Try again.": "Impossible de révoquer. Réessayez.",
    "Saved — restart {productName} to connect": "Enregistré — redémarrez {productName} pour vous connecter", "Changes apply when {productName} restarts": "Les modifications s’appliquent au redémarrage de {productName}", "Coming soon": "Bientôt disponible", "Nothing below is connected to anything yet.": "Rien ci-dessous n’est encore connecté.", "Webhooks can't fire yet — nothing here is wired up.": "Les webhooks ne peuvent pas encore se déclencher — rien n’est connecté ici.",
    Integrations: "Intégrations",
    "Add-Ons": "Modules complémentaires",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Connexions externes dans les deux sens — serveurs d'outils MCP externes, le propre serveur MCP de cette installation et les webhooks sortants.",
    Providers: "Fournisseurs",
    Media: "Médias",
    "External MCP": "MCP externe",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Services externes auxquels ce site se connecte — génération de médias, comptes tiers et serveurs d'outils MCP externes.",

  },
  uk: {
    "Always allow": "Завжди дозволяти", "These tools run without asking. Revoke one and it asks again.": "Ці інструменти працюють без запиту. Відкличте один — і він знову питатиме.", "Revoke": "Відкликати", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Немає інструментів із «Завжди дозволяти». Виберіть це на картці підтвердження інструмента в чаті.", "Loading…": "Завантаження…", "Couldn't load this list.": "Не вдалося завантажити список.", "Couldn't revoke. Try again.": "Не вдалося відкликати. Спробуйте ще раз.",
    "Saved — restart {productName} to connect": "Збережено — перезапустіть {productName} для підключення", "Changes apply when {productName} restarts": "Зміни буде застосовано після перезапуску {productName}", "Coming soon": "Незабаром", "Nothing below is connected to anything yet.": "Нижче ще нічого не підключено.", "Webhooks can't fire yet — nothing here is wired up.": "Вебхуки ще не можуть спрацьовувати — тут нічого не підключено.",
    Integrations: "Інтеграції",
    "Add-Ons": "Додатки",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Зовнішні з'єднання в обох напрямках — зовнішні MCP-сервери інструментів, власний MCP-сервер цієї інсталяції та вихідні вебхуки.",
    Providers: "Провайдери",
    Media: "Медіа",
    "External MCP": "Зовнішній MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Зовнішні сервіси, до яких підключається цей сайт — генерація медіа, сторонні акаунти та зовнішні MCP-сервери інструментів.",

  },
  tr: {
    "Always allow": "Her zaman izin ver", "These tools run without asking. Revoke one and it asks again.": "Bu araçlar sormadan çalışır. Birini iptal edersen yeniden sorar.", "Revoke": "İptal et", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Her zaman izin ver olarak ayarlı bir şey yok. Sohbette bir aracın onay kartından seçebilirsin.", "Loading…": "Yükleniyor…", "Couldn't load this list.": "Bu liste yüklenemedi.", "Couldn't revoke. Try again.": "İptal edilemedi. Tekrar dene.",
    "Saved — restart {productName} to connect": "Kaydedildi — bağlanmak için {productName}'yu yeniden başlatın", "Changes apply when {productName} restarts": "Değişiklikler {productName} yeniden başlatıldığında uygulanır", "Coming soon": "Yakında", "Nothing below is connected to anything yet.": "Aşağıda henüz hiçbir şey bağlı değil.", "Webhooks can't fire yet — nothing here is wired up.": "Webhook'lar henüz tetiklenemez — burada hiçbir şey bağlı değil.",
    Integrations: "Entegrasyonlar",
    "Add-Ons": "Uzantılar",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Her iki yönde de dış bağlantılar — harici MCP araç sunucuları, bu kurulumun kendi MCP sunucusu ve giden webhook'lar.",
    Providers: "Sağlayıcılar",
    Media: "Medya",
    "External MCP": "Harici MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Bu sitenin bağlandığı dış hizmetler — medya üretimi, üçüncü taraf hesapları ve harici MCP araç sunucuları.",

  },
  th: {
    "Always allow": "อนุญาตเสมอ", "These tools run without asking. Revoke one and it asks again.": "เครื่องมือเหล่านี้ทำงานโดยไม่ถาม เพิกถอนรายการใดแล้วจะถามอีกครั้ง", "Revoke": "เพิกถอน", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "ยังไม่มีรายการที่ตั้งเป็นอนุญาตเสมอ เลือกได้จากการ์ดอนุมัติของเครื่องมือในแชท", "Loading…": "กำลังโหลด…", "Couldn't load this list.": "โหลดรายการนี้ไม่ได้", "Couldn't revoke. Try again.": "เพิกถอนไม่สำเร็จ ลองอีกครั้ง",
    "Saved — restart {productName} to connect": "บันทึกแล้ว — รีสตาร์ท {productName} เพื่อเชื่อมต่อ", "Changes apply when {productName} restarts": "การเปลี่ยนแปลงจะมีผลเมื่อ {productName} รีสตาร์ท", "Coming soon": "เร็วๆ นี้", "Nothing below is connected to anything yet.": "ด้านล่างยังไม่มีสิ่งใดเชื่อมต่ออยู่", "Webhooks can't fire yet — nothing here is wired up.": "เว็บฮุกยังทำงานไม่ได้ — ที่นี่ยังไม่มีอะไรเชื่อมต่ออยู่",
    Integrations: "การผสานการทำงาน",
    "Add-Ons": "ส่วนเสริม",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "การเชื่อมต่อภายนอกทั้งสองทิศทาง — เซิร์ฟเวอร์เครื่องมือ MCP ภายนอก เซิร์ฟเวอร์ MCP ของการติดตั้งนี้เอง และเว็บฮุคขาออก",
    Providers: "ผู้ให้บริการ",
    Media: "สื่อ",
    "External MCP": "MCP ภายนอก",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "บริการภายนอกที่ไซต์นี้เชื่อมต่อ — การสร้างสื่อ บัญชีบุคคลที่สาม และเซิร์ฟเวอร์เครื่องมือ MCP ภายนอก",

  },
  it: {
    "Always allow": "Consenti sempre", "These tools run without asking. Revoke one and it asks again.": "Questi strumenti vengono eseguiti senza chiedere. Revocane uno e tornerà a chiedere.", "Revoke": "Revoca", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "Niente è impostato su Consenti sempre. Sceglilo sulla scheda di approvazione di uno strumento in chat.", "Loading…": "Caricamento…", "Couldn't load this list.": "Impossibile caricare questo elenco.", "Couldn't revoke. Try again.": "Impossibile revocare. Riprova.",
    "Saved — restart {productName} to connect": "Salvato — riavvia {productName} per connetterti", "Changes apply when {productName} restarts": "Le modifiche vengono applicate al riavvio di {productName}", "Coming soon": "Prossimamente", "Nothing below is connected to anything yet.": "Nulla qui sotto è ancora connesso.", "Webhooks can't fire yet — nothing here is wired up.": "I webhook non possono ancora attivarsi — qui non è collegato nulla.",
    Integrations: "Integrazioni",
    "Add-Ons": "Componenti aggiuntivi",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "Connessioni esterne in entrambe le direzioni — server di strumenti MCP esterni, il server MCP proprio di questa installazione e i webhook in uscita.",
    Providers: "Provider",
    Media: "Media",
    "External MCP": "MCP esterno",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "Servizi esterni a cui questo sito si connette: generazione di media, account di terze parti e server di strumenti MCP esterni.",

  },
  hi: {
    "Always allow": "हमेशा अनुमति दें", "These tools run without asking. Revoke one and it asks again.": "ये टूल बिना पूछे चलते हैं। किसी एक को रद्द करें, वह फिर से पूछेगा।", "Revoke": "रद्द करें", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "कुछ भी हमेशा अनुमति दें पर सेट नहीं है। इसे चैट में किसी टूल के अनुमोदन कार्ड पर चुनें।", "Loading…": "लोड हो रहा है…", "Couldn't load this list.": "यह सूची लोड नहीं हो सकी।", "Couldn't revoke. Try again.": "रद्द नहीं हो सका। फिर से कोशिश करें।",
    "Saved — restart {productName} to connect": "सहेजा गया — कनेक्ट करने के लिए {productName} को पुनः प्रारंभ करें", "Changes apply when {productName} restarts": "{productName} के पुनः प्रारंभ होने पर बदलाव लागू होंगे", "Coming soon": "जल्द आ रहा है", "Nothing below is connected to anything yet.": "नीचे अभी कुछ भी कनेक्ट नहीं है।", "Webhooks can't fire yet — nothing here is wired up.": "वेबहुक अभी चल नहीं सकते — यहां कुछ भी जुड़ा नहीं है।",
    Integrations: "इंटीग्रेशन",
    "Add-Ons": "ऐड-ऑन",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "दोनों दिशाओं में बाहरी कनेक्शन — बाहरी MCP टूल सर्वर, इस इंस्टॉलेशन का अपना MCP सर्वर, और आउटबाउंड वेबहुक।",
    Providers: "प्रदाता",
    Media: "मीडिया",
    "External MCP": "बाहरी MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "बाहरी सेवाएँ जिनसे यह साइट जुड़ती है — मीडिया जनरेशन, थर्ड-पार्टी खाते, और बाहरी MCP टूल सर्वर।",

  },
  ur: {
    "Always allow": "ہمیشہ اجازت دیں", "These tools run without asking. Revoke one and it asks again.": "یہ ٹولز پوچھے بغیر چلتے ہیں۔ کسی ایک کو منسوخ کریں تو وہ دوبارہ پوچھے گا۔", "Revoke": "منسوخ کریں", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "کچھ بھی ہمیشہ اجازت دیں پر سیٹ نہیں ہے۔ اسے چیٹ میں کسی ٹول کے منظوری کارڈ پر منتخب کریں۔", "Loading…": "لوڈ ہو رہا ہے…", "Couldn't load this list.": "یہ فہرست لوڈ نہیں ہو سکی۔", "Couldn't revoke. Try again.": "منسوخ نہیں ہو سکا۔ دوبارہ کوشش کریں۔",
    "Saved — restart {productName} to connect": "محفوظ ہوگیا — جڑنے کے لیے {productName} دوبارہ شروع کریں", "Changes apply when {productName} restarts": "{productName} دوبارہ شروع ہونے پر تبدیلیاں لاگو ہوں گی", "Coming soon": "جلد آرہا ہے", "Nothing below is connected to anything yet.": "نیچے ابھی کچھ بھی کسی چیز سے منسلک نہیں ہے۔", "Webhooks can't fire yet — nothing here is wired up.": "ویب ہکس ابھی چل نہیں سکتے — یہاں کچھ بھی منسلک نہیں ہے۔",
    Integrations: "انٹیگریشنز",
    "Add-Ons": "ایڈ آنز",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "دونوں سمتوں میں بیرونی رابطے — بیرونی MCP ٹول سرورز، اس انسٹالیشن کا اپنا MCP سرور، اور آؤٹ باؤنڈ ویب ہکس۔",
    Providers: "فراہم کنندگان",
    Media: "میڈیا",
    "External MCP": "بیرونی MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "بیرونی سروسز جن سے یہ سائٹ جڑتی ہے — میڈیا جنریشن، تھرڈ پارٹی اکاؤنٹس، اور بیرونی MCP ٹول سرورز۔",

  },
  bn: {
    "Always allow": "সবসময় অনুমতি দিন", "These tools run without asking. Revoke one and it asks again.": "এই টুলগুলো জিজ্ঞেস না করেই চলে। একটি প্রত্যাহার করলে সেটি আবার জিজ্ঞেস করবে।", "Revoke": "প্রত্যাহার", "Nothing is set to Always allow. Pick it on a tool's approval card in chat.": "কিছুই সবসময় অনুমতি দিন-এ সেট নেই। চ্যাটে কোনো টুলের অনুমোদন কার্ডে এটি বেছে নিন।", "Loading…": "লোড হচ্ছে…", "Couldn't load this list.": "এই তালিকা লোড করা যায়নি।", "Couldn't revoke. Try again.": "প্রত্যাহার করা যায়নি। আবার চেষ্টা করুন।",
    "Saved — restart {productName} to connect": "সংরক্ষিত — সংযোগ করতে {productName} পুনরায় চালু করুন", "Changes apply when {productName} restarts": "{productName} পুনরায় চালু হলে পরিবর্তনগুলি প্রয়োগ হবে", "Coming soon": "শীঘ্রই আসছে", "Nothing below is connected to anything yet.": "নিচে এখনও কিছুই সংযুক্ত নেই।", "Webhooks can't fire yet — nothing here is wired up.": "ওয়েবহুক এখনও চালু হতে পারে না — এখানে কিছুই সংযুক্ত নেই।",
    Integrations: "ইন্টিগ্রেশন",
    "Add-Ons": "অ্যাড-অন",
    "Outside connections in both directions — external MCP tool servers, this install's own MCP server, and outbound webhooks.":
      "উভয় দিকে বাহ্যিক সংযোগ — বাহ্যিক MCP টুল সার্ভার, এই ইনস্টলেশনের নিজস্ব MCP সার্ভার এবং আউটবাউন্ড ওয়েবহুক।",
    Providers: "প্রদানকারী",
    Media: "মিডিয়া",
    "External MCP": "বাহ্যিক MCP",
    "Outside services this site connects to — media generation, third-party accounts, and external MCP tool servers.":
      "বাহ্যিক পরিষেবা যেগুলির সঙ্গে এই সাইট যুক্ত হয় — মিডিয়া জেনারেশন, তৃতীয় পক্ষের অ্যাকাউন্ট, এবং বাহ্যিক MCP টুল সার্ভার।",

  },
};

/** Same two-step fallback every other `t()` in this app uses: translated value, else the English
 *  source string itself — never a raw dictionary-miss placeholder. */

/** The host binds its commonDictionary and product name once; `t` falls back to the common copy on a miss. */
export function createProvidersDictionary(
  { commonDictionary, productName }: { commonDictionary: LocaleDictionary; productName: string },
  _optional = {},
): { t: DictionaryTranslator } {
  const featureDictionary = bindDictionaryNames({ dictionary: PROVIDERS_DICT, names: { productName } });
  return { t: createDictionaryTranslator({ featureDictionary }, { commonDictionary }) };
}
