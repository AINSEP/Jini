/**
 * @file Comments screen dictionary slice — the page header and the Comments settings form, in every locale. One of the slices the former single
 * host `comments-i18n.ts` was split into by screen area; `create-comments-dictionary.ts` composes them
 * (entries and their why-comments are unchanged, just regrouped).
 */
export const COMMENTS_SETTINGS_I18N: Record<string, Record<string, string>> = {
  es: {
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
  },
  id: {
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
  },
  de: {
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
  },
  "zh-CN": {
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
  },
  "zh-TW": {
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
  },
  "pt-BR": {
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
  },
  ru: {
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
  },
  fa: {
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
  },
  ar: {
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
  },
  ja: {
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
  },
  ko: {
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
  },
  pl: {
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
  },
  hu: {
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
  },
  fr: {
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
  },
  uk: {
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
  },
  tr: {
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
  },
  th: {
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
  },
  it: {
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
  },
  hi: {
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
  },
  ur: {
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
  },
  bn: {
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
  },
};
