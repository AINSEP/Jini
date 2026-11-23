import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
/**
 * @file The Settings screen's own copy for its AI agent tab: what the admin's stored BYOK key
 * cannot do at the form's endpoint, plus the rest of the tab's own copy — `AdminByokKeyFooter`'s
 * "Saved to the server…" / "Stored on the server…" status lines, `AdminByokSettingsFooter`'s
 * "Settings saved." confirmation, and the Local CLI scope label.
 *
 * Not in `SettingsUi.tsx`'s `t`: that one reads `@jini-ai/ui`'s and `@jini-ai/cms`'s settings-dialog
 * dictionaries, which are other packages' copy. Not in `settings-capabilities-i18n.ts` either: that file is
 * the "no backend yet" notes.
 *
 * All six keys also live in the host's AI Assistant dictionary (`features/ai-assistant/ai-assistant-i18n.ts`) for AI Assistant's mount of
 * the same form. Every value here is copied from there verbatim, so the two screens word the ask
 * alike; the host's `__tests__/settings-execution-i18n.unit.test.ts` fails if either copy changes alone for the
 * two stored-key asks. No `en` block: English is this dict's own key text, so
 * `createDictionaryTranslator`'s `?? key` fallback already renders it for that locale — a literal
 * `en` entry mapping each key to itself would be dead weight.
 *
 * The Local CLI server-scope key names the host's product, so it carries a `{productName}` token in
 * the key and in every translation; the host fills it through `interpolate()` at each render site
 * (K3: product copy stays in the host). An unfilled token renders literally.
 */

