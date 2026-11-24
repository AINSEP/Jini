/**
 * @file Menus dictionary slice — the page-link item type's three labels, in every locale. One of the slices the former
 * single host `menus-i18n.ts` was split into (K4i); `create-menus-dictionary.ts` composes it. The compact
 * `PAGE_LINK_COPY` table is kept as authored and expanded into dictionary entries below, exactly as the host
 * file's trailing loop did.
 */
/** Page references reuse entryRef; these labels expose pages by title rather than their ids. */
const PAGE_LINK_COPY: Record<string, readonly [string, string, string]> = {
  "es": ["Página","Elige una página…","Página no publicada"],
  "id": ["Halaman","Pilih halaman…","Halaman belum diterbitkan"],
  "de": ["Seite","Seite auswählen…","Seite nicht veröffentlicht"],
  "zh-CN": ["页面","选择页面…","页面未发布"],
  "zh-TW": ["頁面","選擇頁面…","頁面未發佈"],
  "pt-BR": ["Página","Escolha uma página…","Página não publicada"],
  "ru": ["Страница","Выберите страницу…","Страница не опубликована"],
  "fa": ["صفحه","یک صفحه انتخاب کنید…","صفحه منتشر نشده است"],
  "ar": ["صفحة","اختر صفحة…","الصفحة غير منشورة"],
  "ja": ["ページ","ページを選択…","ページは未公開です"],
  "ko": ["페이지","페이지 선택…","게시되지 않은 페이지"],
  "pl": ["Strona","Wybierz stronę…","Strona nieopublikowana"],
  "hu": ["Oldal","Válasszon oldalt…","Az oldal nincs közzétéve"],
  "fr": ["Page","Choisissez une page…","Page non publiée"],
  "uk": ["Сторінка","Виберіть сторінку…","Сторінка не опублікована"],
  "tr": ["Sayfa","Bir sayfa seçin…","Sayfa yayımlanmamış"],
  "th": ["หน้า","เลือกหน้า…","หน้ายังไม่ได้เผยแพร่"],
  "it": ["Pagina","Scegli una pagina…","Pagina non pubblicata"],
  "hi": ["पृष्ठ","कोई पृष्ठ चुनें…","पृष्ठ प्रकाशित नहीं है"],
  "ur": ["صفحہ","ایک صفحہ منتخب کریں…","صفحہ شائع نہیں ہوا"],
  "bn": ["পৃষ্ঠা","একটি পৃষ্ঠা বেছে নিন…","পৃষ্ঠা প্রকাশিত হয়নি"],
};
export const MENUS_PAGE_LINK_I18N: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(PAGE_LINK_COPY).map(([locale, [page, choosePage, unpublished]]) => [
    locale,
    { "Page": page, "Choose a page…": choosePage, "Page not published": unpublished },
  ]),
);
