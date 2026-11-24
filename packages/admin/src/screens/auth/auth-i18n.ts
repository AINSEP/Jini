import { translationEntry } from "../../shell/lib/translation-entry.js";
import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";

import { createDictionaryTranslator } from '@jini-ai/core/text';
/** Login-screen copy.  Keep this separate from the app-shell dictionary: Login is rendered
 * before the shell and must not fall back to English for a signed-out operator. */
const AUTH_DICT: Record<string, Record<string, string>> = {
  es: { "Sign in to your workspace": "Inicia sesión en tu espacio de trabajo", Username: "Nombre de usuario", ...translationEntry({ source: "Password", translated: "Contraseña" }), "Sign in": "Iniciar sesión", "Signing in…": "Iniciando sesión…" },
  id: { "Sign in to your workspace": "Masuk ke ruang kerja Anda", Username: "Nama pengguna", Password: "Kata sandi", "Sign in": "Masuk", "Signing in…": "Sedang masuk…" },
  de: { "Sign in to your workspace": "Melden Sie sich bei Ihrem Arbeitsbereich an", Username: "Benutzername", Password: "Passwort", "Sign in": "Anmelden", "Signing in…": "Anmeldung läuft…" },
  "zh-CN": { "Sign in to your workspace": "登录您的工作区", Username: "用户名", Password: "密码", "Sign in": "登录", "Signing in…": "正在登录…" },
  "zh-TW": { "Sign in to your workspace": "登入您的工作區", Username: "使用者名稱", Password: "密碼", "Sign in": "登入", "Signing in…": "正在登入…" },
  "pt-BR": { "Sign in to your workspace": "Entre no seu espaço de trabalho", Username: "Nome de usuário", Password: "Senha", "Sign in": "Entrar", "Signing in…": "Entrando…" },
  ru: { "Sign in to your workspace": "Войдите в своё рабочее пространство", Username: "Имя пользователя", Password: "Пароль", "Sign in": "Войти", "Signing in…": "Выполняется вход…" },
  fa: { "Sign in to your workspace": "به فضای کاری خود وارد شوید", Username: "نام کاربری", Password: "گذرواژه", "Sign in": "ورود", "Signing in…": "در حال ورود…" },
  ar: { "Sign in to your workspace": "سجّل الدخول إلى مساحة عملك", Username: "اسم المستخدم", Password: "كلمة المرور", "Sign in": "تسجيل الدخول", "Signing in…": "جارٍ تسجيل الدخول…" },
  ja: { "Sign in to your workspace": "ワークスペースにサインイン", Username: "ユーザー名", Password: "パスワード", "Sign in": "サインイン", "Signing in…": "サインイン中…" },
  ko: { "Sign in to your workspace": "작업 공간에 로그인", Username: "사용자 이름", Password: "비밀번호", "Sign in": "로그인", "Signing in…": "로그인하는 중…" },
  pl: { "Sign in to your workspace": "Zaloguj się do swojego obszaru roboczego", Username: "Nazwa użytkownika", Password: "Hasło", "Sign in": "Zaloguj się", "Signing in…": "Logowanie…" },
  hu: { "Sign in to your workspace": "Jelentkezzen be a munkaterületére", Username: "Felhasználónév", Password: "Jelszó", "Sign in": "Bejelentkezés", "Signing in…": "Bejelentkezés folyamatban…" },
  fr: { "Sign in to your workspace": "Connectez-vous à votre espace de travail", Username: "Nom d’utilisateur", Password: "Mot de passe", "Sign in": "Se connecter", "Signing in…": "Connexion…" },
  uk: { "Sign in to your workspace": "Увійдіть до свого робочого простору", Username: "Ім’я користувача", Password: "Пароль", "Sign in": "Увійти", "Signing in…": "Виконується вхід…" },
  tr: { "Sign in to your workspace": "Çalışma alanınızda oturum açın", Username: "Kullanıcı adı", Password: "Parola", "Sign in": "Oturum aç", "Signing in…": "Oturum açılıyor…" },
  th: { "Sign in to your workspace": "ลงชื่อเข้าใช้พื้นที่ทำงานของคุณ", Username: "ชื่อผู้ใช้", Password: "รหัสผ่าน", "Sign in": "ลงชื่อเข้าใช้", "Signing in…": "กำลังลงชื่อเข้าใช้…" },
  it: { "Sign in to your workspace": "Accedi al tuo spazio di lavoro", Username: "Nome utente", Password: "Password", "Sign in": "Accedi", "Signing in…": "Accesso in corso…" },
  hi: { "Sign in to your workspace": "अपने कार्यक्षेत्र में साइन इन करें", Username: "उपयोगकर्ता नाम", Password: "पासवर्ड", "Sign in": "साइन इन करें", "Signing in…": "साइन इन हो रहा है…" },
  ur: { "Sign in to your workspace": "اپنی ورک اسپیس میں سائن ان کریں", Username: "صارف نام", Password: "پاس ورڈ", "Sign in": "سائن ان", "Signing in…": "سائن ان ہو رہا ہے…" },
  bn: { "Sign in to your workspace": "আপনার কর্মক্ষেত্রে সাইন ইন করুন", Username: "ব্যবহারকারীর নাম", ...translationEntry({ source: "Password", translated: "পাসওয়ার্ড" }), "Sign in": "সাইন ইন করুন", "Signing in…": "সাইন ইন হচ্ছে…" },
};

