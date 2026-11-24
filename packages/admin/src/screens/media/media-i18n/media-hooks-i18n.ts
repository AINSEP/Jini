/**
 * @file Media library screens dictionary slice — the hook-level notice/error strings of the media hooks, in every locale. One of the slices the former single
 * host `media-i18n.ts` was split into by screen area (K4i); `create-media-dictionary.ts` composes them
 * (entries and their why-comments are unchanged, just regrouped).
 */
export const MEDIA_HOOKS_I18N: Record<string, Record<string, string>> = {
  es: {
    // Hook-level notice/error strings (use-media.hooks.ts, use-edit-media-panel.hooks.ts) — these
    // never got translated during the JSX-only pass since they live in `.hooks.ts` files.
    "failed to load media": "no se pudo cargar el contenido multimedia",
    "upload failed": "no se pudo subir",
    "delete failed": "no se pudo eliminar",
    "failed to save media metadata": "no se pudieron guardar los metadatos multimedia",
  },
  id: {
    "failed to load media": "gagal memuat media",
    "upload failed": "gagal mengunggah",
    "delete failed": "gagal menghapus",
    "failed to save media metadata": "gagal menyimpan metadata media",
  },
  de: {
    "failed to load media": "Medien konnten nicht geladen werden",
    "upload failed": "Hochladen fehlgeschlagen",
    "delete failed": "Löschen fehlgeschlagen",
    "failed to save media metadata": "Medien-Metadaten konnten nicht gespeichert werden",
  },
  "zh-CN": {
    "failed to load media": "媒体加载失败",
    "upload failed": "上传失败",
    "delete failed": "删除失败",
    "failed to save media metadata": "媒体元数据保存失败",
  },
  "zh-TW": {
    "failed to load media": "媒體載入失敗",
    "upload failed": "上傳失敗",
    "delete failed": "刪除失敗",
    "failed to save media metadata": "媒體中繼資料儲存失敗",
  },
  "pt-BR": {
    "failed to load media": "falha ao carregar mídia",
    "upload failed": "falha no envio",
    "delete failed": "falha ao excluir",
    "failed to save media metadata": "falha ao salvar os metadados da mídia",
  },
  ru: {
    "failed to load media": "не удалось загрузить медиафайл",
    "upload failed": "не удалось загрузить",
    "delete failed": "не удалось удалить",
    "failed to save media metadata": "не удалось сохранить метаданные медиафайла",
  },
  fa: {
    "failed to load media": "بارگذاری رسانه ناموفق بود",
    "upload failed": "بارگذاری ناموفق بود",
    "delete failed": "حذف ناموفق بود",
    "failed to save media metadata": "ذخیرهٔ ابرداده رسانه ناموفق بود",
  },
  ar: {
    "failed to load media": "تعذّر تحميل الوسائط",
    "upload failed": "فشل الرفع",
    "delete failed": "فشل الحذف",
    "failed to save media metadata": "تعذّر حفظ البيانات الوصفية للوسائط",
  },
  ja: {
    "failed to load media": "メディアを読み込めませんでした",
    "upload failed": "アップロードに失敗しました",
    "delete failed": "削除に失敗しました",
    "failed to save media metadata": "メディアのメタデータを保存できませんでした",
  },
  ko: {
    "failed to load media": "미디어를 불러오지 못했습니다",
    "upload failed": "업로드에 실패했습니다",
    "delete failed": "삭제에 실패했습니다",
    "failed to save media metadata": "미디어 메타데이터를 저장하지 못했습니다",
  },
  pl: {
    "failed to load media": "nie udało się wczytać multimediów",
    "upload failed": "przesyłanie nie powiodło się",
    "delete failed": "usuwanie nie powiodło się",
    "failed to save media metadata": "nie udało się zapisać metadanych multimediów",
  },
  hu: {
    "failed to load media": "nem sikerült betölteni a médiát",
    "upload failed": "a feltöltés sikertelen",
    "delete failed": "a törlés sikertelen",
    "failed to save media metadata": "nem sikerült elmenteni a média metaadatait",
  },
  fr: {
    "failed to load media": "échec du chargement du média",
    "upload failed": "échec du téléversement",
    "delete failed": "échec de la suppression",
    "failed to save media metadata": "échec de l'enregistrement des métadonnées du média",
  },
  uk: {
    "failed to load media": "не вдалося завантажити медіафайл",
    "upload failed": "не вдалося завантажити",
    "delete failed": "не вдалося видалити",
    "failed to save media metadata": "не вдалося зберегти метадані медіафайлу",
  },
  tr: {
    "failed to load media": "medya yüklenemedi",
    "upload failed": "yükleme başarısız oldu",
    "delete failed": "silme başarısız oldu",
    "failed to save media metadata": "medya meta verileri kaydedilemedi",
  },
  th: {
    "failed to load media": "โหลดสื่อไม่สำเร็จ",
    "upload failed": "อัปโหลดไม่สำเร็จ",
    "delete failed": "ลบไม่สำเร็จ",
    "failed to save media metadata": "บันทึกข้อมูลเมตาของสื่อไม่สำเร็จ",
  },
  it: {
    "failed to load media": "impossibile caricare il contenuto multimediale",
    "upload failed": "caricamento non riuscito",
    "delete failed": "eliminazione non riuscita",
    "failed to save media metadata": "impossibile salvare i metadati del contenuto multimediale",
  },
  hi: {
    "failed to load media": "मीडिया लोड करना विफल रहा",
    "upload failed": "अपलोड विफल रहा",
    "delete failed": "हटाना विफल रहा",
    "failed to save media metadata": "मीडिया मेटाडेटा सहेजना विफल रहा",
  },
  ur: {
    "failed to load media": "میڈیا لوڈ کرنا ناکام ہوا",
    "upload failed": "اپ لوڈ ناکام ہوا",
    "delete failed": "حذف کرنا ناکام ہوا",
    "failed to save media metadata": "میڈیا میٹا ڈیٹا محفوظ کرنا ناکام ہوا",
  },
  bn: {
    "failed to load media": "মিডিয়া লোড করা ব্যর্থ হয়েছে",
    "upload failed": "আপলোড ব্যর্থ হয়েছে",
    "delete failed": "মুছে ফেলা ব্যর্থ হয়েছে",
    "failed to save media metadata": "মিডিয়া মেটাডেটা সংরক্ষণ করা ব্যর্থ হয়েছে",
  },
};
