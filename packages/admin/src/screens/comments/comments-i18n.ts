import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from "@jini-ai/core/text";

/**
 * @file Dictionary for the Comments feature, covering all 18 target locales. Covers `rules.ts`'s
 * moderation-queue row-menu labels (`commentRowMenuItems`: Approve/Spam/Trash/Restore/Purge), the
 * hook-level notice/error strings from `use-comment-queue.hooks.ts` and
 * `use-comment-settings.hooks.ts` (`describeApiError` fallbacks, `setNotice` copy), and
 * `Jini packages/admin/src/comments/react/pages/CommentsPage.tsx`'s own markup (table headers, queue/settings copy, the purge-confirm dialog) — the
 * last of these was the one gap left after the rest of this admin app's JSX-only i18n pass (see
 * `redirects-i18n.tsx`/`integrations-i18n.tsx`/`recovery-i18n.tsx`'s matching notes for that
 * earlier pass), now closed.
 */

const COMMENTS_DICT: Record<string, Record<string, string>> = {
  es: {
    Approve: "Aprobar",
    // Kept as "Spam" in Spanish too, deliberately — the loanword is what Spanish-language
    // moderation UIs use for this exact one-word label (e.g. Gmail's own Spanish interface), not an
    // untranslated leftover.
    Spam: "Spam",
    // "Trash" itself now falls through to the shared `COMMON_I18N` entry (same value as
    // `lib/admin-nav-i18n.ts`'s "Trash" nav entry, `widgets-i18n.ts`'s Trash tab).
    Restore: "Restaurar",
    // Reuses the phrase already established for the same underlying action under a different
    // English source string (`media-i18n.ts`/`widgets-i18n.ts`'s "Delete permanently") rather than
    // inventing a literal "Purgar".
    Purge: "Eliminar permanentemente",

    // Jini packages/admin/src/comments/react/pages/CommentsPage.tsx markup (this pass) — the screen's own JSX was never wired to translation
    // before now; see the file header.
    "Loading…": "Cargando…",
    Author: "Autor",
    Comment: "Comentario",
    Depth: "Profundidad",
    Created: "Creado",
    "Load more": "Cargar más",
    "Loading comments…": "Cargando comentarios…",
    "Loading Comments…": "Cargando comentarios…",
    "No {status} comments.": 'No hay comentarios "{status}".',
    "Permanently delete this comment?": "¿Eliminar permanentemente este comentario?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      '¿Eliminar permanentemente este comentario de "{author}"? Esta acción no se puede deshacer.',
    "Permanently delete": "Eliminar permanentemente",
    'Actions for the comment by "{author}"': 'Acciones para el comentario de "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Modera los comentarios entrantes y configura el comportamiento de comentarios en todo el espacio de trabajo.",
    "You do not have permission to view the moderation queue.":
      "No tienes permiso para ver la cola de moderación.",
    "Loading Comments settings…": "Cargando la configuración de comentarios…",
    "Comments enabled": "Comentarios habilitados",
    "Require moderation (new comments start pending)":
      "Requerir moderación (los comentarios nuevos comienzan como pendientes)",
    "Max thread depth": "Profundidad máxima del hilo",
    "Close submissions after (days, blank = never)": "Cerrar los envíos después de (días, en blanco = nunca)",
    "Spam auto-reject score (0–1)": "Puntuación de rechazo automático de spam (0–1)",
    "Max submissions per IP per hour": "Máximo de envíos por IP por hora",
    "Save settings": "Guardar configuración",

    // use-comment-queue.hooks.ts / use-comment-settings.hooks.ts (hook-level notice/error strings)
    "failed to load the moderation queue": "no se pudo cargar la cola de moderación",
    "Failed to purge comment.": "No se pudo purgar el comentario.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Este comentario cambió desde que lo cargaste (versión actual {currentVersion}); actualiza e inténtalo de nuevo.",
    "This comment changed since you loaded it — refresh and try again.": "Este comentario cambió desde que lo cargaste; actualiza e inténtalo de nuevo.",
    "Failed to update comment.": "No se pudo actualizar el comentario.",
    "Spam auto-reject score must be between 0 and 1.": "La puntuación de rechazo automático de spam debe estar entre 0 y 1.",
    "failed to load Comments settings": "no se pudo cargar la configuración de comentarios",
    "failed to save Comments settings": "no se pudo guardar la configuración de comentarios",
  },
  id: {
    Approve: "Setujui",
    Spam: "Spam",
    Restore: "Pulihkan",
    Purge: "Hapus permanen",

    "Loading…": "Memuat…",
    Author: "Penulis",
    Comment: "Komentar",
    Depth: "Kedalaman",
    Created: "Dibuat",
    "Load more": "Muat lagi",
    "Loading comments…": "Memuat komentar…",
    "Loading Comments…": "Memuat komentar…",
    "No {status} comments.": 'Tidak ada komentar "{status}".',
    "Permanently delete this comment?": "Hapus komentar ini secara permanen?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'Hapus komentar dari "{author}" secara permanen? Tindakan ini tidak dapat dibatalkan.',
    "Permanently delete": "Hapus permanen",
    'Actions for the comment by "{author}"': 'Tindakan untuk komentar dari "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Moderasi komentar masuk dan konfigurasikan perilaku komentar di seluruh ruang kerja.",
    "You do not have permission to view the moderation queue.":
      "Anda tidak memiliki izin untuk melihat antrean moderasi.",
    "Loading Comments settings…": "Memuat pengaturan Komentar…",
    "Comments enabled": "Komentar diaktifkan",
    "Require moderation (new comments start pending)":
      "Wajibkan moderasi (komentar baru dimulai sebagai tertunda)",
    "Max thread depth": "Kedalaman maksimum utas",
    "Close submissions after (days, blank = never)": "Tutup pengiriman setelah (hari, kosongkan = tidak pernah)",
    "Spam auto-reject score (0–1)": "Skor penolakan otomatis spam (0–1)",
    "Max submissions per IP per hour": "Maksimum pengiriman per IP per jam",
    "Save settings": "Simpan pengaturan",

    "failed to load the moderation queue": "gagal memuat antrean moderasi",
    "Failed to purge comment.": "Gagal menghapus komentar secara permanen.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Komentar ini berubah sejak Anda memuatnya (versi saat ini {currentVersion}); segarkan lalu coba lagi.",
    "This comment changed since you loaded it — refresh and try again.": "Komentar ini berubah sejak Anda memuatnya; segarkan lalu coba lagi.",
    "Failed to update comment.": "Gagal memperbarui komentar.",
    "Spam auto-reject score must be between 0 and 1.": "Skor penolakan otomatis spam harus antara 0 dan 1.",
    "failed to load Comments settings": "gagal memuat pengaturan Komentar",
    "failed to save Comments settings": "gagal menyimpan pengaturan Komentar",
  },
  de: {
    Approve: "Genehmigen",
    Spam: "Spam",
    Restore: "Wiederherstellen",
    Purge: "Endgültig löschen",

    "Loading…": "Wird geladen…",
    Author: "Autor",
    Comment: "Kommentar",
    Depth: "Tiefe",
    Created: "Erstellt",
    "Load more": "Mehr laden",
    "Loading comments…": "Kommentare werden geladen…",
    "Loading Comments…": "Kommentare werden geladen…",
    "No {status} comments.": "Keine Kommentare mit Status „{status}“.",
    "Permanently delete this comment?": "Diesen Kommentar endgültig löschen?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      "Kommentar von „{author}“ endgültig löschen? Dies kann nicht rückgängig gemacht werden.",
    "Permanently delete": "Endgültig löschen",
    'Actions for the comment by "{author}"': "Aktionen für Kommentar von „{author}“",
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Eingehende Kommentare moderieren und das arbeitsbereichsweite Kommentarverhalten konfigurieren.",
    "You do not have permission to view the moderation queue.":
      "Sie haben keine Berechtigung, die Moderationswarteschlange anzuzeigen.",
    "Loading Comments settings…": "Kommentareinstellungen werden geladen…",
    "Comments enabled": "Kommentare aktiviert",
    "Require moderation (new comments start pending)":
      "Moderation erforderlich (neue Kommentare starten als ausstehend)",
    "Max thread depth": "Maximale Thread-Tiefe",
    "Close submissions after (days, blank = never)": "Einsendungen schließen nach (Tage, leer = nie)",
    "Spam auto-reject score (0–1)": "Spam-Auto-Ablehnungswert (0–1)",
    "Max submissions per IP per hour": "Maximale Einsendungen pro IP und Stunde",
    "Save settings": "Einstellungen speichern",

    "failed to load the moderation queue": "Moderationswarteschlange konnte nicht geladen werden",
    "Failed to purge comment.": "Kommentar konnte nicht endgültig gelöscht werden.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Dieser Kommentar wurde seit dem Laden geändert (aktuelle Version {currentVersion}) – bitte aktualisieren und erneut versuchen.",
    "This comment changed since you loaded it — refresh and try again.": "Dieser Kommentar wurde seit dem Laden geändert – bitte aktualisieren und erneut versuchen.",
    "Failed to update comment.": "Kommentar konnte nicht aktualisiert werden.",
    "Spam auto-reject score must be between 0 and 1.": "Der automatische Spam-Ablehnungswert muss zwischen 0 und 1 liegen.",
    "failed to load Comments settings": "Kommentareinstellungen konnten nicht geladen werden",
    "failed to save Comments settings": "Kommentareinstellungen konnten nicht gespeichert werden",
  },
  "zh-CN": {
    Approve: "批准",
    // Native term, not the "Spam" loanword — WordPress and most mainland Chinese moderation UIs
    // render this as 垃圾评论 ("junk comment"), not the bare English word.
    Spam: "垃圾评论",
    Restore: "恢复",
    Purge: "永久删除",

    "Loading…": "加载中…",
    Author: "作者",
    Comment: "评论",
    Depth: "深度",
    Created: "创建时间",
    "Load more": "加载更多",
    "Loading comments…": "正在加载评论…",
    "Loading Comments…": "正在加载评论…",
    "No {status} comments.": "没有“{status}”评论。",
    "Permanently delete this comment?": "永久删除此评论？",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      "永久删除来自“{author}”的评论？此操作无法撤销。",
    "Permanently delete": "永久删除",
    'Actions for the comment by "{author}"': "来自“{author}”的评论操作",
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "审核新提交的评论，并配置整个工作区的评论行为。",
    "You do not have permission to view the moderation queue.": "您没有权限查看审核队列。",
    "Loading Comments settings…": "正在加载评论设置…",
    "Comments enabled": "启用评论",
    "Require moderation (new comments start pending)": "需要审核（新评论默认状态为待审核）",
    "Max thread depth": "最大楼层深度",
    "Close submissions after (days, blank = never)": "提交截止时间（天数，留空表示永不截止）",
    "Spam auto-reject score (0–1)": "垃圾评论自动拒绝分数（0–1）",
    "Max submissions per IP per hour": "每个 IP 每小时最大提交数",
    "Save settings": "保存设置",

    "failed to load the moderation queue": "无法加载审核队列",
    "Failed to purge comment.": "无法永久删除评论。",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "此评论在您加载后已更改（当前版本 {currentVersion}），请刷新后重试。",
    "This comment changed since you loaded it — refresh and try again.": "此评论在您加载后已更改，请刷新后重试。",
    "Failed to update comment.": "无法更新评论。",
    "Spam auto-reject score must be between 0 and 1.": "垃圾评论自动拒绝分数必须介于 0 和 1 之间。",
    "failed to load Comments settings": "无法加载评论设置",
    "failed to save Comments settings": "无法保存评论设置",
  },
  "zh-TW": {
    Approve: "核准",
    // Same reasoning as zh-CN — Taiwan's own moderation-UI convention is 垃圾留言, not "Spam".
    Spam: "垃圾留言",
    Restore: "還原",
    Purge: "永久刪除",

    "Loading…": "載入中…",
    Author: "作者",
    Comment: "留言",
    Depth: "深度",
    Created: "建立時間",
    "Load more": "載入更多",
    "Loading comments…": "正在載入留言…",
    "Loading Comments…": "正在載入留言…",
    "No {status} comments.": "沒有「{status}」留言。",
    "Permanently delete this comment?": "永久刪除此留言？",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      "永久刪除來自「{author}」的留言？此操作無法復原。",
    "Permanently delete": "永久刪除",
    'Actions for the comment by "{author}"': "來自「{author}」的留言操作",
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "審核新提交的留言，並設定整個工作區的留言行為。",
    "You do not have permission to view the moderation queue.": "您沒有權限檢視審核佇列。",
    "Loading Comments settings…": "正在載入留言設定…",
    "Comments enabled": "啟用留言",
    "Require moderation (new comments start pending)": "需要審核（新留言預設為待審核狀態）",
    "Max thread depth": "最大討論串深度",
    "Close submissions after (days, blank = never)": "提交截止時間（天數，留空表示永不截止）",
    "Spam auto-reject score (0–1)": "垃圾留言自動拒絕分數（0–1）",
    "Max submissions per IP per hour": "每個 IP 每小時最大提交數",
    "Save settings": "儲存設定",

    "failed to load the moderation queue": "無法載入審核佇列",
    "Failed to purge comment.": "無法永久刪除留言。",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "此留言在您載入後已變更（目前版本 {currentVersion}），請重新整理後再試一次。",
    "This comment changed since you loaded it — refresh and try again.": "此留言在您載入後已變更，請重新整理後再試一次。",
    "Failed to update comment.": "無法更新留言。",
    "Spam auto-reject score must be between 0 and 1.": "垃圾留言自動拒絕分數必須介於 0 和 1 之間。",
    "failed to load Comments settings": "無法載入留言設定",
    "failed to save Comments settings": "無法儲存留言設定",
  },
  "pt-BR": {
    Approve: "Aprovar",
    Spam: "Spam",
    Restore: "Restaurar",
    Purge: "Excluir permanentemente",

    "Loading…": "Carregando…",
    Author: "Autor",
    Comment: "Comentário",
    Depth: "Profundidade",
    Created: "Criado",
    "Load more": "Carregar mais",
    "Loading comments…": "Carregando comentários…",
    "Loading Comments…": "Carregando comentários…",
    "No {status} comments.": 'Nenhum comentário "{status}".',
    "Permanently delete this comment?": "Excluir permanentemente este comentário?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'Excluir permanentemente este comentário de "{author}"? Esta ação não pode ser desfeita.',
    "Permanently delete": "Excluir permanentemente",
    'Actions for the comment by "{author}"': 'Ações para o comentário de "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Modere os comentários recebidos e configure o comportamento dos comentários em todo o espaço de trabalho.",
    "You do not have permission to view the moderation queue.":
      "Você não tem permissão para ver a fila de moderação.",
    "Loading Comments settings…": "Carregando as configurações de Comentários…",
    "Comments enabled": "Comentários ativados",
    "Require moderation (new comments start pending)":
      "Exigir moderação (novos comentários começam como pendentes)",
    "Max thread depth": "Profundidade máxima da conversa",
    "Close submissions after (days, blank = never)": "Encerrar envios após (dias, em branco = nunca)",
    "Spam auto-reject score (0–1)": "Pontuação de rejeição automática de spam (0–1)",
    "Max submissions per IP per hour": "Máximo de envios por IP por hora",
    "Save settings": "Salvar configurações",

    "failed to load the moderation queue": "falha ao carregar a fila de moderação",
    "Failed to purge comment.": "Falha ao excluir permanentemente o comentário.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Este comentário mudou desde que você o carregou (versão atual {currentVersion}); atualize e tente novamente.",
    "This comment changed since you loaded it — refresh and try again.": "Este comentário mudou desde que você o carregou; atualize e tente novamente.",
    "Failed to update comment.": "Falha ao atualizar o comentário.",
    "Spam auto-reject score must be between 0 and 1.": "A pontuação de rejeição automática de spam deve estar entre 0 e 1.",
    "failed to load Comments settings": "falha ao carregar as configurações de Comentários",
    "failed to save Comments settings": "falha ao salvar as configurações de Comentários",
  },
  ru: {
    Approve: "Одобрить",
    // Transliterated into Cyrillic ("Спам") rather than left in Latin script — that is how Russian
    // moderation UIs (Gmail included) render this word; the bare Latin "Spam" would read as a typo.
    Spam: "Спам",
    Restore: "Восстановить",
    Purge: "Удалить навсегда",

    "Loading…": "Загрузка…",
    Author: "Автор",
    Comment: "Комментарий",
    Depth: "Глубина",
    Created: "Создано",
    "Load more": "Загрузить ещё",
    "Loading comments…": "Загрузка комментариев…",
    "Loading Comments…": "Загрузка комментариев…",
    "No {status} comments.": 'Нет комментариев со статусом "{status}".',
    "Permanently delete this comment?": "Удалить этот комментарий навсегда?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'Удалить навсегда комментарий от "{author}"? Это действие невозможно отменить.',
    "Permanently delete": "Удалить навсегда",
    'Actions for the comment by "{author}"': 'Действия для комментария от "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Модерируйте входящие комментарии и настраивайте поведение комментариев для всего рабочего пространства.",
    "You do not have permission to view the moderation queue.":
      "У вас нет прав для просмотра очереди модерации.",
    "Loading Comments settings…": "Загрузка настроек комментариев…",
    "Comments enabled": "Комментарии включены",
    "Require moderation (new comments start pending)":
      "Требовать модерацию (новые комментарии начинаются со статуса «на рассмотрении»)",
    "Max thread depth": "Максимальная глубина треда",
    "Close submissions after (days, blank = never)": "Закрывать приём после (дней, пусто = никогда)",
    "Spam auto-reject score (0–1)": "Порог автоотклонения спама (0–1)",
    "Max submissions per IP per hour": "Максимум отправок с одного IP в час",
    "Save settings": "Сохранить настройки",

    "failed to load the moderation queue": "не удалось загрузить очередь модерации",
    "Failed to purge comment.": "Не удалось удалить комментарий навсегда.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Этот комментарий изменился после загрузки (текущая версия {currentVersion}); обновите страницу и повторите попытку.",
    "This comment changed since you loaded it — refresh and try again.": "Этот комментарий изменился после загрузки; обновите страницу и повторите попытку.",
    "Failed to update comment.": "Не удалось обновить комментарий.",
    "Spam auto-reject score must be between 0 and 1.": "Оценка автоотклонения спама должна быть от 0 до 1.",
    "failed to load Comments settings": "не удалось загрузить настройки комментариев",
    "failed to save Comments settings": "не удалось сохранить настройки комментариев",
  },
  fa: {
    Approve: "تأیید",
    // Native term — Persian moderation UIs (Gmail Persian included) use هرزنامه, not a transliterated
    // loanword.
    Spam: "هرزنامه",
    Restore: "بازیابی",
    Purge: "حذف دائمی",

    "Loading…": "در حال بارگذاری…",
    Author: "نویسنده",
    Comment: "نظر",
    Depth: "عمق",
    Created: "ایجاد شده",
    "Load more": "بارگذاری بیشتر",
    "Loading comments…": "در حال بارگذاری نظرات…",
    "Loading Comments…": "در حال بارگذاری نظرات…",
    "No {status} comments.": 'نظری با وضعیت "{status}" وجود ندارد.',
    "Permanently delete this comment?": "این نظر برای همیشه حذف شود؟",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'نظر "{author}" برای همیشه حذف شود؟ این کار قابل بازگشت نیست.',
    "Permanently delete": "حذف دائمی",
    'Actions for the comment by "{author}"': 'عملیات برای نظر "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "نظرات دریافتی را مدیریت کنید و رفتار نظرات را برای کل فضای کاری پیکربندی کنید.",
    "You do not have permission to view the moderation queue.": "شما مجوز مشاهده صف نظارت را ندارید.",
    "Loading Comments settings…": "در حال بارگذاری تنظیمات نظرات…",
    "Comments enabled": "نظرات فعال است",
    "Require moderation (new comments start pending)":
      "نیاز به نظارت (نظرات جدید با وضعیت در انتظار شروع می‌شوند)",
    "Max thread depth": "حداکثر عمق موضوع",
    "Close submissions after (days, blank = never)": "بستن ارسال‌ها پس از (روز، خالی = هرگز)",
    "Spam auto-reject score (0–1)": "امتیاز رد خودکار هرزنامه (0–1)",
    "Max submissions per IP per hour": "حداکثر ارسال به ازای هر IP در ساعت",
    "Save settings": "ذخیره تنظیمات",

    "failed to load the moderation queue": "بارگذاری صف نظارت ناموفق بود",
    "Failed to purge comment.": "حذف دائمی نظر ناموفق بود.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "این نظر از زمان بارگیری تغییر کرده است (نسخهٔ فعلی {currentVersion})؛ تازه‌سازی کنید و دوباره تلاش کنید.",
    "This comment changed since you loaded it — refresh and try again.": "این نظر از زمان بارگیری تغییر کرده است؛ تازه‌سازی کنید و دوباره تلاش کنید.",
    "Failed to update comment.": "به‌روزرسانی نظر ناموفق بود.",
    "Spam auto-reject score must be between 0 and 1.": "امتیاز رد خودکار هرزنامه باید بین ۰ و ۱ باشد.",
    "failed to load Comments settings": "بارگذاری تنظیمات نظرات ناموفق بود",
    "failed to save Comments settings": "ذخیره تنظیمات نظرات ناموفق بود",
  },
  ar: {
    Approve: "موافقة",
    // Short native adjective rather than the multi-word "بريد إلكتروني مزعج" — reads naturally as a
    // one-word row-menu label alongside Approve/Trash/Restore/Purge.
    Spam: "مزعج",
    Restore: "استعادة",
    Purge: "حذف نهائي",

    "Loading…": "جارٍ التحميل…",
    Author: "الكاتب",
    Comment: "التعليق",
    Depth: "العمق",
    Created: "تاريخ الإنشاء",
    "Load more": "تحميل المزيد",
    "Loading comments…": "جارٍ تحميل التعليقات…",
    "Loading Comments…": "جارٍ تحميل التعليقات…",
    "No {status} comments.": 'لا توجد تعليقات بحالة "{status}".',
    "Permanently delete this comment?": "هل تريد حذف هذا التعليق نهائيًا؟",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'هل تريد حذف هذا التعليق من "{author}" نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.',
    "Permanently delete": "حذف نهائي",
    'Actions for the comment by "{author}"': 'إجراءات للتعليق من "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "راجع التعليقات الواردة واضبط سلوك التعليقات على مستوى مساحة العمل بأكملها.",
    "You do not have permission to view the moderation queue.":
      "ليس لديك إذن لعرض قائمة انتظار المراجعة.",
    "Loading Comments settings…": "جارٍ تحميل إعدادات التعليقات…",
    "Comments enabled": "التعليقات مفعّلة",
    "Require moderation (new comments start pending)":
      "طلب المراجعة (تبدأ التعليقات الجديدة بحالة قيد الانتظار)",
    "Max thread depth": "أقصى عمق للمناقشة",
    "Close submissions after (days, blank = never)": "إغلاق الإرسال بعد (أيام، فارغ = أبدًا)",
    "Spam auto-reject score (0–1)": "درجة الرفض التلقائي للتعليقات المزعجة (0–1)",
    "Max submissions per IP per hour": "الحد الأقصى للإرسال لكل عنوان IP في الساعة",
    "Save settings": "حفظ الإعدادات",

    "failed to load the moderation queue": "تعذّر تحميل قائمة انتظار المراجعة",
    "Failed to purge comment.": "تعذّر حذف التعليق نهائيًا.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "تغيّر هذا التعليق منذ تحميله (الإصدار الحالي {currentVersion})؛ حدّث الصفحة وحاول مرة أخرى.",
    "This comment changed since you loaded it — refresh and try again.": "تغيّر هذا التعليق منذ تحميله؛ حدّث الصفحة وحاول مرة أخرى.",
    "Failed to update comment.": "تعذّر تحديث التعليق.",
    "Spam auto-reject score must be between 0 and 1.": "يجب أن تكون درجة الرفض التلقائي للرسائل المزعجة بين 0 و1.",
    "failed to load Comments settings": "تعذّر تحميل إعدادات التعليقات",
    "failed to save Comments settings": "تعذّر حفظ إعدادات التعليقات",
  },
  ja: {
    Approve: "承認",
    // "迷惑コメント" (nuisance comment) — the term Japanese CMSes use for comment-spam specifically,
    // distinct from 迷惑メール (email spam).
    Spam: "迷惑コメント",
    Restore: "復元",
    Purge: "完全に削除",

    "Loading…": "読み込み中…",
    Author: "投稿者",
    Comment: "コメント",
    Depth: "深さ",
    Created: "作成日時",
    "Load more": "さらに読み込む",
    "Loading comments…": "コメントを読み込み中…",
    "Loading Comments…": "コメントを読み込み中…",
    "No {status} comments.": "「{status}」のコメントはありません。",
    "Permanently delete this comment?": "このコメントを完全に削除しますか？",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      "「{author}」によるこのコメントを完全に削除しますか？この操作は取り消せません。",
    "Permanently delete": "完全に削除",
    'Actions for the comment by "{author}"': "「{author}」によるコメントの操作",
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "受信したコメントをモデレートし、ワークスペース全体のコメント動作を設定します。",
    "You do not have permission to view the moderation queue.":
      "モデレーションキューを表示する権限がありません。",
    "Loading Comments settings…": "コメント設定を読み込み中…",
    "Comments enabled": "コメントを有効にする",
    "Require moderation (new comments start pending)":
      "モデレーションを必須にする（新しいコメントは保留状態で始まります）",
    "Max thread depth": "最大スレッドの深さ",
    "Close submissions after (days, blank = never)": "送信の受付終了（日数、空欄=無期限）",
    "Spam auto-reject score (0–1)": "スパム自動拒否スコア（0〜1）",
    "Max submissions per IP per hour": "1時間あたりのIPごとの最大送信数",
    "Save settings": "設定を保存",

    "failed to load the moderation queue": "モデレーションキューを読み込めませんでした",
    "Failed to purge comment.": "コメントを完全に削除できませんでした。",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "このコメントは読み込み後に変更されました（現在のバージョン {currentVersion}）。更新してもう一度お試しください。",
    "This comment changed since you loaded it — refresh and try again.": "このコメントは読み込み後に変更されました。更新してもう一度お試しください。",
    "Failed to update comment.": "コメントを更新できませんでした。",
    "Spam auto-reject score must be between 0 and 1.": "スパム自動拒否スコアは 0 から 1 の間である必要があります。",
    "failed to load Comments settings": "コメント設定を読み込めませんでした",
    "failed to save Comments settings": "コメント設定を保存できませんでした",
  },
  ko: {
    Approve: "승인",
    Spam: "스팸",
    Restore: "복원",
    Purge: "영구 삭제",

    "Loading…": "로딩 중…",
    Author: "작성자",
    Comment: "댓글",
    Depth: "깊이",
    Created: "생성일",
    "Load more": "더 보기",
    "Loading comments…": "댓글을 불러오는 중…",
    "Loading Comments…": "댓글을 불러오는 중…",
    "No {status} comments.": '"{status}" 상태의 댓글이 없습니다.',
    "Permanently delete this comment?": "이 댓글을 영구적으로 삭제하시겠습니까?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      '"{author}"님의 이 댓글을 영구적으로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
    "Permanently delete": "영구 삭제",
    'Actions for the comment by "{author}"': '"{author}"님의 댓글에 대한 작업',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "수신되는 댓글을 검토하고 워크스페이스 전체의 댓글 동작을 구성하세요.",
    "You do not have permission to view the moderation queue.": "검토 대기열을 볼 권한이 없습니다.",
    "Loading Comments settings…": "댓글 설정을 불러오는 중…",
    "Comments enabled": "댓글 사용",
    "Require moderation (new comments start pending)": "검토 필수 (새 댓글은 대기 상태로 시작됨)",
    "Max thread depth": "최대 스레드 깊이",
    "Close submissions after (days, blank = never)": "제출 마감 기한 (일수, 비워 두면 마감 없음)",
    "Spam auto-reject score (0–1)": "스팸 자동 거부 점수(0~1)",
    "Max submissions per IP per hour": "IP당 시간당 최대 제출 수",
    "Save settings": "설정 저장",

    "failed to load the moderation queue": "검토 대기열을 불러오지 못했습니다",
    "Failed to purge comment.": "댓글을 완전히 삭제하지 못했습니다.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "이 댓글은 불러온 후 변경되었습니다(현재 버전 {currentVersion}). 새로고침한 후 다시 시도하세요.",
    "This comment changed since you loaded it — refresh and try again.": "이 댓글은 불러온 후 변경되었습니다. 새로고침한 후 다시 시도하세요.",
    "Failed to update comment.": "댓글을 업데이트하지 못했습니다.",
    "Spam auto-reject score must be between 0 and 1.": "스팸 자동 거부 점수는 0과 1 사이여야 합니다.",
    "failed to load Comments settings": "댓글 설정을 불러오지 못했습니다",
    "failed to save Comments settings": "댓글 설정을 저장하지 못했습니다",
  },
  pl: {
    Approve: "Zatwierdź",
    Spam: "Spam",
    Restore: "Przywróć",
    Purge: "Usuń trwale",

    "Loading…": "Wczytywanie…",
    Author: "Autor",
    Comment: "Komentarz",
    Depth: "Głębokość",
    Created: "Utworzono",
    "Load more": "Wczytaj więcej",
    "Loading comments…": "Wczytywanie komentarzy…",
    "Loading Comments…": "Wczytywanie komentarzy…",
    "No {status} comments.": 'Brak komentarzy o statusie "{status}".',
    "Permanently delete this comment?": "Trwale usunąć ten komentarz?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'Trwale usunąć ten komentarz użytkownika "{author}"? Tej czynności nie można cofnąć.',
    "Permanently delete": "Usuń trwale",
    'Actions for the comment by "{author}"': 'Działania dla komentarza użytkownika "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Moderuj przychodzące komentarze i konfiguruj zachowanie komentarzy w całej przestrzeni roboczej.",
    "You do not have permission to view the moderation queue.":
      "Nie masz uprawnień do wyświetlania kolejki moderacji.",
    "Loading Comments settings…": "Wczytywanie ustawień komentarzy…",
    "Comments enabled": "Komentarze włączone",
    "Require moderation (new comments start pending)":
      "Wymagaj moderacji (nowe komentarze zaczynają jako oczekujące)",
    "Max thread depth": "Maksymalna głębokość wątku",
    "Close submissions after (days, blank = never)": "Zamknij przyjmowanie po (dni, puste = nigdy)",
    "Spam auto-reject score (0–1)": "Wynik automatycznego odrzucania spamu (0–1)",
    "Max submissions per IP per hour": "Maksymalna liczba zgłoszeń na adres IP na godzinę",
    "Save settings": "Zapisz ustawienia",

    "failed to load the moderation queue": "nie udało się wczytać kolejki moderacji",
    "Failed to purge comment.": "Nie udało się trwale usunąć komentarza.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Ten komentarz zmienił się od czasu jego wczytania (bieżąca wersja {currentVersion}); odśwież i spróbuj ponownie.",
    "This comment changed since you loaded it — refresh and try again.": "Ten komentarz zmienił się od czasu jego wczytania; odśwież i spróbuj ponownie.",
    "Failed to update comment.": "Nie udało się zaktualizować komentarza.",
    "Spam auto-reject score must be between 0 and 1.": "Wynik automatycznego odrzucania spamu musi być między 0 a 1.",
    "failed to load Comments settings": "nie udało się wczytać ustawień komentarzy",
    "failed to save Comments settings": "nie udało się zapisać ustawień komentarzy",
  },
  hu: {
    Approve: "Jóváhagyás",
    Spam: "Spam",
    Restore: "Visszaállítás",
    Purge: "Végleges törlés",

    "Loading…": "Betöltés…",
    Author: "Szerző",
    Comment: "Hozzászólás",
    Depth: "Mélység",
    Created: "Létrehozva",
    "Load more": "Továbbiak betöltése",
    "Loading comments…": "Hozzászólások betöltése…",
    "Loading Comments…": "Hozzászólások betöltése…",
    "No {status} comments.": "Nincs „{status}” állapotú hozzászólás.",
    "Permanently delete this comment?": "Véglegesen törli ezt a hozzászólást?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      "Véglegesen törli „{author}” hozzászólását? Ez a művelet nem vonható vissza.",
    "Permanently delete": "Végleges törlés",
    'Actions for the comment by "{author}"': "Műveletek a(z) „{author}” hozzászólásához",
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Moderálja a beérkező hozzászólásokat, és állítsa be a hozzászólások viselkedését a teljes munkaterületen.",
    "You do not have permission to view the moderation queue.":
      "Nincs jogosultsága a moderálási várólista megtekintéséhez.",
    "Loading Comments settings…": "A Hozzászólások beállításainak betöltése…",
    "Comments enabled": "Hozzászólások engedélyezve",
    "Require moderation (new comments start pending)":
      "Moderálás megkövetelése (az új hozzászólások függőben kezdődnek)",
    "Max thread depth": "Maximális szálmélység",
    "Close submissions after (days, blank = never)": "Beküldések lezárása ennyi nap után (üresen hagyva = soha)",
    "Spam auto-reject score (0–1)": "Spam automatikus elutasítási pontszáma (0–1)",
    "Max submissions per IP per hour": "Maximális beküldés IP-nként óránként",
    "Save settings": "Beállítások mentése",

    "failed to load the moderation queue": "a moderálási várólista betöltése sikertelen",
    "Failed to purge comment.": "A hozzászólás végleges törlése sikertelen.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Ez a hozzászólás a betöltése óta megváltozott (jelenlegi verzió: {currentVersion}); frissítsen, majd próbálja újra.",
    "This comment changed since you loaded it — refresh and try again.": "Ez a hozzászólás a betöltése óta megváltozott; frissítsen, majd próbálja újra.",
    "Failed to update comment.": "A hozzászólás frissítése sikertelen.",
    "Spam auto-reject score must be between 0 and 1.": "A spam automatikus elutasítási pontszámának 0 és 1 között kell lennie.",
    "failed to load Comments settings": "a Hozzászólások beállításainak betöltése sikertelen",
    "failed to save Comments settings": "a Hozzászólások beállításainak mentése sikertelen",
  },
  fr: {
    Approve: "Approuver",
    Spam: "Spam",
    Restore: "Restaurer",
    Purge: "Supprimer définitivement",

    "Loading…": "Chargement…",
    Author: "Auteur",
    Comment: "Commentaire",
    Depth: "Profondeur",
    Created: "Créé le",
    "Load more": "Charger plus",
    "Loading comments…": "Chargement des commentaires…",
    "Loading Comments…": "Chargement des commentaires…",
    "No {status} comments.": "Aucun commentaire « {status} ».",
    "Permanently delete this comment?": "Supprimer définitivement ce commentaire ?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      "Supprimer définitivement ce commentaire de « {author} » ? Cette action est irréversible.",
    "Permanently delete": "Supprimer définitivement",
    'Actions for the comment by "{author}"': "Actions pour le commentaire de « {author} »",
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Modérez les commentaires entrants et configurez le comportement des commentaires pour tout l'espace de travail.",
    "You do not have permission to view the moderation queue.":
      "Vous n'avez pas l'autorisation de consulter la file de modération.",
    "Loading Comments settings…": "Chargement des paramètres des commentaires…",
    "Comments enabled": "Commentaires activés",
    "Require moderation (new comments start pending)":
      "Exiger une modération (les nouveaux commentaires démarrent en attente)",
    "Max thread depth": "Profondeur maximale du fil",
    "Close submissions after (days, blank = never)": "Clore les envois après (jours, vide = jamais)",
    "Spam auto-reject score (0–1)": "Score de rejet automatique du spam (0–1)",
    "Max submissions per IP per hour": "Envois maximum par IP et par heure",
    "Save settings": "Enregistrer les paramètres",

    "failed to load the moderation queue": "échec du chargement de la file de modération",
    "Failed to purge comment.": "Échec de la suppression définitive du commentaire.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Ce commentaire a changé depuis son chargement (version actuelle {currentVersion}) ; actualisez et réessayez.",
    "This comment changed since you loaded it — refresh and try again.": "Ce commentaire a changé depuis son chargement ; actualisez et réessayez.",
    "Failed to update comment.": "Échec de la mise à jour du commentaire.",
    "Spam auto-reject score must be between 0 and 1.": "Le score de rejet automatique du spam doit être compris entre 0 et 1.",
    "failed to load Comments settings": "échec du chargement des paramètres des commentaires",
    "failed to save Comments settings": "échec de l'enregistrement des paramètres des commentaires",
  },
  uk: {
    Approve: "Схвалити",
    // Transliterated into Cyrillic ("Спам"), same reasoning as ru.
    Spam: "Спам",
    Restore: "Відновити",
    Purge: "Видалити назавжди",

    "Loading…": "Завантаження…",
    Author: "Автор",
    Comment: "Коментар",
    Depth: "Глибина",
    Created: "Створено",
    "Load more": "Завантажити ще",
    "Loading comments…": "Завантаження коментарів…",
    "Loading Comments…": "Завантаження коментарів…",
    "No {status} comments.": 'Немає коментарів зі статусом "{status}".',
    "Permanently delete this comment?": "Видалити цей коментар назавжди?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'Видалити назавжди цей коментар від "{author}"? Цю дію не можна скасувати.',
    "Permanently delete": "Видалити назавжди",
    'Actions for the comment by "{author}"': 'Дії для коментаря від "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Модеруйте вхідні коментарі та налаштовуйте поведінку коментарів для всього робочого простору.",
    "You do not have permission to view the moderation queue.":
      "У вас немає дозволу переглядати чергу модерації.",
    "Loading Comments settings…": "Завантаження налаштувань коментарів…",
    "Comments enabled": "Коментарі увімкнено",
    "Require moderation (new comments start pending)":
      "Вимагати модерацію (нові коментарі починаються зі статусу «очікує»)",
    "Max thread depth": "Максимальна глибина треду",
    "Close submissions after (days, blank = never)": "Закривати надсилання через (днів, порожнє = ніколи)",
    "Spam auto-reject score (0–1)": "Оцінка автоматичного відхилення спаму (0–1)",
    "Max submissions per IP per hour": "Максимум надсилань з одного IP за годину",
    "Save settings": "Зберегти налаштування",

    "failed to load the moderation queue": "не вдалося завантажити чергу модерації",
    "Failed to purge comment.": "Не вдалося видалити коментар назавжди.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Цей коментар змінився після завантаження (поточна версія {currentVersion}); оновіть сторінку та спробуйте ще раз.",
    "This comment changed since you loaded it — refresh and try again.": "Цей коментар змінився після завантаження; оновіть сторінку та спробуйте ще раз.",
    "Failed to update comment.": "Не вдалося оновити коментар.",
    "Spam auto-reject score must be between 0 and 1.": "Оцінка автоматичного відхилення спаму має бути від 0 до 1.",
    "failed to load Comments settings": "не вдалося завантажити налаштування коментарів",
    "failed to save Comments settings": "не вдалося зберегти налаштування коментарів",
  },
  tr: {
    Approve: "Onayla",
    Spam: "Spam",
    Restore: "Geri yükle",
    Purge: "Kalıcı olarak sil",

    "Loading…": "Yükleniyor…",
    Author: "Yazar",
    Comment: "Yorum",
    Depth: "Derinlik",
    Created: "Oluşturulma",
    "Load more": "Daha fazla yükle",
    "Loading comments…": "Yorumlar yükleniyor…",
    "Loading Comments…": "Yorumlar yükleniyor…",
    "No {status} comments.": '"{status}" durumunda yorum yok.',
    "Permanently delete this comment?": "Bu yorum kalıcı olarak silinsin mi?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      '"{author}" kullanıcısının bu yorumu kalıcı olarak silinsin mi? Bu işlem geri alınamaz.',
    "Permanently delete": "Kalıcı olarak sil",
    'Actions for the comment by "{author}"': '"{author}" kullanıcısının yorumu için işlemler',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Gelen yorumları denetleyin ve çalışma alanı genelinde yorum davranışını yapılandırın.",
    "You do not have permission to view the moderation queue.":
      "Denetim kuyruğunu görüntüleme izniniz yok.",
    "Loading Comments settings…": "Yorumlar ayarları yükleniyor…",
    "Comments enabled": "Yorumlar etkin",
    "Require moderation (new comments start pending)":
      "Denetim gerektir (yeni yorumlar beklemede olarak başlar)",
    "Max thread depth": "Maksimum konu derinliği",
    "Close submissions after (days, blank = never)": "Gönderimleri şu süre sonra kapat (gün, boş = asla)",
    "Spam auto-reject score (0–1)": "Otomatik spam reddetme puanı (0–1)",
    "Max submissions per IP per hour": "IP başına saatte maksimum gönderim",
    "Save settings": "Ayarları kaydet",

    "failed to load the moderation queue": "moderasyon kuyruğu yüklenemedi",
    "Failed to purge comment.": "Yorum kalıcı olarak silinemedi.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Bu yorum siz yükledikten sonra değişti (geçerli sürüm {currentVersion}); yenileyip tekrar deneyin.",
    "This comment changed since you loaded it — refresh and try again.": "Bu yorum siz yükledikten sonra değişti; yenileyip tekrar deneyin.",
    "Failed to update comment.": "Yorum güncellenemedi.",
    "Spam auto-reject score must be between 0 and 1.": "Spam otomatik reddetme puanı 0 ile 1 arasında olmalıdır.",
    "failed to load Comments settings": "Yorumlar ayarları yüklenemedi",
    "failed to save Comments settings": "Yorumlar ayarları kaydedilemedi",
  },
  th: {
    Approve: "อนุมัติ",
    // Native term — Gmail's own Thai interface renders its Spam folder as สแปม (transliterated),
    // not the bare Latin word.
    Spam: "สแปม",
    Restore: "กู้คืน",
    Purge: "ลบอย่างถาวร",

    "Loading…": "กำลังโหลด…",
    Author: "ผู้เขียน",
    Comment: "ความคิดเห็น",
    Depth: "ความลึก",
    Created: "สร้างเมื่อ",
    "Load more": "โหลดเพิ่มเติม",
    "Loading comments…": "กำลังโหลดความคิดเห็น…",
    "Loading Comments…": "กำลังโหลดความคิดเห็น…",
    "No {status} comments.": 'ไม่มีความคิดเห็นสถานะ "{status}"',
    "Permanently delete this comment?": "ลบความคิดเห็นนี้อย่างถาวรใช่หรือไม่",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'ลบความคิดเห็นนี้จาก "{author}" อย่างถาวรใช่หรือไม่ การดำเนินการนี้ไม่สามารถย้อนกลับได้',
    "Permanently delete": "ลบอย่างถาวร",
    'Actions for the comment by "{author}"': 'การดำเนินการสำหรับความคิดเห็นจาก "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "ตรวจสอบความคิดเห็นที่เข้ามาและกำหนดค่าพฤติกรรมความคิดเห็นทั่วทั้งพื้นที่ทำงาน",
    "You do not have permission to view the moderation queue.": "คุณไม่มีสิทธิ์ดูคิวการตรวจสอบ",
    "Loading Comments settings…": "กำลังโหลดการตั้งค่าความคิดเห็น…",
    "Comments enabled": "เปิดใช้งานความคิดเห็น",
    "Require moderation (new comments start pending)":
      "กำหนดให้ต้องตรวจสอบ (ความคิดเห็นใหม่จะเริ่มต้นในสถานะรอดำเนินการ)",
    "Max thread depth": "ความลึกสูงสุดของกระทู้",
    "Close submissions after (days, blank = never)": "ปิดรับการส่งหลังจาก (วัน เว้นว่าง = ไม่ปิด)",
    "Spam auto-reject score (0–1)": "คะแนนปฏิเสธสแปมอัตโนมัติ (0–1)",
    "Max submissions per IP per hour": "จำนวนการส่งสูงสุดต่อ IP ต่อชั่วโมง",
    "Save settings": "บันทึกการตั้งค่า",

    "failed to load the moderation queue": "โหลดคิวการตรวจสอบไม่สำเร็จ",
    "Failed to purge comment.": "ลบความคิดเห็นอย่างถาวรไม่สำเร็จ",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "ความคิดเห็นนี้เปลี่ยนแปลงหลังจากที่คุณโหลดแล้ว (เวอร์ชันปัจจุบัน {currentVersion}) โปรดรีเฟรชแล้วลองอีกครั้ง",
    "This comment changed since you loaded it — refresh and try again.": "ความคิดเห็นนี้เปลี่ยนแปลงหลังจากที่คุณโหลดแล้ว โปรดรีเฟรชแล้วลองอีกครั้ง",
    "Failed to update comment.": "อัปเดตความคิดเห็นไม่สำเร็จ",
    "Spam auto-reject score must be between 0 and 1.": "คะแนนปฏิเสธสแปมอัตโนมัติต้องอยู่ระหว่าง 0 และ 1",
    "failed to load Comments settings": "โหลดการตั้งค่าความคิดเห็นไม่สำเร็จ",
    "failed to save Comments settings": "บันทึกการตั้งค่าความคิดเห็นไม่สำเร็จ",
  },
  it: {
    Approve: "Approva",
    Spam: "Spam",
    Restore: "Ripristina",
    Purge: "Elimina definitivamente",

    "Loading…": "Caricamento…",
    Author: "Autore",
    Comment: "Commento",
    Depth: "Profondità",
    Created: "Creato",
    "Load more": "Carica altro",
    "Loading comments…": "Caricamento dei commenti…",
    "Loading Comments…": "Caricamento dei commenti…",
    "No {status} comments.": 'Nessun commento "{status}".',
    "Permanently delete this comment?": "Eliminare definitivamente questo commento?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'Eliminare definitivamente questo commento di "{author}"? Questa azione non può essere annullata.',
    "Permanently delete": "Elimina definitivamente",
    'Actions for the comment by "{author}"': 'Azioni per il commento di "{author}"',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "Modera i commenti in arrivo e configura il comportamento dei commenti per l'intera area di lavoro.",
    "You do not have permission to view the moderation queue.":
      "Non disponi dell'autorizzazione per visualizzare la coda di moderazione.",
    "Loading Comments settings…": "Caricamento delle impostazioni dei Commenti…",
    "Comments enabled": "Commenti abilitati",
    "Require moderation (new comments start pending)":
      "Richiedi moderazione (i nuovi commenti iniziano come in sospeso)",
    "Max thread depth": "Profondità massima del thread",
    "Close submissions after (days, blank = never)": "Chiudi gli invii dopo (giorni, vuoto = mai)",
    "Spam auto-reject score (0–1)": "Punteggio di rifiuto automatico dello spam (0–1)",
    "Max submissions per IP per hour": "Invii massimi per IP all'ora",
    "Save settings": "Salva impostazioni",

    "failed to load the moderation queue": "impossibile caricare la coda di moderazione",
    "Failed to purge comment.": "Impossibile eliminare definitivamente il commento.",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "Questo commento è cambiato da quando lo hai caricato (versione corrente {currentVersion}); aggiorna e riprova.",
    "This comment changed since you loaded it — refresh and try again.": "Questo commento è cambiato da quando lo hai caricato; aggiorna e riprova.",
    "Failed to update comment.": "Impossibile aggiornare il commento.",
    "Spam auto-reject score must be between 0 and 1.": "Il punteggio di rifiuto automatico dello spam deve essere compreso tra 0 e 1.",
    "failed to load Comments settings": "impossibile caricare le impostazioni dei Commenti",
    "failed to save Comments settings": "impossibile salvare le impostazioni dei Commenti",
  },
  hi: {
    Approve: "स्वीकृत करें",
    // Transliterated into Devanagari ("स्पैम") rather than translated — that is how Hindi
    // moderation UIs (Gmail included) render this word; the bare Latin "Spam" would read as a typo.
    Spam: "स्पैम",
    Restore: "पुनर्स्थापित करें",
    Purge: "स्थायी रूप से हटाएं",

    "Loading…": "लोड हो रहा है…",
    Author: "लेखक",
    Comment: "टिप्पणी",
    Depth: "गहराई",
    Created: "बनाया गया",
    "Load more": "अधिक लोड करें",
    "Loading comments…": "टिप्पणियाँ लोड हो रही हैं…",
    "Loading Comments…": "टिप्पणियाँ लोड हो रही हैं…",
    "No {status} comments.": 'कोई "{status}" टिप्पणी नहीं है।',
    "Permanently delete this comment?": "क्या इस टिप्पणी को स्थायी रूप से हटाना है?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'क्या "{author}" की इस टिप्पणी को स्थायी रूप से हटाना है? इसे पूर्ववत नहीं किया जा सकता।',
    "Permanently delete": "स्थायी रूप से हटाएं",
    'Actions for the comment by "{author}"': '"{author}" की टिप्पणी के लिए कार्रवाइयाँ',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "आने वाली टिप्पणियों को मॉडरेट करें और पूरे वर्कस्पेस के लिए टिप्पणी व्यवहार कॉन्फ़िगर करें।",
    "You do not have permission to view the moderation queue.":
      "आपको मॉडरेशन कतार देखने की अनुमति नहीं है।",
    "Loading Comments settings…": "टिप्पणी सेटिंग्स लोड हो रही हैं…",
    "Comments enabled": "टिप्पणियाँ सक्षम हैं",
    "Require moderation (new comments start pending)":
      "मॉडरेशन आवश्यक करें (नई टिप्पणियाँ लंबित स्थिति से शुरू होती हैं)",
    "Max thread depth": "अधिकतम थ्रेड गहराई",
    "Close submissions after (days, blank = never)": "इतने दिनों बाद सबमिशन बंद करें (दिन, खाली = कभी नहीं)",
    "Spam auto-reject score (0–1)": "स्पैम ऑटो-रिजेक्ट स्कोर (0–1)",
    "Max submissions per IP per hour": "प्रति IP प्रति घंटा अधिकतम सबमिशन",
    "Save settings": "सेटिंग्स सहेजें",

    "failed to load the moderation queue": "मॉडरेशन कतार लोड नहीं हो सकी",
    "Failed to purge comment.": "टिप्पणी को स्थायी रूप से हटाया नहीं जा सका।",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "इस टिप्पणी में आपके लोड करने के बाद बदलाव हुआ है (वर्तमान संस्करण {currentVersion}); रीफ़्रेश करके फिर प्रयास करें।",
    "This comment changed since you loaded it — refresh and try again.": "इस टिप्पणी में आपके लोड करने के बाद बदलाव हुआ है; रीफ़्रेश करके फिर प्रयास करें।",
    "Failed to update comment.": "टिप्पणी अपडेट नहीं की जा सकी।",
    "Spam auto-reject score must be between 0 and 1.": "स्पैम स्वतः-अस्वीकृति स्कोर 0 और 1 के बीच होना चाहिए।",
    "failed to load Comments settings": "टिप्पणी सेटिंग्स लोड नहीं हो सकीं",
    "failed to save Comments settings": "टिप्पणी सेटिंग्स सहेजी नहीं जा सकीं",
  },
  ur: {
    Approve: "منظور کریں",
    // Transliterated ("سپیم") rather than translated — that is how Urdu moderation UIs (Gmail
    // included) render this word; the bare Latin "Spam" would read as a typo.
    Spam: "سپیم",
    Restore: "بحال کریں",
    Purge: "مستقل طور پر حذف کریں",

    "Loading…": "لوڈ ہو رہا ہے…",
    Author: "مصنف",
    Comment: "تبصرہ",
    Depth: "گہرائی",
    Created: "تخلیق کردہ",
    "Load more": "مزید لوڈ کریں",
    "Loading comments…": "تبصرے لوڈ ہو رہے ہیں…",
    "Loading Comments…": "تبصرے لوڈ ہو رہے ہیں…",
    "No {status} comments.": 'کوئی "{status}" تبصرہ نہیں ہے۔',
    "Permanently delete this comment?": "کیا اس تبصرے کو مستقل طور پر حذف کرنا ہے؟",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      'کیا "{author}" کے اس تبصرے کو مستقل طور پر حذف کرنا ہے؟ اسے واپس نہیں کیا جا سکتا۔',
    "Permanently delete": "مستقل طور پر حذف کریں",
    'Actions for the comment by "{author}"': '"{author}" کے تبصرے کے لیے کارروائیاں',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "موصول ہونے والے تبصروں کی نگرانی کریں اور پورے ورک اسپیس کے لیے تبصرے کا رویہ ترتیب دیں۔",
    "You do not have permission to view the moderation queue.":
      "آپ کو نگرانی کی قطار دیکھنے کی اجازت نہیں ہے۔",
    "Loading Comments settings…": "تبصرہ کی ترتیبات لوڈ ہو رہی ہیں…",
    "Comments enabled": "تبصرے فعال ہیں",
    "Require moderation (new comments start pending)":
      "نگرانی لازمی کریں (نئے تبصرے زیرِ التوا حالت سے شروع ہوتے ہیں)",
    "Max thread depth": "زیادہ سے زیادہ تھریڈ گہرائی",
    "Close submissions after (days, blank = never)": "اتنے دنوں بعد جمع کرانا بند کریں (دن، خالی = کبھی نہیں)",
    "Spam auto-reject score (0–1)": "سپیم خودکار مسترد اسکور (0–1)",
    "Max submissions per IP per hour": "فی IP فی گھنٹہ زیادہ سے زیادہ جمع کرانا",
    "Save settings": "ترتیبات محفوظ کریں",

    "failed to load the moderation queue": "نگرانی کی قطار لوڈ نہیں ہو سکی",
    "Failed to purge comment.": "تبصرہ مستقل طور پر حذف نہیں ہو سکا۔",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "یہ تبصرہ آپ کے لوڈ کرنے کے بعد تبدیل ہو گیا ہے (موجودہ ورژن {currentVersion})؛ تازہ کریں اور دوبارہ کوشش کریں۔",
    "This comment changed since you loaded it — refresh and try again.": "یہ تبصرہ آپ کے لوڈ کرنے کے بعد تبدیل ہو گیا ہے؛ تازہ کریں اور دوبارہ کوشش کریں۔",
    "Failed to update comment.": "تبصرہ اپ ڈیٹ نہیں ہو سکا۔",
    "Spam auto-reject score must be between 0 and 1.": "اسپام خودکار مسترد کرنے کا اسکور 0 اور 1 کے درمیان ہونا چاہیے۔",
    "failed to load Comments settings": "تبصرہ کی ترتیبات لوڈ نہیں ہو سکیں",
    "failed to save Comments settings": "تبصرہ کی ترتیبات محفوظ نہیں ہو سکیں",
  },
  bn: {
    Approve: "অনুমোদন করুন",
    // Transliterated ("স্প্যাম") rather than translated — that is how Bengali moderation UIs
    // (Gmail included) render this word; the bare Latin "Spam" would read as a typo.
    Spam: "স্প্যাম",
    Restore: "পুনরুদ্ধার করুন",
    Purge: "স্থায়ীভাবে মুছুন",

    "Loading…": "লোড হচ্ছে…",
    Author: "লেখক",
    Comment: "মন্তব্য",
    Depth: "গভীরতা",
    Created: "তৈরি হয়েছে",
    "Load more": "আরও লোড করুন",
    "Loading comments…": "মন্তব্য লোড হচ্ছে…",
    "Loading Comments…": "মন্তব্য লোড হচ্ছে…",
    "No {status} comments.": 'কোনো "{status}" মন্তব্য নেই।',
    "Permanently delete this comment?": "এই মন্তব্যটি কি স্থায়ীভাবে মুছে ফেলা হবে?",
    'Permanently delete this comment by "{author}"? This cannot be undone.':
      '"{author}"-এর এই মন্তব্যটি কি স্থায়ীভাবে মুছে ফেলা হবে? এটি ফিরিয়ে আনা যাবে না।',
    "Permanently delete": "স্থায়ীভাবে মুছুন",
    'Actions for the comment by "{author}"': '"{author}"-এর মন্তব্যের জন্য কার্যক্রম',
    "Moderate incoming comments and configure workspace-wide comment behavior.":
      "আগত মন্তব্যগুলি পর্যালোচনা করুন এবং পুরো ওয়ার্কস্পেস জুড়ে মন্তব্যের আচরণ কনফিগার করুন।",
    "You do not have permission to view the moderation queue.":
      "পর্যালোচনা সারি দেখার অনুমতি আপনার নেই।",
    "Loading Comments settings…": "মন্তব্য সেটিংস লোড হচ্ছে…",
    "Comments enabled": "মন্তব্য সক্ষম করা হয়েছে",
    "Require moderation (new comments start pending)":
      "পর্যালোচনা আবশ্যক করুন (নতুন মন্তব্য মুলতুবি অবস্থায় শুরু হয়)",
    "Max thread depth": "সর্বোচ্চ থ্রেড গভীরতা",
    "Close submissions after (days, blank = never)": "এত দিন পর জমা বন্ধ করুন (দিন, খালি = কখনও নয়)",
    "Spam auto-reject score (0–1)": "স্প্যাম স্বয়ংক্রিয়-প্রত্যাখ্যান স্কোর (0–1)",
    "Max submissions per IP per hour": "প্রতি IP প্রতি ঘণ্টায় সর্বোচ্চ জমা",
    "Save settings": "সেটিংস সংরক্ষণ করুন",

    "failed to load the moderation queue": "পর্যালোচনা সারি লোড করা যায়নি",
    "Failed to purge comment.": "মন্তব্যটি স্থায়ীভাবে মুছে ফেলা যায়নি।",
    "This comment changed since you loaded it (current version {currentVersion}) — refresh and try again.": "আপনার লোড করার পর এই মন্তব্যটি পরিবর্তিত হয়েছে (বর্তমান সংস্করণ {currentVersion}); রিফ্রেশ করে আবার চেষ্টা করুন।",
    "This comment changed since you loaded it — refresh and try again.": "আপনার লোড করার পর এই মন্তব্যটি পরিবর্তিত হয়েছে; রিফ্রেশ করে আবার চেষ্টা করুন।",
    "Failed to update comment.": "মন্তব্যটি আপডেট করা যায়নি।",
    "Spam auto-reject score must be between 0 and 1.": "স্প্যাম স্বয়ংক্রিয় প্রত্যাখ্যান স্কোর 0 এবং 1-এর মধ্যে হতে হবে।",
    "failed to load Comments settings": "মন্তব্য সেটিংস লোড করা যায়নি",
    "failed to save Comments settings": "মন্তব্য সেটিংস সংরক্ষণ করা যায়নি",
  },
};

/** The host binds its commonDictionary once; `t` falls back to the common copy on a miss. */
export function createCommentsDictionary(
  { commonDictionary }: { commonDictionary: LocaleDictionary },
  _optional = {},
): { t: DictionaryTranslator } {
  const featureDictionary = COMMENTS_DICT;
  return { t: createDictionaryTranslator({ featureDictionary }, { commonDictionary }) };
}