import { createDictionaryTranslator } from '@jini-ai/core/text';
const SETTINGS_EXECUTION_DICT: Record<string, Record<string, string>> = {
  es: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI está oculto por ahora en los sitios desplegados. Se usa BYOK; tu elección guardada no cambia.",
    "AI agent": "Agente de IA",
    "Detected on this computer.": "Detectado en este ordenador.",
    "Authentication required. Sign in before sending.": "Se requiere autenticación. Inicia sesión antes de enviar.",
    "No API key saved on the server. Save one first.": "No hay ninguna clave de API guardada en el servidor. Guarda una primero.",
    "Your saved key is for a different provider. Paste a key for this one.": "Tu clave guardada es de otro proveedor. Pega una clave para este.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Tu clave guardada no tiene un proveedor guardado. Pega la clave de nuevo para probarla.",
    "Saved to the server, encrypted.": "Guardada en el servidor, cifrada.",
    "Settings saved.": "Configuración guardada.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Almacenada en el servidor, cifrada. Pega una clave nueva para reemplazarla.",
    "Detected on the {productName} server, not on your own computer.": "Detectado en el servidor de {productName}, no en tu propio equipo.",
  },
  id: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI sementara disembunyikan di situs yang diterapkan. BYOK digunakan; pilihan tersimpan Anda tetap sama.",
    "AI agent": "Agen AI",
    "Detected on this computer.": "Terdeteksi di komputer ini.",
    "Authentication required. Sign in before sending.": "Autentikasi diperlukan. Masuk sebelum mengirim.",
    "No API key saved on the server. Save one first.": "Tidak ada kunci API yang tersimpan di server. Simpan satu terlebih dahulu.",
    "Your saved key is for a different provider. Paste a key for this one.": "Kunci tersimpan Anda untuk penyedia lain. Tempel kunci untuk penyedia ini.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Kunci tersimpan Anda tidak memiliki penyedia yang tersimpan. Tempel kunci lagi untuk mengujinya.",
    "Saved to the server, encrypted.": "Disimpan ke server, terenkripsi.",
    "Settings saved.": "Pengaturan disimpan.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Disimpan di server, terenkripsi. Tempel kunci baru untuk menggantinya.",
    "Detected on the {productName} server, not on your own computer.": "Terdeteksi di server {productName}, bukan di komputer Anda sendiri.",
  },
  de: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI ist auf bereitgestellten Websites vorerst ausgeblendet. BYOK wird verwendet; Ihre gespeicherte Auswahl bleibt unverändert.",
    "AI agent": "KI-Agent",
    "Detected on this computer.": "Auf diesem Computer erkannt.",
    "Authentication required. Sign in before sending.": "Authentifizierung erforderlich. Melden Sie sich vor dem Senden an.",
    "No API key saved on the server. Save one first.": "Kein API-Schlüssel auf dem Server gespeichert. Speichern Sie zuerst einen.",
    "Your saved key is for a different provider. Paste a key for this one.": "Ihr gespeicherter Schlüssel gehört zu einem anderen Anbieter. Fügen Sie einen Schlüssel für diesen ein.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Für Ihren gespeicherten Schlüssel ist kein Anbieter gespeichert. Fügen Sie den Schlüssel erneut ein, um ihn zu testen.",
    "Saved to the server, encrypted.": "Verschlüsselt auf dem Server gespeichert.",
    "Settings saved.": "Einstellungen gespeichert.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Verschlüsselt auf dem Server gespeichert. Fügen Sie einen neuen Schlüssel ein, um ihn zu ersetzen.",
    "Detected on the {productName} server, not on your own computer.": "Auf dem {productName}-Server erkannt, nicht auf Ihrem eigenen Computer.",
  },
  "zh-CN": {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "已部署的网站暂时隐藏 Local CLI。当前使用 BYOK；您保存的选择保持不变。",
    "AI agent": "AI 智能体",
    "Detected on this computer.": "在这台计算机上检测到。",
    "Authentication required. Sign in before sending.": "需要身份验证。请先登录再发送。",
    "No API key saved on the server. Save one first.": "服务器上没有保存 API 密钥。请先保存一个。",
    "Your saved key is for a different provider. Paste a key for this one.": "已保存的密钥属于其他提供商。请粘贴此提供商的密钥。",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "已保存的密钥未关联提供商。请重新粘贴密钥以进行测试。",
    "Saved to the server, encrypted.": "已加密保存到服务器。",
    "Settings saved.": "设置已保存。",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "已加密存储在服务器上。粘贴新密钥即可替换。",
    "Detected on the {productName} server, not on your own computer.": "在 {productName} 服务器上检测到，而非您自己的计算机。",
  },
  "zh-TW": {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "已部署的網站暫時隱藏 Local CLI。目前使用 BYOK；您儲存的選擇保持不變。",
    "AI agent": "AI 代理",
    "Detected on this computer.": "在這台電腦上偵測到。",
    "Authentication required. Sign in before sending.": "需要驗證身分。請先登入再傳送。",
    "No API key saved on the server. Save one first.": "伺服器上沒有儲存 API 金鑰。請先儲存一個。",
    "Your saved key is for a different provider. Paste a key for this one.": "已儲存的金鑰屬於其他供應商。請貼上此供應商的金鑰。",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "已儲存的金鑰未關聯供應商。請重新貼上金鑰以進行測試。",
    "Saved to the server, encrypted.": "已加密儲存至伺服器。",
    "Settings saved.": "設定已儲存。",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "已加密儲存在伺服器上。貼上新金鑰即可取代。",
    "Detected on the {productName} server, not on your own computer.": "在 {productName} 伺服器上偵測到，而非您自己的電腦。",
  },
  "pt-BR": {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI está oculto por enquanto nos sites implantados. BYOK é usado; sua escolha salva permanece igual.",
    "AI agent": "Agente de IA",
    "Detected on this computer.": "Detectado neste computador.",
    "Authentication required. Sign in before sending.": "Autenticação necessária. Entre antes de enviar.",
    "No API key saved on the server. Save one first.": "Nenhuma chave de API salva no servidor. Salve uma primeiro.",
    "Your saved key is for a different provider. Paste a key for this one.": "Sua chave salva é de outro provedor. Cole uma chave para este.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Sua chave salva não tem um provedor salvo. Cole a chave novamente para testá-la.",
    "Saved to the server, encrypted.": "Salva no servidor, criptografada.",
    "Settings saved.": "Configurações salvas.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Armazenada no servidor, criptografada. Cole uma nova chave para substituí-la.",
    "Detected on the {productName} server, not on your own computer.": "Detectado no servidor da {productName}, não no seu próprio computador.",
  },
  ru: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "На развёрнутых сайтах Local CLI пока скрыт. Используется BYOK; сохранённый выбор не изменён.",
    "AI agent": "ИИ-агент",
    "Detected on this computer.": "Обнаружено на этом компьютере.",
    "Authentication required. Sign in before sending.": "Требуется авторизация. Войдите перед отправкой.",
    "No API key saved on the server. Save one first.": "На сервере не сохранён API-ключ. Сначала сохраните ключ.",
    "Your saved key is for a different provider. Paste a key for this one.": "Сохранённый ключ относится к другому провайдеру. Вставьте ключ для этого.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Для сохранённого ключа не сохранён провайдер. Вставьте ключ снова, чтобы проверить его.",
    "Saved to the server, encrypted.": "Сохранено на сервере в зашифрованном виде.",
    "Settings saved.": "Настройки сохранены.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Хранится на сервере в зашифрованном виде. Вставьте новый ключ, чтобы заменить его.",
    "Detected on the {productName} server, not on your own computer.": "Обнаружено на сервере {productName}, а не на вашем компьютере.",
  },
  fa: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI فعلاً در سایت‌های مستقر پنهان است. از BYOK استفاده می‌شود؛ انتخاب ذخیره‌شده شما تغییر نمی‌کند.",
    "AI agent": "عامل هوش مصنوعی",
    "Detected on this computer.": "روی این رایانه شناسایی شد.",
    "Authentication required. Sign in before sending.": "احراز هویت لازم است. پیش از ارسال وارد شوید.",
    "No API key saved on the server. Save one first.": "هیچ کلید API روی سرور ذخیره نشده است. ابتدا یک کلید ذخیره کنید.",
    "Your saved key is for a different provider. Paste a key for this one.": "کلید ذخیره‌شده شما برای ارائه‌دهنده دیگری است. کلیدی برای این ارائه‌دهنده جای‌گذاری کنید.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "برای کلید ذخیره‌شده شما ارائه‌دهنده‌ای ذخیره نشده است. برای آزمایش، کلید را دوباره جای‌گذاری کنید.",
    "Saved to the server, encrypted.": "به‌صورت رمزنگاری‌شده روی سرور ذخیره شد.",
    "Settings saved.": "تنظیمات ذخیره شد.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "به‌صورت رمزنگاری‌شده روی سرور ذخیره شده است. برای جایگزینی، کلید جدید را جای‌گذاری کنید.",
    "Detected on the {productName} server, not on your own computer.": "روی سرور {productName} شناسایی شد، نه روی رایانه‌ی خودتان.",
  },
  ar: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI مخفي مؤقتًا على المواقع المنشورة. يُستخدم BYOK؛ اختيارك المحفوظ لم يتغير.",
    "AI agent": "وكيل الذكاء الاصطناعي",
    "Detected on this computer.": "اكتُشف على هذا الكمبيوتر.",
    "Authentication required. Sign in before sending.": "المصادقة مطلوبة. سجّل الدخول قبل الإرسال.",
    "No API key saved on the server. Save one first.": "لا يوجد مفتاح API محفوظ على الخادم. احفظ مفتاحًا أولًا.",
    "Your saved key is for a different provider. Paste a key for this one.": "مفتاحك المحفوظ يخص مزوّدًا آخر. الصق مفتاحًا لهذا المزوّد.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "لا يوجد مزوّد محفوظ مع مفتاحك المحفوظ. الصق المفتاح مرة أخرى لاختباره.",
    "Saved to the server, encrypted.": "حُفظ على الخادم، مشفَّرًا.",
    "Settings saved.": "حُفظت الإعدادات.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "مخزَّن على الخادم، مشفَّرًا. الصق مفتاحًا جديدًا لاستبداله.",
    "Detected on the {productName} server, not on your own computer.": "اكتُشف على خادم {productName}، وليس على جهاز الكمبيوتر الخاص بك.",
  },
  ja: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "デプロイ済みサイトでは、Local CLI は現在非表示です。BYOK を使用します。保存済みの選択は変更されません。",
    "AI agent": "AI エージェント",
    "Detected on this computer.": "このコンピューターで検出されました。",
    "Authentication required. Sign in before sending.": "認証が必要です。送信する前にログインしてください。",
    "No API key saved on the server. Save one first.": "サーバーに API キーが保存されていません。先にキーを保存してください。",
    "Your saved key is for a different provider. Paste a key for this one.": "保存されているキーは別のプロバイダー用です。このプロバイダーのキーを貼り付けてください。",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "保存されているキーにはプロバイダーが保存されていません。テストするにはキーをもう一度貼り付けてください。",
    "Saved to the server, encrypted.": "暗号化されてサーバーに保存済みです。",
    "Settings saved.": "設定を保存しました。",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "暗号化されてサーバーに保存されています。置き換えるには新しいキーを貼り付けてください。",
    "Detected on the {productName} server, not on your own computer.": "自分のコンピューターではなく、{productName}サーバー上で検出されました。",
  },
  ko: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "배포된 사이트에서는 현재 Local CLI가 숨겨집니다. BYOK가 사용되며 저장된 선택은 변경되지 않습니다.",
    "AI agent": "AI 에이전트",
    "Detected on this computer.": "이 컴퓨터에서 감지되었습니다.",
    "Authentication required. Sign in before sending.": "인증이 필요합니다. 보내기 전에 로그인하세요.",
    "No API key saved on the server. Save one first.": "서버에 저장된 API 키가 없습니다. 먼저 키를 저장하세요.",
    "Your saved key is for a different provider. Paste a key for this one.": "저장된 키는 다른 공급자용입니다. 이 공급자의 키를 붙여넣으세요.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "저장된 키에 공급자가 저장되어 있지 않습니다. 테스트하려면 키를 다시 붙여넣으세요.",
    "Saved to the server, encrypted.": "암호화되어 서버에 저장되었습니다.",
    "Settings saved.": "설정이 저장되었습니다.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "암호화되어 서버에 저장되어 있습니다. 교체하려면 새 키를 붙여넣으세요.",
    "Detected on the {productName} server, not on your own computer.": "사용자님의 컴퓨터가 아니라 {productName} 서버에서 감지되었습니다.",
  },
  pl: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI jest na razie ukryte we wdrożonych witrynach. Używane jest BYOK; zapisany wybór pozostaje bez zmian.",
    "AI agent": "Agent AI",
    "Detected on this computer.": "Wykryto na tym komputerze.",
    "Authentication required. Sign in before sending.": "Wymagane uwierzytelnienie. Zaloguj się przed wysłaniem.",
    "No API key saved on the server. Save one first.": "Na serwerze nie zapisano klucza API. Najpierw zapisz klucz.",
    "Your saved key is for a different provider. Paste a key for this one.": "Zapisany klucz należy do innego dostawcy. Wklej klucz dla tego dostawcy.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Zapisany klucz nie ma zapisanego dostawcy. Wklej klucz ponownie, aby go przetestować.",
    "Saved to the server, encrypted.": "Zapisano na serwerze, zaszyfrowany.",
    "Settings saved.": "Ustawienia zapisane.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Przechowywany na serwerze, zaszyfrowany. Wklej nowy klucz, aby go zastąpić.",
    "Detected on the {productName} server, not on your own computer.": "Wykryto na serwerze {productName}, a nie na Twoim komputerze.",
  },
  hu: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "A telepített webhelyeken a Local CLI egyelőre rejtve van. A BYOK használatos; a mentett választás változatlan.",
    "AI agent": "AI-ügynök",
    "Detected on this computer.": "Ezen a számítógépen észlelve.",
    "Authentication required. Sign in before sending.": "Hitelesítés szükséges. Küldés előtt jelentkezzen be.",
    "No API key saved on the server. Save one first.": "Nincs API-kulcs mentve a szerveren. Először mentsen egyet.",
    "Your saved key is for a different provider. Paste a key for this one.": "A mentett kulcs egy másik szolgáltatóhoz tartozik. Illesszen be egy kulcsot ehhez.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "A mentett kulcshoz nincs szolgáltató mentve. A teszteléshez illessze be újra a kulcsot.",
    "Saved to the server, encrypted.": "Titkosítva mentve a szerverre.",
    "Settings saved.": "Beállítások mentve.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Titkosítva tárolva a szerveren. A cseréhez illesszen be egy új kulcsot.",
    "Detected on the {productName} server, not on your own computer.": "A {productName} szerveren észlelve, nem a saját számítógépén.",
  },
  fr: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI est masqué pour le moment sur les sites déployés. BYOK est utilisé ; votre choix enregistré reste inchangé.",
    "AI agent": "Agent IA",
    "Detected on this computer.": "Détecté sur cet ordinateur.",
    "Authentication required. Sign in before sending.": "Authentification requise. Connectez-vous avant d’envoyer.",
    "No API key saved on the server. Save one first.": "Aucune clé API enregistrée sur le serveur. Enregistrez-en une d'abord.",
    "Your saved key is for a different provider. Paste a key for this one.": "Votre clé enregistrée est celle d'un autre fournisseur. Collez une clé pour celui-ci.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Aucun fournisseur n'est enregistré avec votre clé. Collez à nouveau la clé pour la tester.",
    "Saved to the server, encrypted.": "Enregistrée sur le serveur, chiffrée.",
    "Settings saved.": "Paramètres enregistrés.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Stockée sur le serveur, chiffrée. Collez une nouvelle clé pour la remplacer.",
    "Detected on the {productName} server, not on your own computer.": "Détecté sur le serveur {productName}, pas sur votre propre ordinateur.",
  },
  uk: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "На розгорнутих сайтах Local CLI поки приховано. Використовується BYOK; збережений вибір не змінено.",
    "AI agent": "ШІ-агент",
    "Detected on this computer.": "Виявлено на цьому комп’ютері.",
    "Authentication required. Sign in before sending.": "Потрібна автентифікація. Увійдіть перед надсиланням.",
    "No API key saved on the server. Save one first.": "На сервері не збережено API-ключ. Спочатку збережіть ключ.",
    "Your saved key is for a different provider. Paste a key for this one.": "Збережений ключ належить іншому постачальнику. Вставте ключ для цього.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Для збереженого ключа не збережено постачальника. Вставте ключ ще раз, щоб перевірити його.",
    "Saved to the server, encrypted.": "Збережено на сервері в зашифрованому вигляді.",
    "Settings saved.": "Налаштування збережено.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Зберігається на сервері в зашифрованому вигляді. Вставте новий ключ, щоб замінити його.",
    "Detected on the {productName} server, not on your own computer.": "Виявлено на сервері {productName}, а не на вашому комп'ютері.",
  },
  tr: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Dağıtılan sitelerde Local CLI şimdilik gizlidir. BYOK kullanılır; kaydedilmiş seçiminiz değişmez.",
    "AI agent": "Yapay zekâ ajanı",
    "Detected on this computer.": "Bu bilgisayarda algılandı.",
    "Authentication required. Sign in before sending.": "Kimlik doğrulaması gerekiyor. Göndermeden önce oturum açın.",
    "No API key saved on the server. Save one first.": "Sunucuda kayıtlı API anahtarı yok. Önce bir anahtar kaydedin.",
    "Your saved key is for a different provider. Paste a key for this one.": "Kayıtlı anahtarınız başka bir sağlayıcıya ait. Bu sağlayıcı için bir anahtar yapıştırın.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Kayıtlı anahtarınızla birlikte kaydedilmiş bir sağlayıcı yok. Test etmek için anahtarı yeniden yapıştırın.",
    "Saved to the server, encrypted.": "Sunucuya şifrelenerek kaydedildi.",
    "Settings saved.": "Ayarlar kaydedildi.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Sunucuda şifrelenerek saklanıyor. Değiştirmek için yeni bir anahtar yapıştırın.",
    "Detected on the {productName} server, not on your own computer.": "Kendi bilgisayarınızda değil, {productName} sunucusunda algılandı.",
  },
  th: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "ขณะนี้ Local CLI ถูกซ่อนบนเว็บไซต์ที่นำขึ้นใช้งาน โดยใช้ BYOK แทน ตัวเลือกที่บันทึกไว้ของคุณยังคงเดิม",
    "AI agent": "เอเจนต์ AI",
    "Detected on this computer.": "ตรวจพบบนคอมพิวเตอร์เครื่องนี้",
    "Authentication required. Sign in before sending.": "ต้องยืนยันตัวตน โปรดเข้าสู่ระบบก่อนส่ง",
    "No API key saved on the server. Save one first.": "ไม่มีคีย์ API ที่บันทึกไว้บนเซิร์ฟเวอร์ โปรดบันทึกคีย์ก่อน",
    "Your saved key is for a different provider. Paste a key for this one.": "คีย์ที่บันทึกไว้เป็นของผู้ให้บริการรายอื่น วางคีย์สำหรับผู้ให้บริการนี้",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "คีย์ที่บันทึกไว้ไม่มีผู้ให้บริการที่บันทึกไว้ วางคีย์อีกครั้งเพื่อทดสอบ",
    "Saved to the server, encrypted.": "บันทึกลงเซิร์ฟเวอร์แบบเข้ารหัสแล้ว",
    "Settings saved.": "บันทึกการตั้งค่าแล้ว",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "จัดเก็บบนเซิร์ฟเวอร์แบบเข้ารหัส วางคีย์ใหม่เพื่อแทนที่",
    "Detected on the {productName} server, not on your own computer.": "ตรวจพบบนเซิร์ฟเวอร์ {productName} ไม่ใช่บนคอมพิวเตอร์ของคุณเอง",
  },
  it: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "Local CLI è per ora nascosto sui siti distribuiti. Si usa BYOK; la scelta salvata resta invariata.",
    "AI agent": "Agente IA",
    "Detected on this computer.": "Rilevato su questo computer.",
    "Authentication required. Sign in before sending.": "Autenticazione richiesta. Accedi prima di inviare.",
    "No API key saved on the server. Save one first.": "Nessuna chiave API salvata sul server. Salvane prima una.",
    "Your saved key is for a different provider. Paste a key for this one.": "La chiave salvata è di un altro provider. Incolla una chiave per questo.",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "Alla chiave salvata non è associato alcun provider. Incolla di nuovo la chiave per testarla.",
    "Saved to the server, encrypted.": "Salvata sul server, crittografata.",
    "Settings saved.": "Impostazioni salvate.",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "Archiviata sul server, crittografata. Incolla una nuova chiave per sostituirla.",
    "Detected on the {productName} server, not on your own computer.": "Rilevato sul server {productName}, non sul tuo computer.",
  },
  hi: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "डिप्लॉय की गई साइटों पर Local CLI अभी छिपा हुआ है। BYOK का उपयोग होता है; आपका सहेजा गया विकल्प नहीं बदलता।",
    "AI agent": "AI एजेंट",
    "Detected on this computer.": "इस कंप्यूटर पर पता लगाया गया।",
    "Authentication required. Sign in before sending.": "प्रमाणीकरण आवश्यक है। भेजने से पहले साइन इन करें।",
    "No API key saved on the server. Save one first.": "सर्वर पर कोई API कुंजी सहेजी नहीं गई है। पहले एक कुंजी सहेजें।",
    "Your saved key is for a different provider. Paste a key for this one.": "आपकी सहेजी गई कुंजी किसी दूसरे प्रदाता की है। इस प्रदाता के लिए कुंजी पेस्ट करें।",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "आपकी सहेजी गई कुंजी के साथ कोई प्रदाता सहेजा नहीं गया है। जाँचने के लिए कुंजी फिर से पेस्ट करें।",
    "Saved to the server, encrypted.": "सर्वर पर एन्क्रिप्टेड रूप से सहेजा गया।",
    "Settings saved.": "सेटिंग्स सहेजी गईं।",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "सर्वर पर एन्क्रिप्टेड रूप से संग्रहीत। इसे बदलने के लिए एक नई कुंजी पेस्ट करें।",
    "Detected on the {productName} server, not on your own computer.": "{productName} सर्वर पर पहचाना गया, आपके अपने कंप्यूटर पर नहीं।",
  },
  ur: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "تعینات شدہ سائٹس پر Local CLI فی الحال پوشیدہ ہے۔ BYOK استعمال ہوتا ہے؛ آپ کا محفوظ انتخاب تبدیل نہیں ہوتا۔",
    "AI agent": "AI ایجنٹ",
    "Detected on this computer.": "اس کمپیوٹر پر دریافت ہوا۔",
    "Authentication required. Sign in before sending.": "توثیق درکار ہے۔ بھیجنے سے پہلے سائن ان کریں۔",
    "No API key saved on the server. Save one first.": "سرور پر کوئی API کلید محفوظ نہیں ہے۔ پہلے ایک کلید محفوظ کریں۔",
    "Your saved key is for a different provider. Paste a key for this one.": "آپ کی محفوظ کلید کسی دوسرے فراہم کنندہ کی ہے۔ اس فراہم کنندہ کے لیے کلید پیسٹ کریں۔",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "آپ کی محفوظ کلید کے ساتھ کوئی فراہم کنندہ محفوظ نہیں ہے۔ جانچنے کے لیے کلید دوبارہ پیسٹ کریں۔",
    "Saved to the server, encrypted.": "سرور پر خفیہ کاری کے ساتھ محفوظ ہو گئی۔",
    "Settings saved.": "ترتیبات محفوظ ہو گئیں۔",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "سرور پر خفیہ کاری کے ساتھ محفوظ ہے۔ اسے بدلنے کے لیے نئی کلید پیسٹ کریں۔",
    "Detected on the {productName} server, not on your own computer.": "{productName} سرور پر شناخت ہوئی، آپ کے اپنے کمپیوٹر پر نہیں۔",
  },
  bn: {
    "Local CLI is hidden on deployed sites for now. BYOK is used; your saved choice is unchanged.": "স্থাপিত সাইটে Local CLI আপাতত লুকানো আছে। BYOK ব্যবহার করা হয়; আপনার সংরক্ষিত পছন্দ অপরিবর্তিত থাকে।",
    "AI agent": "AI এজেন্ট",
    "Detected on this computer.": "এই কম্পিউটারে শনাক্ত হয়েছে।",
    "Authentication required. Sign in before sending.": "প্রমাণীকরণ প্রয়োজন। পাঠানোর আগে সাইন ইন করুন।",
    "No API key saved on the server. Save one first.": "সার্ভারে কোনো API কী সংরক্ষিত নেই। আগে একটি কী সংরক্ষণ করুন।",
    "Your saved key is for a different provider. Paste a key for this one.": "আপনার সংরক্ষিত কী অন্য একটি প্রদানকারীর। এই প্রদানকারীর জন্য একটি কী পেস্ট করুন।",
    "Your saved key has no provider saved with it. Paste the key again to test it.": "আপনার সংরক্ষিত কী-এর সঙ্গে কোনো প্রদানকারী সংরক্ষিত নেই। পরীক্ষা করতে কী আবার পেস্ট করুন।",
    "Saved to the server, encrypted.": "এনক্রিপ্ট করে সার্ভারে সংরক্ষিত হয়েছে।",
    "Settings saved.": "সেটিংস সংরক্ষিত হয়েছে।",
    "Stored on the server, encrypted. Paste a new key to replace it.":
      "এনক্রিপ্ট করে সার্ভারে সংরক্ষিত আছে। প্রতিস্থাপন করতে নতুন কী পেস্ট করুন।",
    "Detected on the {productName} server, not on your own computer.": "{productName} সার্ভারে শনাক্ত হয়েছে, আপনার নিজের কম্পিউটারে নয়।",
  },
};

export const t = createDictionaryTranslator({ featureDictionary: SETTINGS_EXECUTION_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

/** Keep the package's internal translation key stable while changing all rendered labels/ARIA.
 * Host dictionary overlays are the published extension point; installed packages stay untouched. */
export function aiAgentPanelDictionaries(
  { dictionaries, locales }: {
    dictionaries: Partial<Record<string, Readonly<Record<string, string>>>>;
    /** The host's admin locale list (each `code` gets the overlay). */
    locales: readonly { readonly code: string }[];
  }, _optional = {},
): Partial<Record<string, Record<string, string>>> {
  const result: Partial<Record<string, Record<string, string>>> = { ...dictionaries };
  // Through the translator, never an inline dictionary index (dictionary-lookup-sinks guard).
  for (const { code: locale } of locales) {
    const label = t({ locale: locale, key: 'AI agent' });
    result[locale] = { ...dictionaries[locale], 'Execution mode': label, 'AI agent': label };
  }
  return result;
}
