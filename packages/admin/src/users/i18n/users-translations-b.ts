import { translationEntry } from "../../shell/lib/translation-entry.js";
/**
 * @file Users screen dictionary, locales ru…pl — one of four part files `../users-i18n.ts`
 * merges into `USERS_TRANSLATIONS`. Split per locale group only so each file stays under the
 * package's file-size limit; the content is the original dictionary's, verbatim.
 */
export const USERS_TRANSLATIONS_B: Record<string, Record<string, string>> = {
  ru: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Вы не можете предоставить право, которого у вас самих нет.",
    "You do not have permission to do that.": "У вас нет прав для этого действия.",
    "That username is already in use.": "Это имя пользователя уже используется.",
    "The workspace must keep at least one active owner.": "В рабочей области должен остаться хотя бы один активный владелец.",
    "You cannot delete your own account.": "Вы не можете удалить собственную учётную запись.",
    "This user is in the Trash; restore them first.": "Этот пользователь находится в Корзине; сначала восстановите его.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Пользователь с этим именем уже находится в Корзине; сначала восстановите его или удалите окончательно.",
    "Please correct the highlighted fields.": "Исправьте выделенные поля.",
    People: "Люди",
    Users: "Пользователи",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Учётные записи операторов с доступом к этой админ-панели — назначайте роли и политики или отключайте доступ.",
    "New user": "Новый пользователь",

    Username: "Имя пользователя",
    "Email (optional)": "Email (необязательно)",
    Password: "Пароль",
    "Create user": "Создать пользователя",

    Email: "Эл. почта",
    "(none)": "(нет)",
    "Save email": "Сохранить email",
    "Assign role": "Назначить роль",
    "Select a role…": "Выберите роль…",
    "(built-in)": "(встроенная)",
    Assign: "Назначить",
    "Attach policy": "Прикрепить политику",
    "Select a policy…": "Выберите политику…",
    Attach: "Прикрепить",

    "Actions for user": "Действия для пользователя",
    none: "нет",

    "No users yet.": "Пользователей пока нет.",
    "Create your first operator account to get started.": "Создайте свою первую учётную запись оператора, чтобы начать.",
    Roles: "Роли",
    Policies: "Политики",

    "Disable this user?": "Отключить этого пользователя?",
    "They will not be able to sign in until re-enabled.": "Он не сможет войти в систему, пока учётная запись не будет снова включена.",
    "Delete this user?": "Удалить этого пользователя?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Он будет выведен из системы и перемещён в Корзину. Вы можете восстановить его оттуда; он будет окончательно удалён через 60 дней.",
    "Move to trash": "Переместить в Корзину",
    Manage: "Управлять",

    "Reset password?": "Сбросить пароль?",
    "Set a new password for": "Установить новый пароль для",
    "Every active session for this user will be signed out.":
      "Все активные сеансы этого пользователя будут завершены.",
    "New password": "Новый пароль",
    "Reset password": "Сбросить пароль",

    "Loading users…": "Загрузка пользователей…",

    "failed to load users": "не удалось загрузить пользователей",
    "failed to create user": "не удалось создать пользователя",
    "failed to assign role": "не удалось назначить роль",
    "failed to attach policy": "не удалось прикрепить политику",
    "failed to update email": "не удалось обновить email",
    "failed to reset password": "не удалось сбросить пароль",
    "failed to change status": "не удалось изменить статус",
    "failed to delete user": "не удалось удалить пользователя",
    "Password changed. Sign in again with your new password.": "Пароль изменён. Войдите снова с новым паролем.",
  },
  fa: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "شما نمی‌توانید مجوزی را که خودتان ندارید، اعطا کنید.",
    "You do not have permission to do that.": "شما مجوز انجام این کار را ندارید.",
    "That username is already in use.": "این نام کاربری قبلاً استفاده شده است.",
    "The workspace must keep at least one active owner.": "فضای کاری باید حداقل یک مالک فعال داشته باشد.",
    "You cannot delete your own account.": "نمی‌توانید حساب خودتان را حذف کنید.",
    "This user is in the Trash; restore them first.": "این کاربر در زباله‌دان است؛ ابتدا آن را بازیابی کنید.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "کاربری با این نام کاربری در حال حاضر در زباله‌دان است؛ ابتدا آن را بازیابی یا برای همیشه حذف کنید.",
    "Please correct the highlighted fields.": "لطفاً فیلدهای برجسته‌شده را اصلاح کنید.",
    People: "افراد",
    Users: "کاربران",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "حساب‌های اپراتور با دسترسی به این پنل مدیریت — نقش و خط‌مشی تعیین کنید یا دسترسی را غیرفعال کنید.",
    "New user": "کاربر جدید",

    Username: "نام کاربری",
    "Email (optional)": "ایمیل (اختیاری)",
    Password: "رمز عبور",
    "Create user": "ایجاد کاربر",

    Email: "ایمیل",
    "(none)": "(هیچ‌کدام)",
    "Save email": "ذخیره ایمیل",
    "Assign role": "تعیین نقش",
    "Select a role…": "یک نقش انتخاب کنید…",
    "(built-in)": "(داخلی)",
    Assign: "تعیین",
    "Attach policy": "پیوست خط‌مشی",
    "Select a policy…": "یک خط‌مشی انتخاب کنید…",
    Attach: "پیوست",

    "Actions for user": "عملیات مربوط به کاربر",
    none: "هیچ‌کدام",

    "No users yet.": "هنوز کاربری وجود ندارد.",
    "Create your first operator account to get started.": "برای شروع، اولین حساب اپراتور خود را ایجاد کنید.",
    Roles: "نقش‌ها",
    Policies: "خط‌مشی‌ها",

    "Disable this user?": "این کاربر غیرفعال شود؟",
    "They will not be able to sign in until re-enabled.": "تا زمانی که دوباره فعال نشود، امکان ورود نخواهد داشت.",
    "Delete this user?": "این کاربر حذف شود؟",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "او از سیستم خارج شده و به زباله‌دان منتقل می‌شود. می‌توانید از آنجا بازیابی کنید؛ پس از ۶۰ روز برای همیشه حذف می‌شود.",
    "Move to trash": "انتقال به زباله‌دان",
    Manage: "مدیریت",

    "Reset password?": "رمز عبور بازنشانی شود؟",
    "Set a new password for": "تنظیم رمز عبور جدید برای",
    "Every active session for this user will be signed out.":
      "تمام نشست‌های فعال این کاربر خاتمه خواهد یافت.",
    "New password": "رمز عبور جدید",
    "Reset password": "بازنشانی رمز عبور",

    "Loading users…": "در حال بارگذاری کاربران…",

    "failed to load users": "بارگذاری کاربران ناموفق بود",
    "failed to create user": "ایجاد کاربر ناموفق بود",
    "failed to assign role": "تعیین نقش ناموفق بود",
    "failed to attach policy": "پیوست خط‌مشی ناموفق بود",
    "failed to update email": "به‌روزرسانی ایمیل ناموفق بود",
    "failed to reset password": "بازنشانی رمز عبور ناموفق بود",
    "failed to change status": "تغییر وضعیت ناموفق بود",
    "failed to delete user": "حذف کاربر ناموفق بود",
    "Password changed. Sign in again with your new password.": "رمز عبور تغییر کرد. با رمز عبور جدید خود دوباره وارد شوید.",
  },
  ar: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "لا يمكنك منح إذن لا تملكه أنت نفسك.",
    "You do not have permission to do that.": "ليس لديك إذن للقيام بذلك.",
    "That username is already in use.": "اسم المستخدم هذا مستخدم بالفعل.",
    "The workspace must keep at least one active owner.": "يجب أن تحتفظ مساحة العمل بمالك نشط واحد على الأقل.",
    "You cannot delete your own account.": "لا يمكنك حذف حسابك الخاص.",
    "This user is in the Trash; restore them first.": "هذا المستخدم موجود في سلة المهملات؛ استعده أولاً.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "يوجد بالفعل مستخدم بهذا الاسم في سلة المهملات؛ استعده أو احذفه نهائيًا أولاً.",
    "Please correct the highlighted fields.": "يرجى تصحيح الحقول المميزة.",
    People: "الأشخاص",
    Users: "المستخدمون",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "حسابات المشغّلين التي لديها وصول إلى لوحة الإدارة هذه — عيّن أدوارًا وسياسات، أو عطّل الوصول.",
    "New user": "مستخدم جديد",

    Username: "اسم المستخدم",
    "Email (optional)": "البريد الإلكتروني (اختياري)",
    Password: "كلمة المرور",
    "Create user": "إنشاء مستخدم",

    Email: "البريد الإلكتروني",
    "(none)": "(بلا)",
    "Save email": "حفظ البريد الإلكتروني",
    "Assign role": "تعيين دور",
    "Select a role…": "اختر دورًا…",
    "(built-in)": "(مدمج)",
    Assign: "تعيين",
    "Attach policy": "إرفاق سياسة",
    "Select a policy…": "اختر سياسة…",
    Attach: "إرفاق",

    "Actions for user": "إجراءات المستخدم",
    none: "بلا",

    "No users yet.": "لا يوجد مستخدمون بعد.",
    "Create your first operator account to get started.": "أنشئ أول حساب مشغّل لك للبدء.",
    Roles: "الأدوار",
    Policies: "السياسات",

    "Disable this user?": "تعطيل هذا المستخدم؟",
    "They will not be able to sign in until re-enabled.": "لن يتمكن من تسجيل الدخول حتى تتم إعادة تفعيل الحساب.",
    "Delete this user?": "هل تريد حذف هذا المستخدم؟",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "سيتم تسجيل خروجه ونقله إلى سلة المهملات. يمكنك استعادته من هناك؛ يُحذف نهائيًا بعد 60 يومًا.",
    "Move to trash": "نقل إلى سلة المهملات",
    Manage: "إدارة",

    "Reset password?": "إعادة تعيين كلمة المرور؟",
    "Set a new password for": "تعيين كلمة مرور جديدة لـ",
    "Every active session for this user will be signed out.":
      "سيتم تسجيل الخروج من كل جلسة نشطة لهذا المستخدم.",
    "New password": "كلمة مرور جديدة",
    "Reset password": "إعادة تعيين كلمة المرور",

    "Loading users…": "جارٍ تحميل المستخدمين…",

    "failed to load users": "تعذّر تحميل المستخدمين",
    "failed to create user": "تعذّر إنشاء المستخدم",
    "failed to assign role": "تعذّر تعيين الدور",
    "failed to attach policy": "تعذّر إرفاق السياسة",
    "failed to update email": "تعذّر تحديث البريد الإلكتروني",
    "failed to reset password": "تعذّر إعادة تعيين كلمة المرور",
    "failed to change status": "تعذّر تغيير الحالة",
    "failed to delete user": "تعذّر حذف المستخدم",
    "Password changed. Sign in again with your new password.": "تم تغيير كلمة المرور. سجّل الدخول مرة أخرى بكلمة المرور الجديدة.",
  },
  ja: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "自分が持っていない権限を付与することはできません。",
    "You do not have permission to do that.": "この操作を行う権限がありません。",
    "That username is already in use.": "そのユーザー名は既に使用されています。",
    "The workspace must keep at least one active owner.": "ワークスペースには少なくとも1人のアクティブなオーナーが必要です。",
    "You cannot delete your own account.": "自分のアカウントは削除できません。",
    "This user is in the Trash; restore them first.": "このユーザーはゴミ箱に入っています。先に復元してください。",
    "A user with this username is in the Trash; restore or delete them permanently first.": "同じユーザー名のユーザーがすでにゴミ箱にあります。先に復元するか完全に削除してください。",
    "Please correct the highlighted fields.": "強調表示されている項目を修正してください。",
    People: "アカウント",
    Users: "ユーザー",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "この管理画面にアクセスできる運用担当者アカウントです。ロールやポリシーを割り当てたり、アクセスを無効にしたりできます。",
    "New user": "新規ユーザー",

    Username: "ユーザー名",
    "Email (optional)": "メールアドレス（任意）",
    Password: "パスワード",
    "Create user": "ユーザーを作成",

    Email: "メールアドレス",
    "(none)": "（なし）",
    "Save email": "メールアドレスを保存",
    "Assign role": "ロールを割り当て",
    "Select a role…": "ロールを選択…",
    "(built-in)": "（組み込み）",
    Assign: "割り当て",
    "Attach policy": "ポリシーを付与",
    "Select a policy…": "ポリシーを選択…",
    Attach: "付与",

    "Actions for user": "ユーザーの操作",
    none: "なし",

    "No users yet.": "まだユーザーがいません。",
    "Create your first operator account to get started.": "最初の運用担当者アカウントを作成して開始しましょう。",
    Roles: "ロール",
    Policies: "ポリシー",

    "Disable this user?": "このユーザーを無効にしますか？",
    "They will not be able to sign in until re-enabled.": "再度有効にするまでサインインできなくなります。",
    "Delete this user?": "このユーザーを削除しますか？",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "サインアウトされ、ゴミ箱に移動します。そこから復元できます。60日後に完全に削除されます。",
    "Move to trash": "ゴミ箱に移動",
    Manage: "管理",

    ...translationEntry({ source: "Reset password?", translated: "パスワードをリセットしますか？" }),
    ...translationEntry({ source: "Set a new password for", translated: "新しいパスワードの設定対象：" }),
    "Every active session for this user will be signed out.":
      "このユーザーのすべてのアクティブなセッションがサインアウトされます。",
    "New password": "新しいパスワード",
    ...translationEntry({ source: "Reset password", translated: "パスワードをリセット" }),

    "Loading users…": "ユーザーを読み込み中…",

    "failed to load users": "ユーザーの読み込みに失敗しました",
    "failed to create user": "ユーザーの作成に失敗しました",
    "failed to assign role": "ロールの割り当てに失敗しました",
    "failed to attach policy": "ポリシーの付与に失敗しました",
    "failed to update email": "メールアドレスの更新に失敗しました",
    ...translationEntry({ source: "failed to reset password", translated: "パスワードのリセットに失敗しました" }),
    "failed to change status": "ステータスの変更に失敗しました",
    "failed to delete user": "ユーザーの削除に失敗しました",
    ...translationEntry({ source: "Password changed. Sign in again with your new password.", translated: "パスワードを変更しました。新しいパスワードで再度サインインしてください。" }),
  },
  ko: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "본인이 가지고 있지 않은 권한은 부여할 수 없습니다.",
    "You do not have permission to do that.": "이 작업을 수행할 권한이 없습니다.",
    "That username is already in use.": "해당 사용자 이름은 이미 사용 중입니다.",
    "The workspace must keep at least one active owner.": "워크스페이스에는 활성 소유자가 최소 한 명 있어야 합니다.",
    "You cannot delete your own account.": "자신의 계정은 삭제할 수 없습니다.",
    "This user is in the Trash; restore them first.": "이 사용자는 휴지통에 있습니다. 먼저 복원하세요.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "이 사용자 이름을 가진 사용자가 이미 휴지통에 있습니다. 먼저 복원하거나 영구 삭제하세요.",
    "Please correct the highlighted fields.": "강조 표시된 항목을 수정해 주세요.",
    People: "계정",
    Users: "사용자",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "이 관리자 화면에 접근할 수 있는 운영자 계정입니다 — 역할과 정책을 할당하거나 접근을 비활성화하세요.",
    "New user": "새 사용자",

    Username: "사용자 이름",
    "Email (optional)": "이메일(선택 사항)",
    Password: "비밀번호",
    "Create user": "사용자 생성",

    Email: "이메일",
    "(none)": "(없음)",
    "Save email": "이메일 저장",
    "Assign role": "역할 할당",
    "Select a role…": "역할 선택…",
    "(built-in)": "(내장)",
    Assign: "할당",
    "Attach policy": "정책 연결",
    "Select a policy…": "정책 선택…",
    Attach: "연결",

    "Actions for user": "사용자 작업",
    none: "없음",

    "No users yet.": "아직 사용자가 없습니다.",
    "Create your first operator account to get started.": "시작하려면 첫 운영자 계정을 생성하세요.",
    Roles: "역할",
    Policies: "정책",

    "Disable this user?": "이 사용자를 비활성화하시겠습니까?",
    "They will not be able to sign in until re-enabled.": "다시 활성화될 때까지 로그인할 수 없습니다.",
    "Delete this user?": "이 사용자를 삭제하시겠습니까?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "로그아웃되고 휴지통으로 이동됩니다. 그곳에서 복원할 수 있으며, 60일 후 영구적으로 삭제됩니다.",
    "Move to trash": "휴지통으로 이동",
    Manage: "관리",

    "Reset password?": "비밀번호를 재설정하시겠습니까?",
    "Set a new password for": "새 비밀번호 설정 대상:",
    "Every active session for this user will be signed out.":
      "이 사용자의 모든 활성 세션이 로그아웃됩니다.",
    "New password": "새 비밀번호",
    "Reset password": "비밀번호 재설정",

    "Loading users…": "사용자를 불러오는 중…",

    "failed to load users": "사용자를 불러오지 못했습니다",
    "failed to create user": "사용자를 생성하지 못했습니다",
    "failed to assign role": "역할을 할당하지 못했습니다",
    "failed to attach policy": "정책을 연결하지 못했습니다",
    "failed to update email": "이메일을 업데이트하지 못했습니다",
    "failed to reset password": "비밀번호를 재설정하지 못했습니다",
    "failed to change status": "상태를 변경하지 못했습니다",
    "failed to delete user": "사용자를 삭제하지 못했습니다",
    "Password changed. Sign in again with your new password.": "비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인하세요.",
  },
  pl: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Nie możesz nadać uprawnienia, którego sam nie posiadasz.",
    "You do not have permission to do that.": "Nie masz uprawnień, aby to zrobić.",
    "That username is already in use.": "Ta nazwa użytkownika jest już zajęta.",
    "The workspace must keep at least one active owner.": "Przestrzeń robocza musi mieć co najmniej jednego aktywnego właściciela.",
    "You cannot delete your own account.": "Nie możesz usunąć własnego konta.",
    "This user is in the Trash; restore them first.": "Ten użytkownik znajduje się w Koszu; najpierw go przywróć.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Użytkownik o tej nazwie znajduje się już w Koszu; najpierw go przywróć lub usuń trwale.",
    "Please correct the highlighted fields.": "Popraw zaznaczone pola.",
    People: "Osoby",
    Users: "Użytkownicy",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Konta operatorów z dostępem do tego panelu administracyjnego — przypisuj role i zasady lub wyłączaj dostęp.",
    "New user": "Nowy użytkownik",

    Username: "Nazwa użytkownika",
    "Email (optional)": "E-mail (opcjonalnie)",
    Password: "Hasło",
    "Create user": "Utwórz użytkownika",

    Email: "E-mail",
    "(none)": "(brak)",
    "Save email": "Zapisz e-mail",
    "Assign role": "Przypisz rolę",
    "Select a role…": "Wybierz rolę…",
    "(built-in)": "(wbudowana)",
    Assign: "Przypisz",
    "Attach policy": "Dołącz zasadę",
    "Select a policy…": "Wybierz zasadę…",
    Attach: "Dołącz",

    "Actions for user": "Działania dla użytkownika",
    none: "brak",

    "No users yet.": "Nie ma jeszcze żadnych użytkowników.",
    "Create your first operator account to get started.": "Utwórz swoje pierwsze konto operatora, aby zacząć.",
    Roles: "Role",
    Policies: "Zasady",

    "Disable this user?": "Wyłączyć tego użytkownika?",
    "They will not be able to sign in until re-enabled.": "Nie będzie mógł się zalogować, dopóki konto nie zostanie ponownie włączone.",
    "Delete this user?": "Usunąć tego użytkownika?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Zostanie wylogowany i przeniesiony do Kosza. Możesz go stamtąd przywrócić; zostanie trwale usunięty po 60 dniach.",
    "Move to trash": "Przenieś do Kosza",
    Manage: "Zarządzaj",

    "Reset password?": "Zresetować hasło?",
    "Set a new password for": "Ustaw nowe hasło dla",
    "Every active session for this user will be signed out.":
      "Wszystkie aktywne sesje tego użytkownika zostaną zakończone.",
    "New password": "Nowe hasło",
    "Reset password": "Zresetuj hasło",

    "Loading users…": "Wczytywanie użytkowników…",

    "failed to load users": "nie udało się wczytać użytkowników",
    "failed to create user": "nie udało się utworzyć użytkownika",
    "failed to assign role": "nie udało się przypisać roli",
    "failed to attach policy": "nie udało się dołączyć zasady",
    "failed to update email": "nie udało się zaktualizować adresu e-mail",
    "failed to reset password": "nie udało się zresetować hasła",
    "failed to change status": "nie udało się zmienić statusu",
    "failed to delete user": "nie udało się usunąć użytkownika",
    "Password changed. Sign in again with your new password.": "Hasło zostało zmienione. Zaloguj się ponownie przy użyciu nowego hasła.",
  },
};
