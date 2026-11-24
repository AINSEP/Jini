/**
 * @file Categories & Tags screen dictionary slice — the Categories & Tags box the post, page and collection-entry editors mount (`TermPicker.tsx`), in every locale. Merged over the main slices by
 * `create-taxonomy-dictionary.ts`, so an entry here wins on a key collision.
 */
// 2026-09-26: the Categories & Tags box the post, page and collection-entry editors mount
// (`TermPicker.tsx`, `hooks/use-term-picker.hooks.ts`) — its copy, in all 21 locales. Moved here
// from `collections-i18n.ts` when the box became shared; "Categories & Tags", "No terms yet." and
// "Saving…" are already in this dictionary's other slices.
export const TAXONOMY_TERM_PICKER_I18N: Record<string, Record<string, string>> = {
  "es": { "Tick the categories and tags that apply, then save.": "Marca las categorías y etiquetas que correspondan y luego guarda.", "Save categories & tags": "Guardar categorías y etiquetas", "Categories & tags saved.": "Categorías y etiquetas guardadas.", "Failed to save categories & tags": "No se pudieron guardar las categorías y etiquetas", "Loading categories & tags…": "Cargando categorías y etiquetas…", "Failed to load categories & tags": "No se pudieron cargar las categorías y etiquetas" },
  "id": { "Tick the categories and tags that apply, then save.": "Centang kategori dan tag yang sesuai, lalu simpan.", "Save categories & tags": "Simpan kategori & tag", "Categories & tags saved.": "Kategori & tag disimpan.", "Failed to save categories & tags": "Gagal menyimpan kategori & tag", "Loading categories & tags…": "Memuat kategori & tag…", "Failed to load categories & tags": "Gagal memuat kategori & tag" },
  "de": { "Tick the categories and tags that apply, then save.": "Passende Kategorien und Schlagwörter anhaken, dann speichern.", "Save categories & tags": "Kategorien & Schlagwörter speichern", "Categories & tags saved.": "Kategorien & Schlagwörter gespeichert.", "Failed to save categories & tags": "Kategorien & Schlagwörter konnten nicht gespeichert werden", "Loading categories & tags…": "Kategorien & Schlagwörter werden geladen…", "Failed to load categories & tags": "Kategorien & Schlagwörter konnten nicht geladen werden" },
  "zh-CN": { "Tick the categories and tags that apply, then save.": "勾选适用的分类和标签，然后保存。", "Save categories & tags": "保存分类与标签", "Categories & tags saved.": "分类与标签已保存。", "Failed to save categories & tags": "无法保存分类与标签", "Loading categories & tags…": "正在加载分类与标签…", "Failed to load categories & tags": "无法加载分类与标签" },
  "zh-TW": { "Tick the categories and tags that apply, then save.": "勾選適用的分類和標籤，然後儲存。", "Save categories & tags": "儲存分類與標籤", "Categories & tags saved.": "分類與標籤已儲存。", "Failed to save categories & tags": "無法儲存分類與標籤", "Loading categories & tags…": "正在載入分類與標籤…", "Failed to load categories & tags": "無法載入分類與標籤" },
  "pt-BR": { "Tick the categories and tags that apply, then save.": "Marque as categorias e tags que se aplicam e salve.", "Save categories & tags": "Salvar categorias e tags", "Categories & tags saved.": "Categorias e tags salvas.", "Failed to save categories & tags": "Não foi possível salvar as categorias e tags", "Loading categories & tags…": "Carregando categorias e tags…", "Failed to load categories & tags": "Não foi possível carregar as categorias e tags" },
  "ru": { "Tick the categories and tags that apply, then save.": "Отметьте подходящие категории и теги, затем сохраните.", "Save categories & tags": "Сохранить категории и теги", "Categories & tags saved.": "Категории и теги сохранены.", "Failed to save categories & tags": "Не удалось сохранить категории и теги", "Loading categories & tags…": "Загрузка категорий и тегов…", "Failed to load categories & tags": "Не удалось загрузить категории и теги" },
  "fa": { "Tick the categories and tags that apply, then save.": "دسته‌بندی‌ها و برچسب‌های مرتبط را علامت بزنید، سپس ذخیره کنید.", "Save categories & tags": "ذخیره دسته‌بندی‌ها و برچسب‌ها", "Categories & tags saved.": "دسته‌بندی‌ها و برچسب‌ها ذخیره شد.", "Failed to save categories & tags": "ذخیره دسته‌بندی‌ها و برچسب‌ها ناموفق بود", "Loading categories & tags…": "در حال بارگذاری دسته‌بندی‌ها و برچسب‌ها…", "Failed to load categories & tags": "بارگذاری دسته‌بندی‌ها و برچسب‌ها ناموفق بود" },
  "ar": { "Tick the categories and tags that apply, then save.": "حدّد التصنيفات والوسوم المناسبة، ثم احفظ.", "Save categories & tags": "حفظ التصنيفات والوسوم", "Categories & tags saved.": "تم حفظ التصنيفات والوسوم.", "Failed to save categories & tags": "تعذّر حفظ التصنيفات والوسوم", "Loading categories & tags…": "جارٍ تحميل التصنيفات والوسوم…", "Failed to load categories & tags": "تعذّر تحميل التصنيفات والوسوم" },
  "ja": { "Tick the categories and tags that apply, then save.": "当てはまるカテゴリーとタグにチェックを入れて保存してください。", "Save categories & tags": "カテゴリーとタグを保存", "Categories & tags saved.": "カテゴリーとタグを保存しました。", "Failed to save categories & tags": "カテゴリーとタグを保存できませんでした", "Loading categories & tags…": "カテゴリーとタグを読み込み中…", "Failed to load categories & tags": "カテゴリーとタグを読み込めませんでした" },
  "ko": { "Tick the categories and tags that apply, then save.": "해당하는 카테고리와 태그를 선택한 뒤 저장하세요.", "Save categories & tags": "카테고리 및 태그 저장", "Categories & tags saved.": "카테고리 및 태그를 저장했습니다.", "Failed to save categories & tags": "카테고리 및 태그를 저장하지 못했습니다", "Loading categories & tags…": "카테고리 및 태그 불러오는 중…", "Failed to load categories & tags": "카테고리 및 태그를 불러오지 못했습니다" },
  "pl": { "Tick the categories and tags that apply, then save.": "Zaznacz pasujące kategorie i tagi, a potem zapisz.", "Save categories & tags": "Zapisz kategorie i tagi", "Categories & tags saved.": "Zapisano kategorie i tagi.", "Failed to save categories & tags": "Nie udało się zapisać kategorii i tagów", "Loading categories & tags…": "Wczytywanie kategorii i tagów…", "Failed to load categories & tags": "Nie udało się wczytać kategorii i tagów" },
  "hu": { "Tick the categories and tags that apply, then save.": "Jelöld be a megfelelő kategóriákat és címkéket, majd ments.", "Save categories & tags": "Kategóriák és címkék mentése", "Categories & tags saved.": "Kategóriák és címkék mentve.", "Failed to save categories & tags": "Nem sikerült menteni a kategóriákat és címkéket", "Loading categories & tags…": "Kategóriák és címkék betöltése…", "Failed to load categories & tags": "Nem sikerült betölteni a kategóriákat és címkéket" },
  "fr": { "Tick the categories and tags that apply, then save.": "Cochez les catégories et étiquettes qui s’appliquent, puis enregistrez.", "Save categories & tags": "Enregistrer les catégories et étiquettes", "Categories & tags saved.": "Catégories et étiquettes enregistrées.", "Failed to save categories & tags": "Impossible d’enregistrer les catégories et étiquettes", "Loading categories & tags…": "Chargement des catégories et étiquettes…", "Failed to load categories & tags": "Impossible de charger les catégories et étiquettes" },
  "uk": { "Tick the categories and tags that apply, then save.": "Позначте відповідні категорії та теги, потім збережіть.", "Save categories & tags": "Зберегти категорії та теги", "Categories & tags saved.": "Категорії та теги збережено.", "Failed to save categories & tags": "Не вдалося зберегти категорії та теги", "Loading categories & tags…": "Завантаження категорій і тегів…", "Failed to load categories & tags": "Не вдалося завантажити категорії та теги" },
  "tr": { "Tick the categories and tags that apply, then save.": "Uygun kategori ve etiketleri işaretleyip kaydedin.", "Save categories & tags": "Kategorileri ve etiketleri kaydet", "Categories & tags saved.": "Kategoriler ve etiketler kaydedildi.", "Failed to save categories & tags": "Kategoriler ve etiketler kaydedilemedi", "Loading categories & tags…": "Kategoriler ve etiketler yükleniyor…", "Failed to load categories & tags": "Kategoriler ve etiketler yüklenemedi" },
  "th": { "Tick the categories and tags that apply, then save.": "เลือกหมวดหมู่และแท็กที่เกี่ยวข้อง แล้วบันทึก", "Save categories & tags": "บันทึกหมวดหมู่และแท็ก", "Categories & tags saved.": "บันทึกหมวดหมู่และแท็กแล้ว", "Failed to save categories & tags": "บันทึกหมวดหมู่และแท็กไม่สำเร็จ", "Loading categories & tags…": "กำลังโหลดหมวดหมู่และแท็ก…", "Failed to load categories & tags": "โหลดหมวดหมู่และแท็กไม่สำเร็จ" },
  "it": { "Tick the categories and tags that apply, then save.": "Seleziona le categorie e i tag pertinenti, poi salva.", "Save categories & tags": "Salva categorie e tag", "Categories & tags saved.": "Categorie e tag salvati.", "Failed to save categories & tags": "Impossibile salvare categorie e tag", "Loading categories & tags…": "Caricamento di categorie e tag…", "Failed to load categories & tags": "Impossibile caricare categorie e tag" },
  "hi": { "Tick the categories and tags that apply, then save.": "लागू होने वाली श्रेणियाँ और टैग चुनें, फिर सहेजें।", "Save categories & tags": "श्रेणियाँ और टैग सहेजें", "Categories & tags saved.": "श्रेणियाँ और टैग सहेजे गए।", "Failed to save categories & tags": "श्रेणियाँ और टैग सहेजे नहीं जा सके", "Loading categories & tags…": "श्रेणियाँ और टैग लोड हो रहे हैं…", "Failed to load categories & tags": "श्रेणियाँ और टैग लोड नहीं हो सके" },
  "ur": { "Tick the categories and tags that apply, then save.": "متعلقہ زمرہ جات اور ٹیگز منتخب کریں، پھر محفوظ کریں۔", "Save categories & tags": "زمرہ جات اور ٹیگز محفوظ کریں", "Categories & tags saved.": "زمرہ جات اور ٹیگز محفوظ ہو گئے۔", "Failed to save categories & tags": "زمرہ جات اور ٹیگز محفوظ نہیں ہو سکے", "Loading categories & tags…": "زمرہ جات اور ٹیگز لوڈ ہو رہے ہیں…", "Failed to load categories & tags": "زمرہ جات اور ٹیگز لوڈ نہیں ہو سکے" },
  "bn": { "Tick the categories and tags that apply, then save.": "প্রযোজ্য বিভাগ ও ট্যাগগুলোতে টিক দিন, তারপর সংরক্ষণ করুন।", "Save categories & tags": "বিভাগ ও ট্যাগ সংরক্ষণ করুন", "Categories & tags saved.": "বিভাগ ও ট্যাগ সংরক্ষিত হয়েছে।", "Failed to save categories & tags": "বিভাগ ও ট্যাগ সংরক্ষণ করা যায়নি", "Loading categories & tags…": "বিভাগ ও ট্যাগ লোড হচ্ছে…", "Failed to load categories & tags": "বিভাগ ও ট্যাগ লোড করা যায়নি" },
};
// 2026-09-26: the box's own add input (`TermPicker.tsx`) — type a name to tick or create a term.
// "Term name", "+ Add term", "Add term" and "Failed to create term" are the Categories & Tags
// screen's own strings above, reused as-is.
export const TAXONOMY_TERM_PICKER_ADD_I18N: Record<string, Record<string, string>> = {
  "es": { "Type a name, then press Enter": "Escribe un nombre y pulsa Intro" },
  "id": { "Type a name, then press Enter": "Ketik nama, lalu tekan Enter" },
  "de": { "Type a name, then press Enter": "Namen eingeben, dann Eingabetaste drücken" },
  "zh-CN": { "Type a name, then press Enter": "输入名称，然后按回车键" },
  "zh-TW": { "Type a name, then press Enter": "輸入名稱，然後按 Enter 鍵" },
  "pt-BR": { "Type a name, then press Enter": "Digite um nome e pressione Enter" },
  "ru": { "Type a name, then press Enter": "Введите название и нажмите Enter" },
  "fa": { "Type a name, then press Enter": "یک نام بنویسید، سپس Enter را بزنید" },
  "ar": { "Type a name, then press Enter": "اكتب اسمًا ثم اضغط Enter" },
  "ja": { "Type a name, then press Enter": "名前を入力して Enter キーを押してください" },
  "ko": { "Type a name, then press Enter": "이름을 입력한 뒤 Enter 키를 누르세요" },
  "pl": { "Type a name, then press Enter": "Wpisz nazwę i naciśnij Enter" },
  "hu": { "Type a name, then press Enter": "Írj be egy nevet, majd nyomd meg az Entert" },
  "fr": { "Type a name, then press Enter": "Saisissez un nom, puis appuyez sur Entrée" },
  "uk": { "Type a name, then press Enter": "Введіть назву й натисніть Enter" },
  "tr": { "Type a name, then press Enter": "Bir ad yazın, ardından Enter'a basın" },
  "th": { "Type a name, then press Enter": "พิมพ์ชื่อ แล้วกด Enter" },
  "it": { "Type a name, then press Enter": "Digita un nome, poi premi Invio" },
  "hi": { "Type a name, then press Enter": "नाम लिखें, फिर Enter दबाएँ" },
  "ur": { "Type a name, then press Enter": "نام لکھیں، پھر Enter دبائیں" },
  "bn": { "Type a name, then press Enter": "একটি নাম লিখুন, তারপর Enter চাপুন" },
};
// 2026-10-22: a long row of the box folds behind "See more" / "Show less", with a search box once
// a taxonomy has more than 100 terms (`TermPicker.tsx`'s `TermChecklist`).
export const TAXONOMY_TERM_PICKER_REVEAL_I18N: Record<string, Record<string, string>> = {
  "es": { "See more": "Ver más", "Show less": "Ver menos", "Search terms": "Buscar términos" },
  "id": { "See more": "Lihat lainnya", "Show less": "Tampilkan lebih sedikit", "Search terms": "Cari istilah" },
  "de": { "See more": "Mehr anzeigen", "Show less": "Weniger anzeigen", "Search terms": "Begriffe suchen" },
  "zh-CN": { "See more": "查看更多", "Show less": "收起", "Search terms": "搜索术语" },
  "zh-TW": { "See more": "查看更多", "Show less": "收合", "Search terms": "搜尋詞彙" },
  "pt-BR": { "See more": "Ver mais", "Show less": "Ver menos", "Search terms": "Buscar termos" },
  "ru": { "See more": "Показать ещё", "Show less": "Свернуть", "Search terms": "Поиск терминов" },
  "fa": { "See more": "بیشتر ببینید", "Show less": "نمایش کمتر", "Search terms": "جستجوی اصطلاحات" },
  "ar": { "See more": "عرض المزيد", "Show less": "عرض أقل", "Search terms": "البحث في المصطلحات" },
  "ja": { "See more": "もっと見る", "Show less": "表示を減らす", "Search terms": "用語を検索" },
  "ko": { "See more": "더 보기", "Show less": "간략히 보기", "Search terms": "용어 검색" },
  "pl": { "See more": "Pokaż więcej", "Show less": "Pokaż mniej", "Search terms": "Szukaj terminów" },
  "hu": { "See more": "Több megjelenítése", "Show less": "Kevesebb megjelenítése", "Search terms": "Kifejezések keresése" },
  "fr": { "See more": "Voir plus", "Show less": "Voir moins", "Search terms": "Rechercher des termes" },
  "uk": { "See more": "Показати більше", "Show less": "Згорнути", "Search terms": "Пошук термінів" },
  "tr": { "See more": "Daha fazla gör", "Show less": "Daha az göster", "Search terms": "Terim ara" },
  "th": { "See more": "ดูเพิ่มเติม", "Show less": "แสดงน้อยลง", "Search terms": "ค้นหาคำศัพท์" },
  "it": { "See more": "Mostra altro", "Show less": "Mostra meno", "Search terms": "Cerca termini" },
  "hi": { "See more": "और देखें", "Show less": "कम दिखाएँ", "Search terms": "टर्म खोजें" },
  "ur": { "See more": "مزید دیکھیں", "Show less": "کم دکھائیں", "Search terms": "ٹرمز تلاش کریں" },
  "bn": { "See more": "আরও দেখুন", "Show less": "কম দেখান", "Search terms": "টার্ম খুঁজুন" },
};
