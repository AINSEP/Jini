/* Runtime dictionary keys returned by deployment rules and hooks, as index-aligned rows. Split from `../deployment-i18n.tsx` (size ratchet). */

/** Runtime dictionary keys returned by deployment rules and hooks. */
const DEPLOYMENT_CANDIDATE_GAP_STRINGS: Record<string, string> = {
  "This connection was already saved — reload the page and try again.": "This connection was already saved — reload the page and try again.",
  "Unknown error": "Unknown error",
  "Pages, posts & products": "Pages, posts & products",
  "Checkout & orders": "Checkout & orders",
  "Admin panel, online": "Admin panel, online",
  "AI assistant": "AI assistant",
  "Not started": "Not started",
  "Export failed": "Export failed",
  "Finished with failures": "Finished with failures",
  "Export finished": "Export finished",
  "Publish failed": "Publish failed",
  "This workspace can't use your computer's terminal — connecting here is the only way to publish.": "This workspace can't use your computer's terminal — connecting here is the only way to publish.",
  "(optional)": "(optional)",
};

export function candidateGapTranslationEntries({ entries }: { entries: readonly string[] }, _optional: Record<string, never> = {}): Record<string, string> {
  const keys = Object.keys(DEPLOYMENT_CANDIDATE_GAP_STRINGS);
  if (entries.length !== keys.length) {
    throw new Error(`Deployment candidate translation has ${entries.length} entries; expected ${keys.length}.`);
  }
  // The length check above guarantees every index is present.
  return Object.fromEntries(keys.map((key, index) => [key, entries[index] as string]));
}

