/** @file Comments dictionary data, locales es, id, de, zh-CN, zh-TW, pt-BR, ru, fa, ar (split from `comments-i18n` to keep each module under the size limit). */
export const COMMENTS_DICT_ES_TO_AR: Record<string, Record<string, string>> = {
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
};
