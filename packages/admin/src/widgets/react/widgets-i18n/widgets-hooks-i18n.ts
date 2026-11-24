/**
 * @file Widgets screens dictionary slice — the hook-level notice/error strings, in every locale. One of the slices the former single
 * host `widgets-i18n.ts` was split into by screen area; `create-widgets-dictionary.ts` composes them
 * (entries and their why-comments are unchanged, just regrouped).
 */
export const WIDGETS_HOOKS_I18N: Record<string, Record<string, string>> = {
  es: {
    // Hook-level notice/error strings (use-widget-instance-editor.hooks.ts,
    // use-widget-region-editor.hooks.ts, use-widgets-library.hooks.ts,
    // use-widget-regions.hooks.ts) — these never got translated during the JSX-only pass since
    // they live in `.hooks.ts` files.
    "failed to load widget": "no se pudo cargar el widget",
    "save failed": "no se pudo guardar",
    "This widget changed since you loaded it, refresh and try again.":
      "Este widget cambió desde que lo cargaste; actualiza e inténtalo de nuevo.",
    "This region changed since you loaded it, refresh and try again.":
      "Esta región cambió desde que la cargaste; actualiza e inténtalo de nuevo.",
    "failed to load region": "no se pudo cargar la región",
    "failed to load widgets": "no se pudieron cargar los widgets",
    "delete failed": "no se pudo eliminar",
    "This item changed since you loaded it. Reload and try again.": "Este elemento cambió desde que lo cargaste. Actualiza e inténtalo de nuevo.",
    "failed to load regions": "no se pudieron cargar las regiones",
    "bind failed": "no se pudo vincular",
  },
  id: {
    "failed to load widget": "gagal memuat widget",
    "save failed": "gagal menyimpan",
    "This widget changed since you loaded it, refresh and try again.":
      "Widget ini berubah sejak Anda memuatnya; segarkan dan coba lagi.",
    "This region changed since you loaded it, refresh and try again.":
      "Wilayah ini berubah sejak Anda memuatnya; segarkan dan coba lagi.",
    "failed to load region": "gagal memuat wilayah",
    "failed to load widgets": "gagal memuat widget",
    "delete failed": "gagal menghapus",
    "This item changed since you loaded it. Reload and try again.": "Item ini berubah sejak Anda memuatnya. Segarkan dan coba lagi.",
    "failed to load regions": "gagal memuat wilayah",
    "bind failed": "gagal mengikat",
  },
  de: {
    "failed to load widget": "Widget konnte nicht geladen werden",
    "save failed": "Speichern fehlgeschlagen",
    "This widget changed since you loaded it, refresh and try again.":
      "Dieses Widget hat sich seit dem Laden geändert. Aktualisieren Sie die Seite und versuchen Sie es erneut.",
    "This region changed since you loaded it, refresh and try again.":
      "Dieser Bereich hat sich seit dem Laden geändert. Aktualisieren Sie die Seite und versuchen Sie es erneut.",
    "failed to load region": "Bereich konnte nicht geladen werden",
    "failed to load widgets": "Widgets konnten nicht geladen werden",
    "delete failed": "Löschen fehlgeschlagen",
    "This item changed since you loaded it. Reload and try again.": "Dieses Element hat sich seit dem Laden geändert. Aktualisieren Sie die Seite und versuchen Sie es erneut.",
    "failed to load regions": "Bereiche konnten nicht geladen werden",
    "bind failed": "Binden fehlgeschlagen",
  },
  "zh-CN": {
    "failed to load widget": "小组件加载失败",
    "save failed": "保存失败",
    "This widget changed since you loaded it, refresh and try again.": "此小组件自加载后已更改,请刷新后重试。",
    "This region changed since you loaded it, refresh and try again.": "此区域自加载后已更改,请刷新后重试。",
    "failed to load region": "区域加载失败",
    "failed to load widgets": "小组件加载失败",
    "delete failed": "删除失败",
    "This item changed since you loaded it. Reload and try again.": "此项目自加载后已更改,请刷新后重试。",
    "failed to load regions": "区域加载失败",
    "bind failed": "绑定失败",
  },
  "zh-TW": {
    "failed to load widget": "小工具載入失敗",
    "save failed": "儲存失敗",
    "This widget changed since you loaded it, refresh and try again.": "此小工具自載入後已變更,請重新整理後再試一次。",
    "This region changed since you loaded it, refresh and try again.": "此區域自載入後已變更,請重新整理後再試一次。",
    "failed to load region": "區域載入失敗",
    "failed to load widgets": "小工具載入失敗",
    "delete failed": "刪除失敗",
    "This item changed since you loaded it. Reload and try again.": "此項目自載入後已變更,請重新整理後再試一次。",
    "failed to load regions": "區域載入失敗",
    "bind failed": "繫結失敗",
  },
  "pt-BR": {
    "failed to load widget": "falha ao carregar o widget",
    "save failed": "falha ao salvar",
    "This widget changed since you loaded it, refresh and try again.":
      "Este widget mudou desde que você o carregou; atualize e tente novamente.",
    "This region changed since you loaded it, refresh and try again.":
      "Esta região mudou desde que você a carregou; atualize e tente novamente.",
    "failed to load region": "falha ao carregar a região",
    "failed to load widgets": "falha ao carregar os widgets",
    "delete failed": "falha ao excluir",
    "This item changed since you loaded it. Reload and try again.": "Este item mudou desde que você o carregou. Atualize e tente novamente.",
    "failed to load regions": "falha ao carregar as regiões",
    "bind failed": "falha ao vincular",
  },
  ru: {
    "failed to load widget": "не удалось загрузить виджет",
    "save failed": "не удалось сохранить",
    "This widget changed since you loaded it, refresh and try again.":
      "Этот виджет был изменён после загрузки; обновите страницу и попробуйте снова.",
    "This region changed since you loaded it, refresh and try again.":
      "Эта область была изменена после загрузки; обновите страницу и попробуйте снова.",
    "failed to load region": "не удалось загрузить область",
    "failed to load widgets": "не удалось загрузить виджеты",
    "delete failed": "не удалось удалить",
    "This item changed since you loaded it. Reload and try again.": "Этот элемент был изменён после загрузки. Обновите страницу и попробуйте снова.",
    "failed to load regions": "не удалось загрузить области",
    "bind failed": "не удалось привязать",
  },
  fa: {
    "failed to load widget": "بارگذاری ابزارک ناموفق بود",
    "save failed": "ذخیره ناموفق بود",
    "This widget changed since you loaded it, refresh and try again.":
      "این ابزارک از زمان بارگذاری تغییر کرده است؛ صفحه را تازه‌سازی کرده و دوباره امتحان کنید.",
    "This region changed since you loaded it, refresh and try again.":
      "این ناحیه از زمان بارگذاری تغییر کرده است؛ صفحه را تازه‌سازی کرده و دوباره امتحان کنید.",
    "failed to load region": "بارگذاری ناحیه ناموفق بود",
    "failed to load widgets": "بارگذاری ابزارک‌ها ناموفق بود",
    "delete failed": "حذف ناموفق بود",
    "This item changed since you loaded it. Reload and try again.": "این مورد از زمان بارگذاری تغییر کرده است. صفحه را تازه‌سازی کرده و دوباره امتحان کنید.",
    "failed to load regions": "بارگذاری نواحی ناموفق بود",
    "bind failed": "اتصال ناموفق بود",
  },
  ar: {
    "failed to load widget": "تعذّر تحميل الودجة",
    "save failed": "تعذّر الحفظ",
    "This widget changed since you loaded it, refresh and try again.":
      "تغيّرت هذه الودجة منذ تحميلها؛ يُرجى التحديث والمحاولة مرة أخرى.",
    "This region changed since you loaded it, refresh and try again.":
      "تغيّرت هذه المنطقة منذ تحميلها؛ يُرجى التحديث والمحاولة مرة أخرى.",
    "failed to load region": "تعذّر تحميل المنطقة",
    "failed to load widgets": "تعذّر تحميل الودجات",
    "delete failed": "تعذّر الحذف",
    "This item changed since you loaded it. Reload and try again.": "تغيّر هذا العنصر منذ تحميله. يُرجى التحديث والمحاولة مرة أخرى.",
    "failed to load regions": "تعذّر تحميل المناطق",
    "bind failed": "تعذّر الربط",
  },
  ja: {
    "failed to load widget": "ウィジェットの読み込みに失敗しました",
    "save failed": "保存に失敗しました",
    "This widget changed since you loaded it, refresh and try again.":
      "このウィジェットは読み込み後に変更されています。更新してもう一度お試しください。",
    "This region changed since you loaded it, refresh and try again.":
      "この領域は読み込み後に変更されています。更新してもう一度お試しください。",
    "failed to load region": "領域の読み込みに失敗しました",
    "failed to load widgets": "ウィジェットの読み込みに失敗しました",
    "delete failed": "削除に失敗しました",
    "This item changed since you loaded it. Reload and try again.": "この項目は読み込み後に変更されています。更新してもう一度お試しください。",
    "failed to load regions": "領域の読み込みに失敗しました",
    "bind failed": "バインドに失敗しました",
  },
  ko: {
    "failed to load widget": "위젯을 불러오지 못했습니다",
    "save failed": "저장하지 못했습니다",
    "This widget changed since you loaded it, refresh and try again.":
      "이 위젯은 불러온 이후 변경되었습니다. 새로고침 후 다시 시도하세요.",
    "This region changed since you loaded it, refresh and try again.":
      "이 영역은 불러온 이후 변경되었습니다. 새로고침 후 다시 시도하세요.",
    "failed to load region": "영역을 불러오지 못했습니다",
    "failed to load widgets": "위젯을 불러오지 못했습니다",
    "delete failed": "삭제하지 못했습니다",
    "This item changed since you loaded it. Reload and try again.": "이 항목은 불러온 이후 변경되었습니다. 새로고침 후 다시 시도하세요.",
    "failed to load regions": "영역을 불러오지 못했습니다",
    "bind failed": "바인딩하지 못했습니다",
  },
  pl: {
    "failed to load widget": "nie udało się wczytać widżetu",
    "save failed": "zapis nie powiódł się",
    "This widget changed since you loaded it, refresh and try again.":
      "Ten widżet zmienił się od czasu wczytania; odśwież i spróbuj ponownie.",
    "This region changed since you loaded it, refresh and try again.":
      "Ten region zmienił się od czasu wczytania; odśwież i spróbuj ponownie.",
    "failed to load region": "nie udało się wczytać regionu",
    "failed to load widgets": "nie udało się wczytać widżetów",
    "delete failed": "usuwanie nie powiodło się",
    "This item changed since you loaded it. Reload and try again.": "Ten element zmienił się od czasu wczytania. Odśwież i spróbuj ponownie.",
    "failed to load regions": "nie udało się wczytać regionów",
    "bind failed": "powiązanie nie powiodło się",
  },
  hu: {
    "failed to load widget": "a modul betöltése sikertelen",
    "save failed": "a mentés sikertelen",
    "This widget changed since you loaded it, refresh and try again.":
      "Ez a modul megváltozott a betöltés óta; frissítsen, és próbálja újra.",
    "This region changed since you loaded it, refresh and try again.":
      "Ez a terület megváltozott a betöltés óta; frissítsen, és próbálja újra.",
    "failed to load region": "a terület betöltése sikertelen",
    "failed to load widgets": "a modulok betöltése sikertelen",
    "delete failed": "a törlés sikertelen",
    "This item changed since you loaded it. Reload and try again.": "Ez az elem megváltozott a betöltés óta. Frissítsen, és próbálja újra.",
    "failed to load regions": "a területek betöltése sikertelen",
    "bind failed": "a hozzákötés sikertelen",
  },
  fr: {
    "failed to load widget": "échec du chargement du widget",
    "save failed": "échec de l'enregistrement",
    "This widget changed since you loaded it, refresh and try again.":
      "Ce widget a changé depuis son chargement ; actualisez et réessayez.",
    "This region changed since you loaded it, refresh and try again.":
      "Cette région a changé depuis son chargement ; actualisez et réessayez.",
    "failed to load region": "échec du chargement de la région",
    "failed to load widgets": "échec du chargement des widgets",
    "delete failed": "échec de la suppression",
    "This item changed since you loaded it. Reload and try again.": "Cet élément a changé depuis son chargement. Actualisez et réessayez.",
    "failed to load regions": "échec du chargement des régions",
    "bind failed": "échec de la liaison",
  },
  uk: {
    "failed to load widget": "не вдалося завантажити віджет",
    "save failed": "не вдалося зберегти",
    "This widget changed since you loaded it, refresh and try again.":
      "Цей віджет змінився після завантаження; оновіть сторінку та спробуйте ще раз.",
    "This region changed since you loaded it, refresh and try again.":
      "Ця область змінилася після завантаження; оновіть сторінку та спробуйте ще раз.",
    "failed to load region": "не вдалося завантажити область",
    "failed to load widgets": "не вдалося завантажити віджети",
    "delete failed": "не вдалося видалити",
    "This item changed since you loaded it. Reload and try again.": "Цей елемент змінився після завантаження. Оновіть сторінку та спробуйте ще раз.",
    "failed to load regions": "не вдалося завантажити області",
    "bind failed": "не вдалося прив'язати",
  },
  tr: {
    "failed to load widget": "widget yüklenemedi",
    "save failed": "kaydetme başarısız oldu",
    "This widget changed since you loaded it, refresh and try again.":
      "Bu widget yüklendiğinden beri değişti; yenileyip tekrar deneyin.",
    "This region changed since you loaded it, refresh and try again.":
      "Bu bölge yüklendiğinden beri değişti; yenileyip tekrar deneyin.",
    "failed to load region": "bölge yüklenemedi",
    "failed to load widgets": "widget'lar yüklenemedi",
    "delete failed": "silme başarısız oldu",
    "This item changed since you loaded it. Reload and try again.": "Bu öğe yüklendiğinden beri değişti. Yenileyip tekrar deneyin.",
    "failed to load regions": "bölgeler yüklenemedi",
    "bind failed": "bağlama başarısız oldu",
  },
  th: {
    "failed to load widget": "โหลดวิดเจ็ตไม่สำเร็จ",
    "save failed": "บันทึกไม่สำเร็จ",
    "This widget changed since you loaded it, refresh and try again.":
      "วิดเจ็ตนี้มีการเปลี่ยนแปลงหลังจากที่คุณโหลดไว้ โปรดรีเฟรชแล้วลองอีกครั้ง",
    "This region changed since you loaded it, refresh and try again.":
      "พื้นที่นี้มีการเปลี่ยนแปลงหลังจากที่คุณโหลดไว้ โปรดรีเฟรชแล้วลองอีกครั้ง",
    "failed to load region": "โหลดพื้นที่ไม่สำเร็จ",
    "failed to load widgets": "โหลดวิดเจ็ตไม่สำเร็จ",
    "delete failed": "ลบไม่สำเร็จ",
    "This item changed since you loaded it. Reload and try again.": "รายการนี้มีการเปลี่ยนแปลงหลังจากที่คุณโหลดไว้ โปรดโหลดใหม่แล้วลองอีกครั้ง",
    "failed to load regions": "โหลดพื้นที่ไม่สำเร็จ",
    "bind failed": "เชื่อมโยงไม่สำเร็จ",
  },
  it: {
    "failed to load widget": "impossibile caricare il widget",
    "save failed": "salvataggio non riuscito",
    "This widget changed since you loaded it, refresh and try again.":
      "Questo widget è cambiato da quando lo hai caricato; aggiorna e riprova.",
    "This region changed since you loaded it, refresh and try again.":
      "Questa regione è cambiata da quando l'hai caricata; aggiorna e riprova.",
    "failed to load region": "impossibile caricare la regione",
    "failed to load widgets": "impossibile caricare i widget",
    "delete failed": "eliminazione non riuscita",
    "This item changed since you loaded it. Reload and try again.": "Questo elemento è cambiato da quando lo hai caricato. Aggiorna e riprova.",
    "failed to load regions": "impossibile caricare le regioni",
    "bind failed": "collegamento non riuscito",
  },
  hi: {
    "failed to load widget": "विजेट लोड नहीं हो सका",
    "save failed": "सहेजना विफल रहा",
    "This widget changed since you loaded it, refresh and try again.":
      "इस विजेट को लोड करने के बाद इसमें बदलाव हुआ है; रीफ़्रेश करें और फिर से प्रयास करें।",
    "This region changed since you loaded it, refresh and try again.":
      "इस क्षेत्र को लोड करने के बाद इसमें बदलाव हुआ है; रीफ़्रेश करें और फिर से प्रयास करें।",
    "failed to load region": "क्षेत्र लोड नहीं हो सका",
    "failed to load widgets": "विजेट लोड नहीं हो सके",
    "delete failed": "हटाना विफल रहा",
    "This item changed since you loaded it. Reload and try again.": "इस आइटम को लोड करने के बाद इसमें बदलाव हुआ है। रीफ़्रेश करें और फिर से प्रयास करें।",
    "failed to load regions": "क्षेत्र लोड नहीं हो सके",
    "bind failed": "बाइंड विफल रहा",
  },
  ur: {
    "failed to load widget": "ویجٹ لوڈ نہ ہو سکا",
    "save failed": "محفوظ کرنا ناکام رہا",
    "This widget changed since you loaded it, refresh and try again.":
      "یہ ویجٹ لوڈ ہونے کے بعد تبدیل ہو چکا ہے؛ ریفریش کریں اور دوبارہ کوشش کریں۔",
    "This region changed since you loaded it, refresh and try again.":
      "یہ ریجن لوڈ ہونے کے بعد تبدیل ہو چکا ہے؛ ریفریش کریں اور دوبارہ کوشش کریں۔",
    "failed to load region": "ریجن لوڈ نہ ہو سکا",
    "failed to load widgets": "ویجٹس لوڈ نہ ہو سکے",
    "delete failed": "حذف کرنا ناکام رہا",
    "This item changed since you loaded it. Reload and try again.": "یہ آئٹم لوڈ ہونے کے بعد تبدیل ہو چکا ہے۔ ریفریش کریں اور دوبارہ کوشش کریں۔",
    "failed to load regions": "ریجنز لوڈ نہ ہو سکے",
    "bind failed": "باندھنا ناکام رہا",
  },
  bn: {
    "failed to load widget": "উইজেট লোড করা যায়নি",
    "save failed": "সংরক্ষণ ব্যর্থ হয়েছে",
    "This widget changed since you loaded it, refresh and try again.":
      "এই উইজেটটি লোড করার পর পরিবর্তিত হয়েছে; রিফ্রেশ করে আবার চেষ্টা করুন।",
    "This region changed since you loaded it, refresh and try again.":
      "এই রিজিয়নটি লোড করার পর পরিবর্তিত হয়েছে; রিফ্রেশ করে আবার চেষ্টা করুন।",
    "failed to load region": "রিজিয়ন লোড করা যায়নি",
    "failed to load widgets": "উইজেট লোড করা যায়নি",
    "delete failed": "মোছা ব্যর্থ হয়েছে",
    "This item changed since you loaded it. Reload and try again.": "এই আইটেমটি লোড করার পর পরিবর্তিত হয়েছে। রিফ্রেশ করে আবার চেষ্টা করুন।",
    "failed to load regions": "রিজিয়ন লোড করা যায়নি",
    "bind failed": "বাইন্ড ব্যর্থ হয়েছে",
  },
};
