/**
 * @file Locale data for the taxonomy dictionary, part 4 of 4. Plain per-locale tables only; the factory in
 * `../taxonomy-i18n.ts` merges the parts and binds the host's names and common fallback.
 */

// 2026-09-26: the box's own add input (`TermPicker.tsx`) — type a name to tick or create a term.
// "Term name", "+ Add term", "Add term" and "Failed to create term" are the Categories & Tags
// screen's own strings above, reused as-is.
export const TERM_PICKER_ADD_I18N: Record<string, Record<string, string>> = {
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
export const TERM_PICKER_REVEAL_I18N: Record<string, Record<string, string>> = {
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