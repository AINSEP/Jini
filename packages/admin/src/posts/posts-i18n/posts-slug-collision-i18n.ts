/**
 * @file Posts dictionary slice — the slug-collision warning (`PostEditorSlugCollisionWarning.tsx`) shown when a post's slug matches one of the active theme's own pages, in every locale.
 *
 * One of the slices the former single host `posts-i18n.ts` was split into by feature (K4i: a dictionary file
 * over 500 lines never blocks work, it is split by feature); `create-posts-dictionary.ts` composes them.
 * Every entry's text is unchanged, only regrouped by the feature that renders it.
 */
export const POSTS_SLUG_COLLISION_I18N: Record<string, Record<string, string>> = {
  es: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.":
      "El slug de esta entrada coincide con una de las páginas del tema activo. De forma predeterminada, esta entrada se muestra en esa URL en lugar de la página del tema.",
    "Which page wins at this URL": "Qué página prevalece en esta URL",
    "Use the default (currently: this post)": "Usar el valor predeterminado (actualmente: esta entrada)",
    "Always show this post": "Mostrar siempre esta entrada",
    "Always show the theme's page": "Mostrar siempre la página del tema",
  },
  id: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Slug postingan ini sama dengan salah satu halaman milik tema aktif. Secara bawaan, postingan ini ditampilkan di URL tersebut, bukan halaman tema.",
    "Which page wins at this URL": "Halaman mana yang tampil di URL ini",
    "Use the default (currently: this post)": "Gunakan bawaan (saat ini: postingan ini)",
    "Always show this post": "Selalu tampilkan postingan ini",
    "Always show the theme's page": "Selalu tampilkan halaman tema",
  },
  de: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Der Slug dieses Beitrags stimmt mit einer der eigenen Seiten des aktiven Themes überein. Standardmäßig wird unter dieser URL dieser Beitrag statt der Seite des Themes angezeigt.",
    "Which page wins at this URL": "Welche Seite unter dieser URL angezeigt wird",
    "Use the default (currently: this post)": "Standard verwenden (derzeit: dieser Beitrag)",
    "Always show this post": "Diesen Beitrag immer anzeigen",
    "Always show the theme's page": "Die Seite des Themes immer anzeigen",
  },
  "zh-CN": {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "此文章的别名与活动主题自带的某个页面相同。默认情况下，该 URL 显示此文章，而不是主题的页面。",
    "Which page wins at this URL": "此 URL 显示哪个页面",
    "Use the default (currently: this post)": "使用默认设置（当前：此文章）",
    "Always show this post": "始终显示此文章",
    "Always show the theme's page": "始终显示主题的页面",
  },
  "zh-TW": {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "此文章的代稱與使用中主題自身的某個頁面相同。預設情況下，該 URL 會顯示此文章，而非主題的頁面。",
    "Which page wins at this URL": "此 URL 要顯示哪個頁面",
    "Use the default (currently: this post)": "使用預設值（目前：此文章）",
    "Always show this post": "一律顯示此文章",
    "Always show the theme's page": "一律顯示主題的頁面",
  },
  "pt-BR": {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "O slug desta publicação coincide com uma das páginas próprias do tema ativo. Por padrão, esta publicação é exibida nessa URL em vez da página do tema.",
    "Which page wins at this URL": "Qual página prevalece nesta URL",
    "Use the default (currently: this post)": "Usar o padrão (atualmente: esta publicação)",
    "Always show this post": "Sempre mostrar esta publicação",
    "Always show the theme's page": "Sempre mostrar a página do tema",
  },
  ru: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Ярлык этой записи совпадает с одной из собственных страниц активной темы. По умолчанию по этому URL показывается эта запись, а не страница темы.",
    "Which page wins at this URL": "Какая страница показывается по этому URL",
    "Use the default (currently: this post)": "Использовать значение по умолчанию (сейчас: эта запись)",
    "Always show this post": "Всегда показывать эту запись",
    "Always show the theme's page": "Всегда показывать страницу темы",
  },
  fa: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "نامک این نوشته با یکی از صفحه‌های خود پوستهٔ فعال یکسان است. به‌طور پیش‌فرض، این نوشته به‌جای صفحهٔ پوسته در آن URL نمایش داده می‌شود.",
    "Which page wins at this URL": "کدام صفحه در این URL نمایش داده شود",
    "Use the default (currently: this post)": "استفاده از پیش‌فرض (در حال حاضر: این نوشته)",
    "Always show this post": "همیشه این نوشته نمایش داده شود",
    "Always show the theme's page": "همیشه صفحهٔ پوسته نمایش داده شود",
  },
  ar: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "يتطابق الاسم اللطيف لهذا المنشور مع إحدى صفحات المظهر النشط الخاصة. افتراضيًا، يُعرض هذا المنشور على ذلك الرابط بدلًا من صفحة المظهر.",
    "Which page wins at this URL": "أي صفحة تُعرض على هذا الرابط",
    "Use the default (currently: this post)": "استخدام الافتراضي (حاليًا: هذا المنشور)",
    "Always show this post": "إظهار هذا المنشور دائمًا",
    "Always show the theme's page": "إظهار صفحة المظهر دائمًا",
  },
  ja: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "この投稿のスラッグは、有効なテーマ自体のページのいずれかと一致しています。デフォルトでは、そのURLにはテーマのページではなくこの投稿が表示されます。",
    "Which page wins at this URL": "このURLで表示するページ",
    "Use the default (currently: this post)": "デフォルトを使用（現在: この投稿）",
    "Always show this post": "常にこの投稿を表示",
    "Always show the theme's page": "常にテーマのページを表示",
  },
  ko: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "이 게시물의 슬러그가 활성 테마 자체 페이지 중 하나와 일치합니다. 기본적으로 해당 URL에는 테마의 페이지 대신 이 게시물이 표시됩니다.",
    "Which page wins at this URL": "이 URL에 표시할 페이지",
    "Use the default (currently: this post)": "기본값 사용(현재: 이 게시물)",
    "Always show this post": "항상 이 게시물 표시",
    "Always show the theme's page": "항상 테마의 페이지 표시",
  },
  pl: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Slug tego wpisu pokrywa się z jedną z własnych stron aktywnego motywu. Domyślnie pod tym adresem URL wyświetlany jest ten wpis zamiast strony motywu.",
    "Which page wins at this URL": "Która strona jest wyświetlana pod tym adresem URL",
    "Use the default (currently: this post)": "Użyj domyślnego (obecnie: ten wpis)",
    "Always show this post": "Zawsze pokazuj ten wpis",
    "Always show the theme's page": "Zawsze pokazuj stronę motywu",
  },
  hu: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Ennek a bejegyzésnek a slugja megegyezik az aktív téma egyik saját oldalával. Alapértelmezés szerint ezen az URL-en ez a bejegyzés jelenik meg a téma oldala helyett.",
    "Which page wins at this URL": "Melyik oldal jelenjen meg ezen az URL-en",
    "Use the default (currently: this post)": "Alapértelmezett használata (jelenleg: ez a bejegyzés)",
    "Always show this post": "Mindig ez a bejegyzés jelenjen meg",
    "Always show the theme's page": "Mindig a téma oldala jelenjen meg",
  },
  fr: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Le slug de cet article correspond à l’une des pages propres au thème actif. Par défaut, cet article est affiché à cette URL à la place de la page du thème.",
    "Which page wins at this URL": "Quelle page s’affiche à cette URL",
    "Use the default (currently: this post)": "Utiliser la valeur par défaut (actuellement : cet article)",
    "Always show this post": "Toujours afficher cet article",
    "Always show the theme's page": "Toujours afficher la page du thème",
  },
  uk: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Ярлик цього допису збігається з однією з власних сторінок активної теми. За замовчуванням за цією URL-адресою показується цей допис, а не сторінка теми.",
    "Which page wins at this URL": "Яка сторінка показується за цією URL-адресою",
    "Use the default (currently: this post)": "Використовувати типове значення (зараз: цей допис)",
    "Always show this post": "Завжди показувати цей допис",
    "Always show the theme's page": "Завжди показувати сторінку теми",
  },
  tr: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Bu gönderinin kısa adı, etkin temanın kendi sayfalarından biriyle eşleşiyor. Varsayılan olarak bu URL'de temanın sayfası yerine bu gönderi gösterilir.",
    "Which page wins at this URL": "Bu URL'de hangi sayfanın gösterileceği",
    "Use the default (currently: this post)": "Varsayılanı kullan (şu anda: bu gönderi)",
    "Always show this post": "Her zaman bu gönderiyi göster",
    "Always show the theme's page": "Her zaman temanın sayfasını göster",
  },
  th: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "ชื่อ URL ของโพสต์นี้ตรงกับหน้าหนึ่งของธีมที่ใช้งานอยู่ โดยค่าเริ่มต้น URL นั้นจะแสดงโพสต์นี้แทนหน้าของธีม",
    "Which page wins at this URL": "หน้าใดจะแสดงที่ URL นี้",
    "Use the default (currently: this post)": "ใช้ค่าเริ่มต้น (ปัจจุบัน: โพสต์นี้)",
    "Always show this post": "แสดงโพสต์นี้เสมอ",
    "Always show the theme's page": "แสดงหน้าของธีมเสมอ",
  },
  it: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "Lo slug di questo articolo corrisponde a una delle pagine proprie del tema attivo. Per impostazione predefinita, a quell’URL viene mostrato questo articolo invece della pagina del tema.",
    "Which page wins at this URL": "Quale pagina viene mostrata a questo URL",
    "Use the default (currently: this post)": "Usa l’impostazione predefinita (attualmente: questo articolo)",
    "Always show this post": "Mostra sempre questo articolo",
    "Always show the theme's page": "Mostra sempre la pagina del tema",
  },
  hi: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "इस पोस्ट का स्लग सक्रिय थीम के अपने किसी पेज से मेल खाता है। डिफ़ॉल्ट रूप से, उस URL पर थीम के पेज के बजाय यह पोस्ट दिखाई जाती है।",
    "Which page wins at this URL": "इस URL पर कौन-सा पेज दिखे",
    "Use the default (currently: this post)": "डिफ़ॉल्ट का उपयोग करें (वर्तमान में: यह पोस्ट)",
    "Always show this post": "हमेशा यह पोस्ट दिखाएँ",
    "Always show the theme's page": "हमेशा थीम का पेज दिखाएँ",
  },
  ur: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "اس پوسٹ کا سلگ فعال تھیم کے اپنے کسی صفحے سے ملتا ہے۔ بطورِ طے شدہ، اس URL پر تھیم کے صفحے کے بجائے یہ پوسٹ دکھائی جاتی ہے۔",
    "Which page wins at this URL": "اس URL پر کون سا صفحہ دکھایا جائے",
    "Use the default (currently: this post)": "طے شدہ استعمال کریں (فی الحال: یہ پوسٹ)",
    "Always show this post": "ہمیشہ یہ پوسٹ دکھائیں",
    "Always show the theme's page": "ہمیشہ تھیم کا صفحہ دکھائیں",
  },
  bn: {
    "This post's slug matches one of the active theme's own pages. By default, this post is shown at that URL instead of the theme's page.": "এই পোস্টের স্লাগ সক্রিয় থিমের নিজস্ব একটি পেজের সাথে মিলে যায়। ডিফল্টভাবে, ওই URL-এ থিমের পেজের বদলে এই পোস্টটি দেখানো হয়।",
    "Which page wins at this URL": "এই URL-এ কোন পেজ দেখানো হবে",
    "Use the default (currently: this post)": "ডিফল্ট ব্যবহার করুন (বর্তমানে: এই পোস্ট)",
    "Always show this post": "সবসময় এই পোস্ট দেখান",
    "Always show the theme's page": "সবসময় থিমের পেজ দেখান",
  },
};