export const DEPLOYMENT_CANDIDATE_GAP_TRANSLATIONS: Record<string, Record<string, string>> = {
  en: DEPLOYMENT_CANDIDATE_GAP_STRINGS,
  es: candidateGapTranslationEntries({ entries: [
    "Esta conexión ya se guardó; recarga la página e inténtalo de nuevo.", "Error desconocido", "Páginas, publicaciones y productos", "Pago y pedidos", "Panel de administración, en línea", "Asistente de IA", "Sin iniciar", "La exportación falló", "Terminó con errores", "La exportación terminó", "La publicación falló", "Este espacio de trabajo no puede usar el terminal de tu computadora; conectarte aquí es la única forma de publicar.", "(opcional)",
  ] }),
  id: candidateGapTranslationEntries({ entries: [
    "Koneksi ini sudah disimpan — muat ulang halaman dan coba lagi.", "Kesalahan tidak diketahui", "Halaman, pos & produk", "Checkout & pesanan", "Panel admin, online", "Asisten AI", "Belum dimulai", "Ekspor gagal", "Selesai dengan kegagalan", "Ekspor selesai", "Publikasi gagal", "Ruang kerja ini tidak dapat menggunakan terminal komputer Anda — menghubungkan di sini adalah satu-satunya cara untuk menerbitkan.", "(opsional)",
  ] }),
  de: candidateGapTranslationEntries({ entries: [
    "Diese Verbindung wurde bereits gespeichert — laden Sie die Seite neu und versuchen Sie es erneut.", "Unbekannter Fehler", "Seiten, Beiträge und Produkte", "Checkout und Bestellungen", "Admin-Bereich, online", "KI-Assistent", "Nicht gestartet", "Export fehlgeschlagen", "Mit Fehlern beendet", "Export abgeschlossen", "Veröffentlichung fehlgeschlagen", "Dieser Arbeitsbereich kann das Terminal Ihres Computers nicht verwenden — die Verbindung hier ist die einzige Möglichkeit zu veröffentlichen.", "(optional)",
  ] }),
  fr: candidateGapTranslationEntries({ entries: [
    "Cette connexion est déjà enregistrée — rechargez la page et réessayez.", "Erreur inconnue", "Pages, publications et produits", "Paiement et commandes", "Panneau d’administration, en ligne", "Assistant IA", "Non démarré", "Échec de l’exportation", "Terminé avec des échecs", "Exportation terminée", "Échec de la publication", "Cet espace de travail ne peut pas utiliser le terminal de votre ordinateur — vous connecter ici est la seule façon de publier.", "(facultatif)",
  ] }),
  it: candidateGapTranslationEntries({ entries: [
    "Questa connessione è già stata salvata — ricarica la pagina e riprova.", "Errore sconosciuto", "Pagine, post e prodotti", "Checkout e ordini", "Pannello di amministrazione, online", "Assistente IA", "Non avviato", "Esportazione non riuscita", "Terminato con errori", "Esportazione terminata", "Pubblicazione non riuscita", "Questo spazio di lavoro non può usare il terminale del tuo computer — collegarti qui è l’unico modo per pubblicare.", "(facoltativo)",
  ] }),
  "pt-BR": candidateGapTranslationEntries({ entries: [
    "Esta conexão já foi salva — recarregue a página e tente novamente.", "Erro desconhecido", "Páginas, posts e produtos", "Checkout e pedidos", "Painel administrativo, online", "Assistente de IA", "Não iniciado", "A exportação falhou", "Terminou com falhas", "Exportação concluída", "A publicação falhou", "Este espaço de trabalho não pode usar o terminal do seu computador — conectar aqui é a única forma de publicar.", "(opcional)",
  ] }),
  "zh-CN": candidateGapTranslationEntries({ entries: [
    "此连接已保存——请重新加载页面后重试。", "未知错误", "页面、文章和产品", "结账和订单", "管理面板，在线", "AI 助手", "尚未开始", "导出失败", "完成但有失败", "导出完成", "发布失败", "此工作区无法使用您计算机的终端——在此连接是唯一的发布方式。", "（可选）",
  ] }),
  "zh-TW": candidateGapTranslationEntries({ entries: [
    "此連線已儲存——請重新載入頁面後再試。", "未知錯誤", "頁面、文章與產品", "結帳與訂單", "管理面板，在線", "AI 助理", "尚未開始", "匯出失敗", "完成但有失敗", "匯出完成", "發佈失敗", "此工作區無法使用您電腦的終端機——在此連線是唯一的發佈方式。", "（選填）",
  ] }),
  ar: candidateGapTranslationEntries({ entries: [
    "تم حفظ هذا الاتصال بالفعل — أعد تحميل الصفحة وحاول مرة أخرى.", "خطأ غير معروف", "الصفحات والمنشورات والمنتجات", "الدفع والطلبات", "لوحة الإدارة، متصلة", "مساعد الذكاء الاصطناعي", "لم يبدأ", "فشل التصدير", "انتهى مع إخفاقات", "اكتمل التصدير", "فشل النشر", "لا يمكن لمساحة العمل هذه استخدام طرفية جهازك — الاتصال هنا هو الطريقة الوحيدة للنشر.", "(اختياري)",
  ] }),
  bn: candidateGapTranslationEntries({ entries: [
    "এই সংযোগটি ইতিমধ্যেই সংরক্ষিত হয়েছে — পৃষ্ঠাটি পুনরায় লোড করে আবার চেষ্টা করুন।", "অজানা ত্রুটি", "পৃষ্ঠা, পোস্ট ও পণ্য", "চেকআউট ও অর্ডার", "অ্যাডমিন প্যানেল, অনলাইন", "AI সহায়ক", "শুরু হয়নি", "এক্সপোর্ট ব্যর্থ হয়েছে", "ব্যর্থতা সহ শেষ হয়েছে", "এক্সপোর্ট শেষ হয়েছে", "প্রকাশনা ব্যর্থ হয়েছে", "এই কর্মক্ষেত্রটি আপনার কম্পিউটারের টার্মিনাল ব্যবহার করতে পারে না — এখানে সংযুক্ত করাই প্রকাশের একমাত্র উপায়।", "(ঐচ্ছিক)",
  ] }),
  fa: candidateGapTranslationEntries({ entries: [
    "این اتصال قبلاً ذخیره شده است — صفحه را دوباره بارگیری کنید و دوباره تلاش کنید.", "خطای ناشناخته", "صفحه‌ها، نوشته‌ها و محصولات", "پرداخت و سفارش‌ها", "پنل مدیریت، آنلاین", "دستیار هوش مصنوعی", "شروع نشده", "خروجی ناموفق بود", "با خطاها پایان یافت", "خروجی تمام شد", "انتشار ناموفق بود", "این فضای کاری نمی‌تواند از ترمینال رایانه شما استفاده کند — اتصال در اینجا تنها راه انتشار است.", "(اختیاری)",
  ] }),
  hi: candidateGapTranslationEntries({ entries: [
    "यह कनेक्शन पहले ही सहेजा जा चुका है — पेज फिर से लोड करें और दोबारा कोशिश करें।", "अज्ञात त्रुटि", "पेज, पोस्ट और उत्पाद", "चेकआउट और ऑर्डर", "एडमिन पैनल, ऑनलाइन", "AI सहायक", "शुरू नहीं हुआ", "एक्सपोर्ट विफल हुआ", "विफलताओं के साथ समाप्त", "एक्सपोर्ट पूरा हुआ", "प्रकाशन विफल हुआ", "यह कार्यक्षेत्र आपके कंप्यूटर का टर्मिनल उपयोग नहीं कर सकता — यहाँ कनेक्ट करना ही प्रकाशित करने का एकमात्र तरीका है।", "(वैकल्पिक)",
  ] }),
  hu: candidateGapTranslationEntries({ entries: [
    "Ez a kapcsolat már el van mentve — töltse újra az oldalt, és próbálja meg újra.", "Ismeretlen hiba", "Oldalak, bejegyzések és termékek", "Pénztár és rendelések", "Adminisztrációs panel, online", "MI-asszisztens", "Nincs elindítva", "Az export sikertelen", "Hibákkal fejeződött be", "Az export befejeződött", "A közzététel sikertelen", "Ez a munkaterület nem használhatja a számítógépe terminálját — az itt történő csatlakozás az egyetlen közzétételi mód.", "(nem kötelező)",
  ] }),
  ja: candidateGapTranslationEntries({ entries: [
    "この接続はすでに保存されています。ページを再読み込みして、もう一度お試しください。", "不明なエラー", "ページ、投稿、商品", "チェックアウトと注文", "管理パネル、オンライン", "AI アシスタント", "未開始", "エクスポートに失敗しました", "失敗を含めて完了", "エクスポート完了", "公開に失敗しました", "このワークスペースではお使いのコンピューターのターミナルを使用できません。ここで接続することが公開する唯一の方法です。", "（任意）",
  ] }),
  ko: candidateGapTranslationEntries({ entries: [
    "이 연결은 이미 저장되었습니다. 페이지를 새로고침한 뒤 다시 시도하세요.", "알 수 없는 오류", "페이지, 게시물 및 제품", "결제 및 주문", "관리자 패널, 온라인", "AI 도우미", "시작되지 않음", "내보내기 실패", "실패와 함께 완료", "내보내기 완료", "게시 실패", "이 작업 공간은 컴퓨터의 터미널을 사용할 수 없습니다. 여기에서 연결하는 것이 게시하는 유일한 방법입니다.", "(선택 사항)",
  ] }),
  pl: candidateGapTranslationEntries({ entries: [
    "To połączenie zostało już zapisane — odśwież stronę i spróbuj ponownie.", "Nieznany błąd", "Strony, wpisy i produkty", "Kasa i zamówienia", "Panel administracyjny, online", "Asystent AI", "Nie rozpoczęto", "Eksport nie powiódł się", "Zakończono z niepowodzeniami", "Eksport zakończony", "Publikacja nie powiodła się", "Ten obszar roboczy nie może używać terminala Twojego komputera — połączenie tutaj jest jedynym sposobem publikacji.", "(opcjonalnie)",
  ] }),
  ru: candidateGapTranslationEntries({ entries: [
    "Это подключение уже сохранено — перезагрузите страницу и попробуйте снова.", "Неизвестная ошибка", "Страницы, записи и товары", "Оформление заказа и заказы", "Панель администратора, онлайн", "ИИ-помощник", "Не запущено", "Экспорт не удался", "Завершено с ошибками", "Экспорт завершён", "Публикация не удалась", "Это рабочее пространство не может использовать терминал вашего компьютера — подключение здесь является единственным способом публикации.", "(необязательно)",
  ] }),
  th: candidateGapTranslationEntries({ entries: [
    "บันทึกการเชื่อมต่อนี้แล้ว — โหลดหน้าใหม่แล้วลองอีกครั้ง", "ข้อผิดพลาดที่ไม่ทราบสาเหตุ", "หน้า โพสต์ และสินค้า", "ชำระเงินและคำสั่งซื้อ", "แผงผู้ดูแลระบบ ออนไลน์", "ผู้ช่วย AI", "ยังไม่เริ่ม", "การส่งออกล้มเหลว", "เสร็จสิ้นพร้อมข้อผิดพลาด", "การส่งออกเสร็จสิ้น", "การเผยแพร่ล้มเหลว", "พื้นที่ทำงานนี้ไม่สามารถใช้เทอร์มินัลของคอมพิวเตอร์คุณได้ — การเชื่อมต่อที่นี่เป็นวิธีเดียวในการเผยแพร่", "(ไม่บังคับ)",
  ] }),
  tr: candidateGapTranslationEntries({ entries: [
    "Bu bağlantı zaten kaydedildi — sayfayı yeniden yükleyip tekrar deneyin.", "Bilinmeyen hata", "Sayfalar, gönderiler ve ürünler", "Ödeme ve siparişler", "Yönetici paneli, çevrimiçi", "Yapay zekâ asistanı", "Başlatılmadı", "Dışa aktarma başarısız", "Hatalarla tamamlandı", "Dışa aktarma tamamlandı", "Yayınlama başarısız", "Bu çalışma alanı bilgisayarınızın terminalini kullanamaz — buradan bağlanmak yayınlamanın tek yoludur.", "(isteğe bağlı)",
  ] }),
  uk: candidateGapTranslationEntries({ entries: [
    "Це підключення вже збережено — перезавантажте сторінку й спробуйте ще раз.", "Невідома помилка", "Сторінки, дописи й товари", "Оформлення замовлення та замовлення", "Панель адміністратора, онлайн", "ШІ-помічник", "Не запущено", "Експорт не вдався", "Завершено з помилками", "Експорт завершено", "Публікація не вдалася", "Цей робочий простір не може використовувати термінал вашого комп’ютера — підключення тут є єдиним способом публікації.", "(необов’язково)",
  ] }),
  ur: candidateGapTranslationEntries({ entries: [
    "یہ کنکشن پہلے ہی محفوظ ہو چکا ہے — صفحہ دوبارہ لوڈ کریں اور پھر کوشش کریں۔", "نامعلوم خرابی", "صفحات، پوسٹس اور مصنوعات", "چیک آؤٹ اور آرڈرز", "ایڈمن پینل، آن لائن", "AI معاون", "شروع نہیں ہوا", "ایکسپورٹ ناکام ہوا", "ناکامیوں کے ساتھ ختم ہوا", "ایکسپورٹ مکمل ہوا", "اشاعت ناکام ہوئی", "یہ ورک اسپیس آپ کے کمپیوٹر کا ٹرمینل استعمال نہیں کر سکتی — یہاں کنکشن کرنا شائع کرنے کا واحد طریقہ ہے۔", "(اختیاری)",
  ] }),
};
