import { translationEntry } from "../../shell/lib/translation-entry.js";
/**
 * @file Users screen dictionary, locales es…pt-BR — one of four part files `../users-i18n.ts`
 * merges into `USERS_TRANSLATIONS`. Split per locale group only so each file stays under the
 * package's file-size limit; the content is the original dictionary's, verbatim.
 */
export const USERS_TRANSLATIONS_A: Record<string, Record<string, string>> = {
  es: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "No puedes otorgar un permiso que no posees.",
    "You do not have permission to do that.": "No tienes permiso para hacer eso.",
    "That username is already in use.": "Ese nombre de usuario ya está en uso.",
    "The workspace must keep at least one active owner.": "El espacio de trabajo debe conservar al menos un propietario activo.",
  "You cannot delete your own account.": "No puedes eliminar tu propia cuenta.",
  "This user is in the Trash; restore them first.": "Este usuario está en la Papelera; restáuralo primero.",
  "A user with this username is in the Trash; restore or delete them permanently first.": "Ya hay un usuario con ese nombre en la Papelera; restáuralo o elimínalo permanentemente primero.",
    "Please correct the highlighted fields.": "Corrige los campos resaltados.",
  People: "Personas",
  Users: "Usuarios",
  "Operator accounts with access to this admin — assign roles and policies, or disable access.":
    "Cuentas de operador con acceso a este panel de administración: asigna roles y políticas, o desactiva el acceso.",
  "New user": "Nuevo usuario",

  Username: "Nombre de usuario",
  "Email (optional)": "Correo electrónico (opcional)",
  ...translationEntry({ source: "Password", translated: "Contraseña" }),
  "Create user": "Crear usuario",

  Email: "Correo electrónico",
  "(none)": "(ninguno)",
  "Save email": "Guardar correo",
  "Assign role": "Asignar rol",
  "Select a role…": "Selecciona un rol…",
  "(built-in)": "(integrado)",
  Assign: "Asignar",
  "Attach policy": "Adjuntar política",
  "Select a policy…": "Selecciona una política…",
  Attach: "Adjuntar",

  "Actions for user": "Acciones para el usuario",
  none: "ninguno",

  "No users yet.": "Aún no hay usuarios.",
  "Create your first operator account to get started.": "Crea tu primera cuenta de operador para comenzar.",
  Roles: "Roles",
  Policies: "Políticas",

  "Disable this user?": "¿Desactivar este usuario?",
  "They will not be able to sign in until re-enabled.": "No podrán iniciar sesión hasta que se reactive su cuenta.",
  "Delete this user?": "¿Eliminar este usuario?",
  "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Se cerrará su sesión y se moverá a la Papelera. Puedes restaurarlo desde allí; se elimina permanentemente después de 60 días.",
  "Move to trash": "Mover a la papelera",
  // rules.ts's userRowMenuItems row-menu labels — outside the original `.tsx`-only pass's scope.
  Manage: "Administrar",

  "Reset password?": "¿Restablecer contraseña?",
  "Set a new password for": "Establece una nueva contraseña para",
  "Every active session for this user will be signed out.":
    "Se cerrará toda sesión activa de este usuario.",
  "New password": "Nueva contraseña",
  "Reset password": "Restablecer contraseña",

  "Loading users…": "Cargando usuarios…",

  // Hook-level notice/error strings (use-users.hooks.ts) — these never got translated during the
  // JSX-only pass since they live in `.hooks.ts` files.
  "failed to load users": "no se pudieron cargar los usuarios",
  "failed to create user": "no se pudo crear el usuario",
  "failed to assign role": "no se pudo asignar el rol",
  "failed to attach policy": "no se pudo adjuntar la política",
  "failed to update email": "no se pudo actualizar el correo electrónico",
  "failed to reset password": "no se pudo restablecer la contraseña",
  "failed to change status": "no se pudo cambiar el estado",
  "failed to delete user": "no se pudo eliminar el usuario",
    "Password changed. Sign in again with your new password.": "Contraseña cambiada. Inicia sesión de nuevo con tu nueva contraseña.",
  },
  id: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Anda tidak dapat memberikan izin yang tidak Anda miliki.",
    "You do not have permission to do that.": "Anda tidak memiliki izin untuk melakukan itu.",
    "That username is already in use.": "Nama pengguna itu sudah digunakan.",
    "The workspace must keep at least one active owner.": "Ruang kerja harus mempertahankan setidaknya satu pemilik aktif.",
    "You cannot delete your own account.": "Anda tidak dapat menghapus akun Anda sendiri.",
    "This user is in the Trash; restore them first.": "Pengguna ini ada di Sampah; pulihkan terlebih dahulu.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Sudah ada pengguna dengan nama ini di Sampah; pulihkan atau hapus permanen terlebih dahulu.",
    "Please correct the highlighted fields.": "Perbaiki kolom yang ditandai.",
    People: "Orang",
    Users: "Pengguna",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Akun operator dengan akses ke panel admin ini — tetapkan peran dan kebijakan, atau nonaktifkan akses.",
    "New user": "Pengguna baru",

    Username: "Nama pengguna",
    "Email (optional)": "Email (opsional)",
    Password: "Kata sandi",
    "Create user": "Buat pengguna",

    Email: "Email",
    "(none)": "(tidak ada)",
    "Save email": "Simpan email",
    "Assign role": "Tetapkan peran",
    "Select a role…": "Pilih peran…",
    "(built-in)": "(bawaan)",
    Assign: "Tetapkan",
    "Attach policy": "Lampirkan kebijakan",
    "Select a policy…": "Pilih kebijakan…",
    Attach: "Lampirkan",

    "Actions for user": "Tindakan untuk pengguna",
    none: "tidak ada",

    "No users yet.": "Belum ada pengguna.",
    "Create your first operator account to get started.": "Buat akun operator pertama Anda untuk memulai.",
    Roles: "Peran",
    Policies: "Kebijakan",

    "Disable this user?": "Nonaktifkan pengguna ini?",
    "They will not be able to sign in until re-enabled.": "Mereka tidak akan bisa masuk sampai diaktifkan kembali.",
    "Delete this user?": "Hapus pengguna ini?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Pengguna ini akan keluar dan dipindahkan ke Sampah. Anda dapat memulihkannya dari sana; akan dihapus permanen setelah 60 hari.",
    "Move to trash": "Pindahkan ke Sampah",
    Manage: "Kelola",

    "Reset password?": "Atur ulang kata sandi?",
    "Set a new password for": "Tetapkan kata sandi baru untuk",
    "Every active session for this user will be signed out.":
      "Setiap sesi aktif pengguna ini akan dikeluarkan.",
    "New password": "Kata sandi baru",
    "Reset password": "Atur ulang kata sandi",

    "Loading users…": "Memuat pengguna…",

    "failed to load users": "gagal memuat pengguna",
    "failed to create user": "gagal membuat pengguna",
    "failed to assign role": "gagal menetapkan peran",
    "failed to attach policy": "gagal melampirkan kebijakan",
    "failed to update email": "gagal memperbarui email",
    "failed to reset password": "gagal mengatur ulang kata sandi",
    "failed to change status": "gagal mengubah status",
    "failed to delete user": "gagal menghapus pengguna",
    "Password changed. Sign in again with your new password.": "Kata sandi telah diubah. Masuk lagi dengan kata sandi baru Anda.",
  },
  de: {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Sie können keine Berechtigung erteilen, die Sie selbst nicht besitzen.",
    "You do not have permission to do that.": "Sie haben keine Berechtigung dafür.",
    "That username is already in use.": "Dieser Benutzername wird bereits verwendet.",
    "The workspace must keep at least one active owner.": "Der Arbeitsbereich muss mindestens einen aktiven Inhaber behalten.",
    "You cannot delete your own account.": "Sie können Ihr eigenes Konto nicht löschen.",
    "This user is in the Trash; restore them first.": "Dieser Benutzer befindet sich im Papierkorb; stellen Sie ihn zuerst wieder her.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Ein Benutzer mit diesem Namen befindet sich bereits im Papierkorb; stellen Sie ihn wieder her oder löschen Sie ihn zuerst endgültig.",
    "Please correct the highlighted fields.": "Bitte korrigieren Sie die markierten Felder.",
    People: "Personen",
    Users: "Benutzer",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Bedienerkonten mit Zugriff auf dieses Admin-Panel — Rollen und Richtlinien zuweisen oder den Zugriff deaktivieren.",
    "New user": "Neuer Benutzer",

    Username: "Benutzername",
    "Email (optional)": "E-Mail (optional)",
    Password: "Passwort",
    "Create user": "Benutzer erstellen",

    Email: "E-Mail",
    "(none)": "(keine)",
    "Save email": "E-Mail speichern",
    "Assign role": "Rolle zuweisen",
    "Select a role…": "Rolle auswählen…",
    "(built-in)": "(integriert)",
    Assign: "Zuweisen",
    "Attach policy": "Richtlinie anhängen",
    "Select a policy…": "Richtlinie auswählen…",
    Attach: "Anhängen",

    "Actions for user": "Aktionen für Benutzer",
    none: "keine",

    "No users yet.": "Noch keine Benutzer.",
    "Create your first operator account to get started.": "Erstellen Sie Ihr erstes Bedienerkonto, um loszulegen.",
    Roles: "Rollen",
    Policies: "Richtlinien",

    "Disable this user?": "Diesen Benutzer deaktivieren?",
    "They will not be able to sign in until re-enabled.": "Er kann sich erst wieder anmelden, wenn das Konto reaktiviert wird.",
    "Delete this user?": "Diesen Benutzer löschen?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Er wird abgemeldet und in den Papierkorb verschoben. Sie können ihn von dort wiederherstellen; nach 60 Tagen wird er endgültig gelöscht.",
    "Move to trash": "In den Papierkorb verschieben",
    Manage: "Verwalten",

    "Reset password?": "Passwort zurücksetzen?",
    "Set a new password for": "Neues Passwort festlegen für",
    "Every active session for this user will be signed out.":
      "Alle aktiven Sitzungen dieses Benutzers werden abgemeldet.",
    "New password": "Neues Passwort",
    "Reset password": "Passwort zurücksetzen",

    "Loading users…": "Benutzer werden geladen…",

    "failed to load users": "Benutzer konnten nicht geladen werden",
    "failed to create user": "Benutzer konnte nicht erstellt werden",
    "failed to assign role": "Rolle konnte nicht zugewiesen werden",
    "failed to attach policy": "Richtlinie konnte nicht angehängt werden",
    "failed to update email": "E-Mail konnte nicht aktualisiert werden",
    "failed to reset password": "Passwort konnte nicht zurückgesetzt werden",
    "failed to change status": "Status konnte nicht geändert werden",
    "failed to delete user": "Benutzer konnte nicht gelöscht werden",
    "Password changed. Sign in again with your new password.": "Passwort geändert. Melden Sie sich erneut mit Ihrem neuen Passwort an.",
  },
  "zh-CN": {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "您不能授予您自己都不具备的权限。",
    "You do not have permission to do that.": "您没有执行此操作的权限。",
    "That username is already in use.": "该用户名已被使用。",
    "The workspace must keep at least one active owner.": "工作区必须保留至少一位活跃所有者。",
    "You cannot delete your own account.": "您不能删除自己的账户。",
    "This user is in the Trash; restore them first.": "该用户在回收站中；请先恢复。",
    "A user with this username is in the Trash; restore or delete them permanently first.": "已有同名用户在回收站中；请先恢复或永久删除。",
    "Please correct the highlighted fields.": "请更正高亮显示的字段。",
    People: "人员",
    Users: "用户",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "拥有此管理后台访问权限的操作员账户 — 分配角色和策略，或禁用访问权限。",
    "New user": "新建用户",

    Username: "用户名",
    "Email (optional)": "电子邮箱（可选）",
    Password: "密码",
    "Create user": "创建用户",

    Email: "电子邮箱",
    "(none)": "（无）",
    "Save email": "保存邮箱",
    "Assign role": "分配角色",
    "Select a role…": "选择角色…",
    "(built-in)": "（内置）",
    Assign: "分配",
    "Attach policy": "附加策略",
    "Select a policy…": "选择策略…",
    Attach: "附加",

    "Actions for user": "用户操作",
    none: "无",

    "No users yet.": "暂无用户。",
    "Create your first operator account to get started.": "创建您的第一个操作员账户以开始使用。",
    Roles: "角色",
    Policies: "策略",

    "Disable this user?": "禁用此用户？",
    "They will not be able to sign in until re-enabled.": "在重新启用之前，该用户将无法登录。",
    "Delete this user?": "删除此用户？",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "该用户将被登出并移至回收站。您可以从那里恢复；60 天后将被永久删除。",
    "Move to trash": "移至回收站",
    Manage: "管理",

    "Reset password?": "重置密码？",
    ...translationEntry({ source: "Set a new password for", translated: "为以下用户设置新密码：" }),
    "Every active session for this user will be signed out.":
      "该用户的所有活动会话都将被登出。",
    "New password": "新密码",
    "Reset password": "重置密码",

    "Loading users…": "正在加载用户…",

    "failed to load users": "加载用户失败",
    "failed to create user": "创建用户失败",
    "failed to assign role": "分配角色失败",
    "failed to attach policy": "附加策略失败",
    "failed to update email": "更新邮箱失败",
    "failed to reset password": "重置密码失败",
    "failed to change status": "更改状态失败",
    "failed to delete user": "删除用户失败",
    ...translationEntry({ source: "Password changed. Sign in again with your new password.", translated: "密码已更改。请使用新密码重新登录。" }),
  },
  "zh-TW": {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "您不能授予您自己都不具備的權限。",
    "You do not have permission to do that.": "您沒有執行此操作的權限。",
    "That username is already in use.": "該使用者名稱已被使用。",
    "The workspace must keep at least one active owner.": "工作區必須保留至少一位活躍擁有者。",
    "You cannot delete your own account.": "您不能刪除自己的帳戶。",
    "This user is in the Trash; restore them first.": "該使用者在垃圾桶中；請先還原。",
    "A user with this username is in the Trash; restore or delete them permanently first.": "已有相同名稱的使用者在垃圾桶中；請先還原或永久刪除。",
    "Please correct the highlighted fields.": "請更正醒目提示的欄位。",
    People: "人員",
    Users: "使用者",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "擁有此管理後台存取權限的操作員帳戶 — 指派角色與政策，或停用存取權限。",
    "New user": "新增使用者",

    Username: "使用者名稱",
    "Email (optional)": "電子郵件（選填）",
    Password: "密碼",
    "Create user": "建立使用者",

    Email: "電子郵件",
    "(none)": "（無）",
    "Save email": "儲存電子郵件",
    "Assign role": "指派角色",
    "Select a role…": "選擇角色…",
    "(built-in)": "（內建）",
    Assign: "指派",
    "Attach policy": "附加政策",
    "Select a policy…": "選擇政策…",
    Attach: "附加",

    "Actions for user": "使用者操作",
    none: "無",

    "No users yet.": "尚無使用者。",
    "Create your first operator account to get started.": "建立您的第一個操作員帳戶以開始使用。",
    Roles: "角色",
    Policies: "政策",

    "Disable this user?": "停用此使用者？",
    "They will not be able to sign in until re-enabled.": "在重新啟用之前，該使用者將無法登入。",
    "Delete this user?": "刪除此使用者？",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "該使用者將被登出並移至垃圾桶。您可以從那裡還原；60 天後將被永久刪除。",
    "Move to trash": "移至垃圾桶",
    Manage: "管理",

    "Reset password?": "重設密碼？",
    ...translationEntry({ source: "Set a new password for", translated: "為以下使用者設定新密碼：" }),
    "Every active session for this user will be signed out.":
      "該使用者的所有現行工作階段都將被登出。",
    "New password": "新密碼",
    "Reset password": "重設密碼",

    "Loading users…": "正在載入使用者…",

    "failed to load users": "載入使用者失敗",
    "failed to create user": "建立使用者失敗",
    "failed to assign role": "指派角色失敗",
    "failed to attach policy": "附加政策失敗",
    "failed to update email": "更新電子郵件失敗",
    "failed to reset password": "重設密碼失敗",
    "failed to change status": "變更狀態失敗",
    "failed to delete user": "刪除使用者失敗",
    ...translationEntry({ source: "Password changed. Sign in again with your new password.", translated: "密碼已變更。請使用新密碼重新登入。" }),
  },
  "pt-BR": {
    // rules.ts's describeApiError overrides (C4) — untranslated until this pass.
    "You cannot grant a permission you do not hold.": "Você não pode conceder uma permissão que você mesmo não possui.",
    "You do not have permission to do that.": "Você não tem permissão para fazer isso.",
    "That username is already in use.": "Esse nome de usuário já está em uso.",
    "The workspace must keep at least one active owner.": "O workspace deve manter pelo menos um proprietário ativo.",
    "You cannot delete your own account.": "Você não pode excluir sua própria conta.",
    "This user is in the Trash; restore them first.": "Este usuário está na Lixeira; restaure-o primeiro.",
    "A user with this username is in the Trash; restore or delete them permanently first.": "Já existe um usuário com este nome de usuário na Lixeira; restaure-o ou exclua-o permanentemente primeiro.",
    "Please correct the highlighted fields.": "Corrija os campos destacados.",
    People: "Pessoas",
    Users: "Usuários",
    "Operator accounts with access to this admin — assign roles and policies, or disable access.":
      "Contas de operador com acesso a este painel de administração — atribua funções e políticas, ou desative o acesso.",
    "New user": "Novo usuário",

    Username: "Nome de usuário",
    "Email (optional)": "E-mail (opcional)",
    Password: "Senha",
    "Create user": "Criar usuário",

    Email: "E-mail",
    "(none)": "(nenhum)",
    "Save email": "Salvar e-mail",
    "Assign role": "Atribuir função",
    "Select a role…": "Selecione uma função…",
    "(built-in)": "(integrada)",
    Assign: "Atribuir",
    "Attach policy": "Anexar política",
    "Select a policy…": "Selecione uma política…",
    Attach: "Anexar",

    "Actions for user": "Ações para o usuário",
    none: "nenhum",

    "No users yet.": "Ainda não há usuários.",
    "Create your first operator account to get started.": "Crie sua primeira conta de operador para começar.",
    Roles: "Funções",
    Policies: "Políticas",

    "Disable this user?": "Desativar este usuário?",
    "They will not be able to sign in until re-enabled.": "Ele não poderá entrar até que a conta seja reativada.",
    "Delete this user?": "Excluir este usuário?",
    "They will be signed out and moved to the Trash. You can restore them there; they are deleted permanently after 60 days.": "Ele será desconectado e movido para a Lixeira. Você pode restaurá-lo de lá; é excluído permanentemente após 60 dias.",
    "Move to trash": "Mover para a Lixeira",
    Manage: "Gerenciar",

    "Reset password?": "Redefinir senha?",
    "Set a new password for": "Definir uma nova senha para",
    "Every active session for this user will be signed out.":
      "Todas as sessões ativas deste usuário serão encerradas.",
    "New password": "Nova senha",
    "Reset password": "Redefinir senha",

    "Loading users…": "Carregando usuários…",

    "failed to load users": "não foi possível carregar os usuários",
    "failed to create user": "não foi possível criar o usuário",
    "failed to assign role": "não foi possível atribuir a função",
    "failed to attach policy": "não foi possível anexar a política",
    "failed to update email": "não foi possível atualizar o e-mail",
    "failed to reset password": "não foi possível redefinir a senha",
    "failed to change status": "não foi possível alterar o status",
    "failed to delete user": "não foi possível excluir o usuário",
    "Password changed. Sign in again with your new password.": "Senha alterada. Entre novamente com sua nova senha.",
  },
};
