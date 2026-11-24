/**
 * @file Posts dictionary slice — the move-to-trash confirm dialog shared by `Posts.tsx` and `PostEditor.tsx`.
 *
 * The dialog composes `{t("Move")} "{title}" {t("to trash? It will disappear…")}`. In `ja`, `ko`, `tr`, `hi`, `ur`, and `bn`, the verb is embedded
 * in the trailing fragment after the quoted title (for example, `ja` has `をゴミ箱に移動しますか？…`).
 * `Move` therefore supplies a contextual prefix rather than a stray leading verb before the
 * sentence's subject. The parity test still excludes this key because the prefixes were once empty.
 *
 * A few entries exist in two `kindLabel`-specific variants (post vs. page) rather than one
 * template string with a substituted word — the English copy embeds "post"/"page" mid-sentence, and
 * Spanish grammar (gendered articles, different word order) doesn't reduce to a single-word swap the
 * way the English does.
 *
 * One of the slices the former single host `posts-i18n.ts` was split into by feature (K4i: a dictionary file
 * over 500 lines never blocks work, it is split by feature); `create-posts-dictionary.ts` composes them.
 * Every entry's text is unchanged, only regrouped by the feature that renders it.
 */
export const POSTS_TRASH_DIALOG_I18N: Record<string, Record<string, string>> = {
  es: {
    "Move to trash?": "¿Mover a la papelera?",
    "Move to trash": "Mover a la papelera",
    Move: "¿Mover",
    "to trash? It will disappear from the site and from this list.":
      "a la papelera? Desaparecerá del sitio y de esta lista.",
    "Move this page": "¿Mover esta página",
    "Move this post": "¿Mover esta entrada",
    "to trash? It will disappear from the site and from the pages list.":
      "a la papelera? Desaparecerá del sitio y de la lista de páginas.",
    "to trash? It will disappear from the site and from the posts list.":
      "a la papelera? Desaparecerá del sitio y de la lista de entradas.",
  },
  id: {
    "Move to trash?": "Pindahkan ke sampah?",
    "Move to trash": "Pindahkan ke sampah",
    Move: "Pindahkan",
    "to trash? It will disappear from the site and from this list.":
      "ke sampah? Ini akan hilang dari situs dan dari daftar ini.",
    "Move this page": "Pindahkan halaman ini",
    "Move this post": "Pindahkan postingan ini",
    "to trash? It will disappear from the site and from the pages list.":
      "ke sampah? Halaman ini akan hilang dari situs dan dari daftar halaman.",
    "to trash? It will disappear from the site and from the posts list.":
      "ke sampah? Postingan ini akan hilang dari situs dan dari daftar postingan.",
  },
  de: {
    "Move to trash?": "In den Papierkorb verschieben?",
    "Move to trash": "In den Papierkorb verschieben",
    Move: "Verschiebe",
    "to trash? It will disappear from the site and from this list.":
      "in den Papierkorb? Sie verschwindet von der Website und aus dieser Liste.",
    "Move this page": "Diese Seite verschieben",
    "Move this post": "Diesen Beitrag verschieben",
    "to trash? It will disappear from the site and from the pages list.":
      "in den Papierkorb? Sie verschwindet von der Website und aus der Seitenliste.",
    "to trash? It will disappear from the site and from the posts list.":
      "in den Papierkorb? Er verschwindet von der Website und aus der Beitragsliste.",
  },
  "zh-CN": {
    "Move to trash?": "移到回收站？",
    "Move to trash": "移到回收站",
    Move: "将",
    "to trash? It will disappear from the site and from this list.":
      "移到回收站？它将从网站和此列表中消失。",
    "Move this page": "移动此页面",
    "Move this post": "移动此文章",
    "to trash? It will disappear from the site and from the pages list.":
      "到回收站？它将从网站和页面列表中消失。",
    "to trash? It will disappear from the site and from the posts list.":
      "到回收站？它将从网站和文章列表中消失。",
  },
  "zh-TW": {
    "Move to trash?": "移到資源回收筒？",
    "Move to trash": "移到資源回收筒",
    Move: "將",
    "to trash? It will disappear from the site and from this list.":
      "移到資源回收筒？它將從網站和此清單中消失。",
    "Move this page": "移動此頁面",
    "Move this post": "移動此文章",
    "to trash? It will disappear from the site and from the pages list.":
      "到資源回收筒？它將從網站和頁面清單中消失。",
    "to trash? It will disappear from the site and from the posts list.":
      "到資源回收筒？它將從網站和文章清單中消失。",
  },
  "pt-BR": {
    "Move to trash?": "Mover para a lixeira?",
    "Move to trash": "Mover para a lixeira",
    Move: "Mover",
    "to trash? It will disappear from the site and from this list.":
      "para a lixeira? Ela desaparecerá do site e desta lista.",
    "Move this page": "Mover esta página",
    "Move this post": "Mover esta publicação",
    "to trash? It will disappear from the site and from the pages list.":
      "para a lixeira? Ela desaparecerá do site e da lista de páginas.",
    "to trash? It will disappear from the site and from the posts list.":
      "para a lixeira? Ela desaparecerá do site e da lista de publicações.",
  },
  ru: {
    "Move to trash?": "Переместить в корзину?",
    "Move to trash": "Переместить в корзину",
    Move: "Переместить",
    "to trash? It will disappear from the site and from this list.":
      "в корзину? Она исчезнет с сайта и из этого списка.",
    "Move this page": "Переместить эту страницу",
    "Move this post": "Переместить эту запись",
    "to trash? It will disappear from the site and from the pages list.":
      "в корзину? Она исчезнет с сайта и из списка страниц.",
    "to trash? It will disappear from the site and from the posts list.":
      "в корзину? Она исчезнет с сайта и из списка записей.",
  },
  fa: {
    "Move to trash?": "به زباله‌دان منتقل شود؟",
    "Move to trash": "انتقال به زباله‌دان",
    Move: "آیا می‌خواهید",
    "to trash? It will disappear from the site and from this list.":
      "را به زباله‌دان منتقل کنید؟ از سایت و از این فهرست ناپدید خواهد شد.",
    "Move this page": "آیا می‌خواهید این صفحه",
    "Move this post": "آیا می‌خواهید این نوشته",
    "to trash? It will disappear from the site and from the pages list.":
      "را به زباله‌دان منتقل کنید؟ از سایت و از فهرست صفحات ناپدید خواهد شد.",
    "to trash? It will disappear from the site and from the posts list.":
      "را به زباله‌دان منتقل کنید؟ از سایت و از فهرست نوشته‌ها ناپدید خواهد شد.",
  },
  ar: {
    "Move to trash?": "هل تريد النقل إلى سلة المهملات؟",
    "Move to trash": "نقل إلى سلة المهملات",
    Move: "هل تريد نقل",
    "to trash? It will disappear from the site and from this list.":
      "إلى سلة المهملات؟ ستختفي من الموقع ومن هذه القائمة.",
    "Move this page": "هل تريد نقل هذه الصفحة",
    "Move this post": "هل تريد نقل هذا المنشور",
    "to trash? It will disappear from the site and from the pages list.":
      "إلى سلة المهملات؟ ستختفي من الموقع ومن قائمة الصفحات.",
    "to trash? It will disappear from the site and from the posts list.":
      "إلى سلة المهملات؟ سيختفي من الموقع ومن قائمة المنشورات.",
  },
  ja: {
    "Move to trash?": "ゴミ箱に移動しますか？",
    "Move to trash": "ゴミ箱に移動",
    Move: "次の項目",
    "to trash? It will disappear from the site and from this list.":
      "をゴミ箱に移動しますか？サイトとこの一覧から削除されます。",
    "Move this page": "このページ",
    "Move this post": "この投稿",
    "to trash? It will disappear from the site and from the pages list.":
      "をゴミ箱に移動しますか？サイトとページ一覧から削除されます。",
    "to trash? It will disappear from the site and from the posts list.":
      "をゴミ箱に移動しますか？サイトと投稿一覧から削除されます。",
  },
  ko: {
    "Move to trash?": "휴지통으로 이동할까요?",
    "Move to trash": "휴지통으로 이동",
    Move: "선택한",
    "to trash? It will disappear from the site and from this list.":
      "항목을 휴지통으로 이동할까요? 사이트와 이 목록에서 사라집니다.",
    "Move this page": "이 페이지",
    "Move this post": "이 게시물",
    "to trash? It will disappear from the site and from the pages list.":
      "를 휴지통으로 이동할까요? 사이트와 페이지 목록에서 사라집니다.",
    "to trash? It will disappear from the site and from the posts list.":
      "을 휴지통으로 이동할까요? 사이트와 게시물 목록에서 사라집니다.",
  },
  pl: {
    "Move to trash?": "Przenieść do kosza?",
    "Move to trash": "Przenieś do kosza",
    Move: "Przenieś",
    "to trash? It will disappear from the site and from this list.":
      "do kosza? Zniknie z witryny i z tej listy.",
    "Move this page": "Przenieść tę stronę",
    "Move this post": "Przenieść ten wpis",
    "to trash? It will disappear from the site and from the pages list.":
      "do kosza? Zniknie z witryny i z listy stron.",
    "to trash? It will disappear from the site and from the posts list.":
      "do kosza? Zniknie z witryny i z listy wpisów.",
  },
  hu: {
    "Move to trash?": "Áthelyezed a kukába?",
    "Move to trash": "Áthelyezés a kukába",
    Move: "Áthelyezés",
    "to trash? It will disappear from the site and from this list.":
      "a kukába? Eltűnik a webhelyről és erről a listáról.",
    "Move this page": "Áthelyezed ezt az oldalt",
    "Move this post": "Áthelyezed ezt a bejegyzést",
    "to trash? It will disappear from the site and from the pages list.":
      "a kukába? Eltűnik a webhelyről és az oldallistáról.",
    "to trash? It will disappear from the site and from the posts list.":
      "a kukába? Eltűnik a webhelyről és a bejegyzéslistáról.",
  },
  fr: {
    "Move to trash?": "Déplacer vers la corbeille ?",
    "Move to trash": "Déplacer vers la corbeille",
    Move: "Déplacer",
    "to trash? It will disappear from the site and from this list.":
      "vers la corbeille ? Elle disparaîtra du site et de cette liste.",
    "Move this page": "Déplacer cette page",
    "Move this post": "Déplacer cet article",
    "to trash? It will disappear from the site and from the pages list.":
      "vers la corbeille ? Elle disparaîtra du site et de la liste des pages.",
    "to trash? It will disappear from the site and from the posts list.":
      "vers la corbeille ? Il disparaîtra du site et de la liste des articles.",
  },
  uk: {
    "Move to trash?": "Перемістити в кошик?",
    "Move to trash": "Перемістити в кошик",
    Move: "Перемістити",
    "to trash? It will disappear from the site and from this list.":
      "в кошик? Вона зникне з сайту та з цього списку.",
    "Move this page": "Перемістити цю сторінку",
    "Move this post": "Перемістити цей допис",
    "to trash? It will disappear from the site and from the pages list.":
      "в кошик? Вона зникне з сайту та зі списку сторінок.",
    "to trash? It will disappear from the site and from the posts list.":
      "в кошик? Він зникне з сайту та зі списку дописів.",
  },
  tr: {
    "Move to trash?": "Çöp kutusuna taşınsın mı?",
    "Move to trash": "Çöp kutusuna taşı",
    Move: "Seçilen",
    "to trash? It will disappear from the site and from this list.":
      "öğesi çöp kutusuna taşınsın mı? Siteden ve bu listeden kaybolacak.",
    "Move this page": "Bu sayfa",
    "Move this post": "Bu gönderi",
    "to trash? It will disappear from the site and from the pages list.":
      "çöp kutusuna taşınsın mı? Siteden ve sayfa listesinden kaybolacak.",
    "to trash? It will disappear from the site and from the posts list.":
      "çöp kutusuna taşınsın mı? Siteden ve gönderi listesinden kaybolacak.",
  },
  th: {
    "Move to trash?": "ย้ายไปถังขยะหรือไม่",
    "Move to trash": "ย้ายไปถังขยะ",
    Move: "ย้าย",
    "to trash? It will disappear from the site and from this list.":
      "ไปถังขยะหรือไม่ จะหายไปจากเว็บไซต์และรายการนี้",
    "Move this page": "ย้ายหน้านี้",
    "Move this post": "ย้ายโพสต์นี้",
    "to trash? It will disappear from the site and from the pages list.":
      "ไปถังขยะหรือไม่ จะหายไปจากเว็บไซต์และรายการหน้า",
    "to trash? It will disappear from the site and from the posts list.":
      "ไปถังขยะหรือไม่ จะหายไปจากเว็บไซต์และรายการโพสต์",
  },
  it: {
    "Move to trash?": "Spostare nel cestino?",
    "Move to trash": "Sposta nel cestino",
    Move: "Sposta",
    "to trash? It will disappear from the site and from this list.":
      "nel cestino? Scomparirà dal sito e da questo elenco.",
    "Move this page": "Spostare questa pagina",
    "Move this post": "Spostare questo articolo",
    "to trash? It will disappear from the site and from the pages list.":
      "nel cestino? Scomparirà dal sito e dall'elenco delle pagine.",
    "to trash? It will disappear from the site and from the posts list.":
      "nel cestino? Scomparirà dal sito e dall'elenco degli articoli.",
  },
  hi: {
    "Move to trash?": "ट्रैश में भेजें?",
    "Move to trash": "ट्रैश में भेजें",
    Move: "क्या",
    "to trash? It will disappear from the site and from this list.":
      "को ट्रैश में भेजें? यह साइट और इस सूची से हट जाएगा।",
    "Move this page": "यह पेज",
    "Move this post": "यह पोस्ट",
    "to trash? It will disappear from the site and from the pages list.":
      "को ट्रैश में भेजें? यह साइट और पेज सूची से हट जाएगा।",
    "to trash? It will disappear from the site and from the posts list.":
      "को ट्रैश में भेजें? यह साइट और पोस्ट सूची से हट जाएगा।",
  },
  ur: {
    "Move to trash?": "ردی کی ٹوکری میں بھیجیں؟",
    "Move to trash": "ردی کی ٹوکری میں بھیجیں",
    Move: "کیا",
    "to trash? It will disappear from the site and from this list.":
      "کو ردی کی ٹوکری میں بھیجیں؟ یہ سائٹ اور اس فہرست سے غائب ہو جائے گا۔",
    "Move this page": "یہ صفحہ",
    "Move this post": "یہ پوسٹ",
    "to trash? It will disappear from the site and from the pages list.":
      "کو ردی کی ٹوکری میں بھیجیں؟ یہ سائٹ اور صفحات کی فہرست سے غائب ہو جائے گا۔",
    "to trash? It will disappear from the site and from the posts list.":
      "کو ردی کی ٹوکری میں بھیجیں؟ یہ سائٹ اور پوسٹس کی فہرست سے غائب ہو جائے گا۔",
  },
  bn: {
    "Move to trash?": "ট্র্যাশে সরাবেন?",
    "Move to trash": "ট্র্যাশে সরান",
    Move: "আপনি কি",
    "to trash? It will disappear from the site and from this list.":
      "কে ট্র্যাশে সরাবেন? এটি সাইট এবং এই তালিকা থেকে অদৃশ্য হয়ে যাবে।",
    "Move this page": "এই পেজটি",
    "Move this post": "এই পোস্টটি",
    "to trash? It will disappear from the site and from the pages list.":
      "কে ট্র্যাশে সরাবেন? এটি সাইট এবং পেজের তালিকা থেকে অদৃশ্য হয়ে যাবে।",
    "to trash? It will disappear from the site and from the posts list.":
      "কে ট্র্যাশে সরাবেন? এটি সাইট এবং পোস্টের তালিকা থেকে অদৃশ্য হয়ে যাবে।",
  },
};