/** Login is outside the signed-in shell, so its copy controls need their own locale coverage. */
const DETAILS_KEYS = ["Show details", "Copy details", "Copied", "Copy failed. Select the details and copy them manually.", "Report this error ID."];
const DETAILS_COPY: Record<string, string[]> = {
  es: ["Mostrar detalles", "Copiar detalles", "Copiado", "No se pudo copiar. Selecciona los detalles y cópialos manualmente.", "Informa de este ID de error."],
  fr: ["Afficher les détails", "Copier les détails", "Copié", "Échec de la copie. Sélectionnez les détails et copiez-les manuellement.", "Signalez cet identifiant d’erreur."],
  de: ["Details anzeigen", "Details kopieren", "Kopiert", "Kopieren fehlgeschlagen. Wähle die Details aus und kopiere sie manuell.", "Melde diese Fehler-ID."],
  it: ["Mostra dettagli", "Copia dettagli", "Copiato", "Copia non riuscita. Seleziona i dettagli e copiali manualmente.", "Segnala questo ID errore."],
  "pt-BR": ["Mostrar detalhes", "Copiar detalhes", "Copiado", "Falha ao copiar. Selecione os detalhes e copie-os manualmente.", "Informe este ID de erro."],
  id: ["Tampilkan detail", "Salin detail", "Disalin", "Gagal menyalin. Pilih detail dan salin secara manual.", "Laporkan ID kesalahan ini."],
  pl: ["Pokaż szczegóły", "Kopiuj szczegóły", "Skopiowano", "Kopiowanie nie powiodło się. Zaznacz szczegóły i skopiuj je ręcznie.", "Zgłoś ten identyfikator błędu."],
  tr: ["Ayrıntıları göster", "Ayrıntıları kopyala", "Kopyalandı", "Kopyalama başarısız. Ayrıntıları seçip elle kopyalayın.", "Bu hata kimliğini bildirin."],
  hu: ["Részletek megjelenítése", "Részletek másolása", "Másolva", "A másolás sikertelen. Jelölje ki a részleteket, és másolja őket kézzel.", "Jelentse ezt a hibaazonosítót."],
  ru: ["Показать подробности", "Скопировать подробности", "Скопировано", "Не удалось скопировать. Выделите подробности и скопируйте их вручную.", "Сообщите этот идентификатор ошибки."],
  uk: ["Показати подробиці", "Копіювати подробиці", "Скопійовано", "Не вдалося скопіювати. Виділіть подробиці та скопіюйте їх вручну.", "Повідомте цей ідентифікатор помилки."],
  ar: ["إظهار التفاصيل", "نسخ التفاصيل", "تم النسخ", "تعذّر النسخ. حدّد التفاصيل وانسخها يدويًا.", "أبلغ عن معرّف الخطأ هذا."],
  fa: ["نمایش جزئیات", "کپی جزئیات", "کپی شد", "کپی نشد. جزئیات را انتخاب و دستی کپی کنید.", "این شناسهٔ خطا را گزارش دهید."],
  ur: ["تفصیلات دکھائیں", "تفصیلات کاپی کریں", "کاپی ہو گیا", "کاپی نہیں ہو سکا۔ تفصیلات منتخب کرکے دستی طور پر کاپی کریں۔", "اس خرابی کی شناخت کی اطلاع دیں۔"],
  hi: ["विवरण दिखाएँ", "विवरण कॉपी करें", "कॉपी किया गया", "कॉपी नहीं हो सका। विवरण चुनें और मैन्युअल रूप से कॉपी करें।", "इस त्रुटि आईडी की रिपोर्ट करें।"],
  bn: ["বিবরণ দেখান", "বিবরণ কপি করুন", "কপি হয়েছে", "কপি করা যায়নি। বিবরণ বেছে নিয়ে হাতে কপি করুন।", "এই ত্রুটির আইডি জানান।"],
  th: ["แสดงรายละเอียด", "คัดลอกรายละเอียด", "คัดลอกแล้ว", "คัดลอกไม่ได้ เลือกรายละเอียดแล้วคัดลอกด้วยตนเอง", "รายงานรหัสข้อผิดพลาดนี้"],
  ja: ["詳細を表示", "詳細をコピー", "コピーしました", "コピーできませんでした。詳細を選択して手動でコピーしてください。", "このエラーIDを報告してください。"],
  ko: ["세부 정보 표시", "세부 정보 복사", "복사됨", "복사하지 못했습니다. 세부 정보를 선택하여 직접 복사하세요.", "이 오류 ID를 신고하세요."],
  "zh-CN": ["显示详情", "复制详情", "已复制", "复制失败。请选择详情并手动复制。", "请报告此错误 ID。"],
  "zh-TW": ["顯示詳細資料", "複製詳細資料", "已複製", "複製失敗。請選取詳細資料並手動複製。", "請回報此錯誤 ID。"],
};
const dictionary = Object.fromEntries(Object.entries(AUTH_DICT).map(([locale, copy]) => [locale,
  { ...copy, ...Object.fromEntries(DETAILS_KEYS.map((key, index) => [key, DETAILS_COPY[locale]?.[index] ?? key])) }]));
export const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary: ADMIN_COMMON_I18N });
