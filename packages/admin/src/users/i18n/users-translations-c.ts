import { translationEntry } from "../../shell/lib/translation-entry.js";
/**
 * @file Users screen dictionary, locales hu…it — one of four part files `../users-i18n.ts`
 * merges into `USERS_TRANSLATIONS`. Split per locale group only so each file stays under the
 * package's file-size limit; the content is the original dictionary's, verbatim.
 */
export const USERS_TRANSLATIONS_C: Record<string, Record<string, string>> = {
  hu: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Nem adhat olyan jogosultságot, amellyel Ön maga nem rendelkezik.",
    "You do not have permission to do that.": "Nincs jogosultsága ehhez a művelethez.",
    "That username is already in use.": "Ez a felhasználónév már foglalt.",
    "The workspace must keep at least one active owner.": "A munkaterületnek legalább egy aktív tulajdonossal kell rendelkeznie.",
    "You cannot delete your own account.": "A saját fiókodat nem törölheted.",
    "This user is in the Trash; restore them first.": "Ez a felhasználó a Kukában van; előbb állítsd vissza.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Már van egy ilyen nevű felhasználó a Kukában; előbb állítsd vissza, vagy töröld véglegesen.",
    "Please correct the highlighted fields.": "Javítsa a kiemelt mezőket.",
    People: "Személyek",
    Users: "Felhasználók",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Az adminfelülethez hozzáféréssel rendelkező üzemeltetői fiókok — rendelj hozzájuk szerepkört és szabályzatot, vagy tiltsd le a hozzáférésüket.",
    "New user": "Új felhasználó",

    Username: "Felhasználónév",
    "Email (optional)": "E-mail (nem kötelező)",
    Password: "Jelszó",
    "Create user": "Felhasználó létrehozása",

    Email: "E-mail",
    "(none)": "(nincs)",
    "Save email": "E-mail mentése",
    "Assign role": "Szerepkör hozzárendelése",
    "Select a role…": "Válassz szerepkört…",
    "(built-in)": "(beépített)",
    Assign: "Hozzárendelés",
    "Attach policy": "Szabályzat csatolása",
    "Select a policy…": "Válassz szabályzatot…",
    Attach: "Csatolás",

    "Actions for user": "Műveletek a felhasználóval",
    none: "nincs",

    "No users yet.": "Még nincs felhasználó.",
    "Create your first operator account to get started.": "Hozd létre az első üzemeltetői fiókodat a kezdéshez.",
    Roles: "Szerepkörök",
    Policies: "Szabályzatok",

    "Disable this user?": "Letiltod ezt a felhasználót?",
    "They will not be able to sign in until re-enabled.": "Nem tud majd bejelentkezni, amíg újra nem engedélyezed.",
    "Delete this user?": "Törlöd ezt a felhasználót?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Kijelentkezik, és a Kukába kerül. Onnan visszaállítható; 60 nap után véglegesen törlődik.",
    "Move to trash": "Áthelyezés a Kukába",
    Manage: "Kezelés",

    "Reset password?": "Visszaállítod a jelszót?",
    "Set a new password for": "Új jelszó beállítása ehhez:",
    "Every active session for this user will be signed out.":
      "A felhasználó minden aktív munkamenete kijelentkezik.",
    "New password": "Új jelszó",
    "Reset password": "Jelszó visszaállítása",

    "Loading users…": "Felhasználók betöltése…",

    "failed to load users": "a felhasználók betöltése sikertelen",
    "failed to create user": "a felhasználó létrehozása sikertelen",
    "failed to assign role": "a szerepkör hozzárendelése sikertelen",
    "failed to attach policy": "a szabályzat csatolása sikertelen",
    "failed to update email": "az e-mail cím frissítése sikertelen",
    "failed to reset password": "a jelszó visszaállítása sikertelen",
    "failed to change status": "az állapot módosítása sikertelen",
    "failed to delete user": "a felhasználó törlése sikertelen",
    "Password changed. Sign in again with your new password.": "A jelszó megváltozott. Jelentkezzen be újra az új jelszavával.",
  },
  fr: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Vous ne pouvez pas accorder une permission que vous ne possédez pas vous-même.",
    "You do not have permission to do that.": "Vous n'avez pas la permission de faire cela.",
    "That username is already in use.": "Ce nom d'utilisateur est déjà utilisé.",
    "The workspace must keep at least one active owner.": "L'espace de travail doit conserver au moins un propriétaire actif.",
    "You cannot delete your own account.": "Vous ne pouvez pas supprimer votre propre compte.",
    "This user is in the Trash; restore them first.": "Cet utilisateur est dans la Corbeille ; restaurez-le d'abord.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Un utilisateur portant ce nom se trouve déjà dans la Corbeille ; restaurez-le ou supprimez-le définitivement d'abord.",
    "Please correct the highlighted fields.": "Veuillez corriger les champs mis en évidence.",
    People: "Personnes",
    Users: "Utilisateurs",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Comptes d'opérateurs ayant accès à cette administration — attribuez des rôles et des politiques, ou désactivez l'accès.",
    "New user": "Nouvel utilisateur",

    Username: "Nom d'utilisateur",
    "Email (optional)": "E-mail (facultatif)",
    Password: "Mot de passe",
    "Create user": "Créer un utilisateur",

    Email: "E-mail",
    "(none)": "(aucun)",
    "Save email": "Enregistrer l'e-mail",
    "Assign role": "Attribuer un rôle",
    "Select a role…": "Sélectionnez un rôle…",
    "(built-in)": "(intégré)",
    Assign: "Attribuer",
    "Attach policy": "Associer une politique",
    "Select a policy…": "Sélectionnez une politique…",
    Attach: "Associer",

    "Actions for user": "Actions pour l'utilisateur",
    none: "aucun",

    "No users yet.": "Aucun utilisateur pour le moment.",
    "Create your first operator account to get started.": "Créez votre premier compte d'opérateur pour commencer.",
    Roles: "Rôles",
    Policies: "Politiques",

    "Disable this user?": "Désactiver cet utilisateur ?",
    "They will not be able to sign in until re-enabled.": "Il ne pourra pas se connecter tant que le compte ne sera pas réactivé.",
    "Delete this user?": "Supprimer cet utilisateur ?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Il sera déconnecté et déplacé vers la Corbeille. Vous pouvez le restaurer depuis là ; il est supprimé définitivement après 60 jours.",
    "Move to trash": "Déplacer vers la Corbeille",
    Manage: "Gérer",

    "Reset password?": "Réinitialiser le mot de passe ?",
    "Set a new password for": "Définir un nouveau mot de passe pour",
    "Every active session for this user will be signed out.":
      "Toutes les sessions actives de cet utilisateur seront déconnectées.",
    "New password": "Nouveau mot de passe",
    "Reset password": "Réinitialiser le mot de passe",

    "Loading users…": "Chargement des utilisateurs…",

    "failed to load users": "échec du chargement des utilisateurs",
    "failed to create user": "échec de la création de l'utilisateur",
    "failed to assign role": "échec de l'attribution du rôle",
    "failed to attach policy": "échec de l'association de la politique",
    "failed to update email": "échec de la mise à jour de l'e-mail",
    "failed to reset password": "échec de la réinitialisation du mot de passe",
    "failed to change status": "échec de la modification du statut",
    "failed to delete user": "échec de la suppression de l'utilisateur",
    "Password changed. Sign in again with your new password.": "Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.",
  },
  uk: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Ви не можете надати право, якого немає у вас самих.",
    "You do not have permission to do that.": "У вас немає прав для цієї дії.",
    "That username is already in use.": "Це ім'я користувача вже використовується.",
    "The workspace must keep at least one active owner.": "У робочій області має залишитися принаймні один активний власник.",
    "You cannot delete your own account.": "Ви не можете видалити власний обліковий запис.",
    "This user is in the Trash; restore them first.": "Цей користувач перебуває в Кошику; спочатку відновіть його.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Користувач із цим іменем вже перебуває в Кошику; спочатку відновіть або видаліть його остаточно.",
    "Please correct the highlighted fields.": "Виправте виділені поля.",
    People: "Люди",
    Users: "Користувачі",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Облікові записи операторів із доступом до цієї панелі адміністрування — призначайте ролі й політики або вимикайте доступ.",
    "New user": "Новий користувач",

    Username: "Ім'я користувача",
    "Email (optional)": "Ел. пошта (необов'язково)",
    Password: "Пароль",
    "Create user": "Створити користувача",

    Email: "Ел. пошта",
    "(none)": "(немає)",
    "Save email": "Зберегти ел. пошту",
    "Assign role": "Призначити роль",
    "Select a role…": "Виберіть роль…",
    "(built-in)": "(вбудована)",
    Assign: "Призначити",
    "Attach policy": "Прикріпити політику",
    "Select a policy…": "Виберіть політику…",
    Attach: "Прикріпити",

    "Actions for user": "Дії для користувача",
    none: "немає",

    "No users yet.": "Користувачів поки немає.",
    "Create your first operator account to get started.": "Створіть свій перший обліковий запис оператора, щоб почати.",
    Roles: "Ролі",
    Policies: "Політики",

    "Disable this user?": "Вимкнути цього користувача?",
    "They will not be able to sign in until re-enabled.": "Він не зможе увійти, доки обліковий запис не буде знову увімкнено.",
    "Delete this user?": "Видалити цього користувача?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Його буде вилучено із сеансу та переміщено до Кошика. Ви можете відновити його звідти; він остаточно видаляється через 60 днів.",
    "Move to trash": "Перемістити до Кошика",
    Manage: "Керувати",

    "Reset password?": "Скинути пароль?",
    "Set a new password for": "Встановити новий пароль для",
    "Every active session for this user will be signed out.":
      "Усі активні сеанси цього користувача буде завершено.",
    "New password": "Новий пароль",
    "Reset password": "Скинути пароль",

    "Loading users…": "Завантаження користувачів…",

    "failed to load users": "не вдалося завантажити користувачів",
    "failed to create user": "не вдалося створити користувача",
    "failed to assign role": "не вдалося призначити роль",
    "failed to attach policy": "не вдалося прикріпити політику",
    "failed to update email": "не вдалося оновити ел. пошту",
    "failed to reset password": "не вдалося скинути пароль",
    "failed to change status": "не вдалося змінити статус",
    "failed to delete user": "не вдалося видалити користувача",
    "Password changed. Sign in again with your new password.": "Пароль змінено. Увійдіть знову з новим паролем.",
  },
  tr: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Kendinizde bulunmayan bir izni veremezsiniz.",
    "You do not have permission to do that.": "Bunu yapmak için izniniz yok.",
    "That username is already in use.": "Bu kullanıcı adı zaten kullanımda.",
    "The workspace must keep at least one active owner.": "Çalışma alanının en az bir aktif sahibi olmalıdır.",
    "You cannot delete your own account.": "Kendi hesabınızı silemezsiniz.",
    "This user is in the Trash; restore them first.": "Bu kullanıcı Çöp Kutusu'nda; önce geri yükleyin.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Bu kullanıcı adına sahip bir kullanıcı zaten Çöp Kutusu'nda; önce geri yükleyin veya kalıcı olarak silin.",
    "Please correct the highlighted fields.": "Lütfen vurgulanan alanları düzeltin.",
    People: "Kişiler",
    Users: "Kullanıcılar",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Bu yönetim paneline erişimi olan operatör hesapları — rol ve politika atayın veya erişimi devre dışı bırakın.",
    "New user": "Yeni kullanıcı",

    Username: "Kullanıcı adı",
    "Email (optional)": "E-posta (isteğe bağlı)",
    Password: "Parola",
    "Create user": "Kullanıcı oluştur",

    Email: "E-posta",
    "(none)": "(yok)",
    "Save email": "E-postayı kaydet",
    "Assign role": "Rol ata",
    "Select a role…": "Bir rol seçin…",
    "(built-in)": "(yerleşik)",
    Assign: "Ata",
    "Attach policy": "Politika ekle",
    "Select a policy…": "Bir politika seçin…",
    Attach: "Ekle",

    "Actions for user": "Kullanıcı için işlemler",
    none: "yok",

    "No users yet.": "Henüz kullanıcı yok.",
    "Create your first operator account to get started.": "Başlamak için ilk operatör hesabınızı oluşturun.",
    Roles: "Roller",
    Policies: "Politikalar",

    "Disable this user?": "Bu kullanıcı devre dışı bırakılsın mı?",
    "They will not be able to sign in until re-enabled.": "Yeniden etkinleştirilene kadar oturum açamayacak.",
    "Delete this user?": "Bu kullanıcı silinsin mi?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Oturumu kapatılıp Çöp Kutusu'na taşınacak. Oradan geri yükleyebilirsiniz; 60 gün sonra kalıcı olarak silinir.",
    "Move to trash": "Çöp Kutusu'na taşı",
    Manage: "Yönet",

    "Reset password?": "Parola sıfırlansın mı?",
    "Set a new password for": "Şunun için yeni bir parola belirle:",
    "Every active session for this user will be signed out.":
      "Bu kullanıcının tüm etkin oturumları kapatılacak.",
    "New password": "Yeni parola",
    "Reset password": "Parolayı sıfırla",

    "Loading users…": "Kullanıcılar yükleniyor…",

    "failed to load users": "kullanıcılar yüklenemedi",
    "failed to create user": "kullanıcı oluşturulamadı",
    "failed to assign role": "rol atanamadı",
    "failed to attach policy": "politika eklenemedi",
    "failed to update email": "e-posta güncellenemedi",
    "failed to reset password": "parola sıfırlanamadı",
    "failed to change status": "durum değiştirilemedi",
    "failed to delete user": "kullanıcı silinemedi",
    "Password changed. Sign in again with your new password.": "Parola değiştirildi. Yeni parolanızla tekrar oturum açın.",
  },
  th: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "คุณไม่สามารถให้สิทธิ์ที่คุณเองไม่มีได้",
    "You do not have permission to do that.": "คุณไม่มีสิทธิ์ทำสิ่งนี้",
    "That username is already in use.": "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว",
    "The workspace must keep at least one active owner.": "พื้นที่ทำงานต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อยหนึ่งคน",
    "You cannot delete your own account.": "คุณไม่สามารถลบบัญชีของคุณเองได้",
    "This user is in the Trash; restore them first.": "ผู้ใช้รายนี้อยู่ในถังขยะ โปรดกู้คืนก่อน",
    "A user with this username is in the Trash; restore or delete them permanently first.": "มีผู้ใช้ที่ใช้ชื่อผู้ใช้นี้อยู่ในถังขยะแล้ว โปรดกู้คืนหรือลบถาวรก่อน",
    "Please correct the highlighted fields.": "โปรดแก้ไขช่องที่ไฮไลต์",
    People: "บุคคล",
    Users: "ผู้ใช้",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "บัญชีผู้ควบคุมที่มีสิทธิ์เข้าถึงแผงผู้ดูแลระบบนี้ — กำหนดบทบาทและนโยบาย หรือปิดใช้งานการเข้าถึง",
    "New user": "ผู้ใช้ใหม่",

    Username: "ชื่อผู้ใช้",
    "Email (optional)": "อีเมล (ไม่บังคับ)",
    Password: "รหัสผ่าน",
    "Create user": "สร้างผู้ใช้",

    Email: "อีเมล",
    "(none)": "(ไม่มี)",
    "Save email": "บันทึกอีเมล",
    "Assign role": "กำหนดบทบาท",
    "Select a role…": "เลือกบทบาท…",
    "(built-in)": "(ในตัว)",
    Assign: "กำหนด",
    "Attach policy": "แนบนโยบาย",
    "Select a policy…": "เลือกนโยบาย…",
    Attach: "แนบ",

    "Actions for user": "การดำเนินการสำหรับผู้ใช้",
    none: "ไม่มี",

    "No users yet.": "ยังไม่มีผู้ใช้",
    "Create your first operator account to get started.": "สร้างบัญชีผู้ควบคุมแรกของคุณเพื่อเริ่มต้นใช้งาน",
    Roles: "บทบาท",
    Policies: "นโยบาย",

    "Disable this user?": "ปิดใช้งานผู้ใช้รายนี้หรือไม่?",
    "They will not be able to sign in until re-enabled.": "จะไม่สามารถลงชื่อเข้าใช้ได้จนกว่าจะเปิดใช้งานอีกครั้ง",
    "Delete this user?": "ลบผู้ใช้รายนี้หรือไม่?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "ผู้ใช้จะถูกลงชื่อออกและย้ายไปที่ถังขยะ คุณสามารถกู้คืนได้จากที่นั่น และจะถูกลบถาวรหลังจาก 60 วัน",
    "Move to trash": "ย้ายไปที่ถังขยะ",
    Manage: "จัดการ",

    ...translationEntry({ source: "Reset password?", translated: "รีเซ็ตรหัสผ่านหรือไม่?" }),
    ...translationEntry({ source: "Set a new password for", translated: "ตั้งรหัสผ่านใหม่สำหรับ" }),
    "Every active session for this user will be signed out.":
      "ทุกเซสชันที่ใช้งานอยู่ของผู้ใช้รายนี้จะถูกออกจากระบบ",
    ...translationEntry({ source: "New password", translated: "รหัสผ่านใหม่" }),
    ...translationEntry({ source: "Reset password", translated: "รีเซ็ตรหัสผ่าน" }),

    "Loading users…": "กำลังโหลดผู้ใช้…",

    "failed to load users": "โหลดผู้ใช้ไม่สำเร็จ",
    "failed to create user": "สร้างผู้ใช้ไม่สำเร็จ",
    "failed to assign role": "กำหนดบทบาทไม่สำเร็จ",
    "failed to attach policy": "แนบนโยบายไม่สำเร็จ",
    "failed to update email": "อัปเดตอีเมลไม่สำเร็จ",
    ...translationEntry({ source: "failed to reset password", translated: "รีเซ็ตรหัสผ่านไม่สำเร็จ" }),
    "failed to change status": "เปลี่ยนสถานะไม่สำเร็จ",
    "failed to delete user": "ลบผู้ใช้ไม่สำเร็จ",
    "Password changed. Sign in again with your new password.": "เปลี่ยนรหัสผ่านแล้ว โปรดลงชื่อเข้าใช้อีกครั้งด้วยรหัสผ่านใหม่ของคุณ",
  },
  it: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Non puoi concedere un permesso che tu stesso non possiedi.",
    "You do not have permission to do that.": "Non hai il permesso di farlo.",
    "That username is already in use.": "Questo nome utente è già in uso.",
    "The workspace must keep at least one active owner.": "L'area di lavoro deve mantenere almeno un proprietario attivo.",
    "You cannot delete your own account.": "Non puoi eliminare il tuo stesso account.",
    "This user is in the Trash; restore them first.": "Questo utente è nel Cestino; ripristinalo prima.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Un utente con questo nome utente è già nel Cestino; ripristinalo o eliminalo definitivamente prima.",
    "Please correct the highlighted fields.": "Correggi i campi evidenziati.",
    People: "Persone",
    Users: "Utenti",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Account operatore con accesso a questo pannello di amministrazione — assegna ruoli e criteri, oppure disabilita l'accesso.",
    "New user": "Nuovo utente",

    Username: "Nome utente",
    "Email (optional)": "Email (facoltativa)",
    Password: "Password",
    "Create user": "Crea utente",

    Email: "Email",
    "(none)": "(nessuna)",
    "Save email": "Salva email",
    "Assign role": "Assegna ruolo",
    "Select a role…": "Seleziona un ruolo…",
    "(built-in)": "(integrato)",
    Assign: "Assegna",
    "Attach policy": "Collega criterio",
    "Select a policy…": "Seleziona un criterio…",
    Attach: "Collega",

    "Actions for user": "Azioni per l'utente",
    none: "nessuna",

    "No users yet.": "Ancora nessun utente.",
    "Create your first operator account to get started.": "Crea il tuo primo account operatore per iniziare.",
    Roles: "Ruoli",
    Policies: "Criteri",

    "Disable this user?": "Disabilitare questo utente?",
    "They will not be able to sign in until re-enabled.": "Non potrà accedere finché l'account non verrà riattivato.",
    "Delete this user?": "Eliminare questo utente?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Verrà disconnesso e spostato nel Cestino. Puoi ripristinarlo da lì; viene eliminato definitivamente dopo 60 giorni.",
    "Move to trash": "Sposta nel Cestino",
    Manage: "Gestisci",

    "Reset password?": "Reimpostare la password?",
    "Set a new password for": "Imposta una nuova password per",
    "Every active session for this user will be signed out.":
      "Tutte le sessioni attive di questo utente verranno disconnesse.",
    "New password": "Nuova password",
    "Reset password": "Reimposta password",

    "Loading users…": "Caricamento utenti…",

    "failed to load users": "impossibile caricare gli utenti",
    "failed to create user": "impossibile creare l'utente",
    "failed to assign role": "impossibile assegnare il ruolo",
    "failed to attach policy": "impossibile collegare il criterio",
    "failed to update email": "impossibile aggiornare l'email",
    "failed to reset password": "impossibile reimpostare la password",
    "failed to change status": "impossibile modificare lo stato",
    "failed to delete user": "impossibile eliminare l'utente",
    "Password changed. Sign in again with your new password.": "Password modificata. Accedi di nuovo con la tua nuova password.",
  },
};
