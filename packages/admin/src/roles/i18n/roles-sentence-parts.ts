import { localeEntry } from '@jini-ai/core/text';
/**
 * @file The Roles & Permissions screen's whole-sentence copy: the page description and the three
 * confirm-dialog bodies that wrap a role, policy or permission name. Split from `../roles-i18n.ts`
 * so each file stays under the package's file-size limit; the content is verbatim.
 */

/**
 * The page description's prefix/link-label/suffix around the `<a href="/admin/users">` mid-sentence
 * link — split out from `ES` rather than looked up key-by-key, because Spanish puts "pantalla de"
 * (screen) BEFORE the link text while English puts "screen" after it. Concatenating three
 * independently-translated fragments in a fixed English word order would read backwards in Spanish,
 * so this owns the whole sentence shape per locale instead.
 */
const ROLES_DESCRIPTION_PARTS: Record<string, { prefix: string; linkLabel: string; suffix: string }> = {
  en: {
    prefix: "Roles and policies grant access to operator users. Assign a role or policy to a specific user from the ",
    linkLabel: "Users",
    suffix: " screen.",
  },
  es: {
    prefix:
      "Los roles y las políticas otorgan acceso a los usuarios operadores. Asigna un rol o una política a un usuario específico desde la pantalla de ",
    linkLabel: "Usuarios",
    suffix: ".",
  },
  id: {
    prefix:
      "Peran dan kebijakan memberikan akses kepada pengguna operator. Tetapkan peran atau kebijakan ke pengguna tertentu dari layar ",
    linkLabel: "Pengguna",
    suffix: ".",
  },
  de: {
    prefix:
      "Rollen und Richtlinien gewähren Bedienerkonten Zugriff. Weisen Sie eine Rolle oder Richtlinie einem bestimmten Benutzer über den Bildschirm „",
    linkLabel: "Benutzer",
    suffix: "“ zu.",
  },
  "zh-CN": {
    prefix: "角色和策略授予操作员用户访问权限。可以从",
    linkLabel: "用户",
    suffix: "页面为特定用户分配角色或策略。",
  },
  "zh-TW": {
    prefix: "角色與政策可授予操作員使用者存取權限。您可以從",
    linkLabel: "使用者",
    suffix: "畫面為特定使用者指派角色或政策。",
  },
  "pt-BR": {
    prefix:
      "Funções e políticas concedem acesso aos usuários operadores. Atribua uma função ou política a um usuário específico na tela de ",
    linkLabel: "Usuários",
    suffix: ".",
  },
  ru: {
    prefix:
      "Роли и политики предоставляют доступ операторам. Назначьте роль или политику конкретному пользователю на экране «",
    linkLabel: "Пользователи",
    suffix: "».",
  },
  fa: {
    prefix:
      "نقش‌ها و خط‌مشی‌ها به کاربران اپراتور دسترسی می‌دهند. یک نقش یا خط‌مشی را می‌توانید از صفحه‌ی ",
    linkLabel: "کاربران",
    suffix: " به کاربر خاصی اختصاص دهید.",
  },
  ar: {
    prefix:
      "تمنح الأدوار والسياسات إمكانية الوصول لمستخدمي التشغيل. عيّن دورًا أو سياسة لمستخدم معيّن من شاشة ",
    linkLabel: "المستخدمون",
    suffix: ".",
  },
  ja: {
    prefix:
      "ロールとポリシーは、運用担当ユーザーにアクセス権を付与します。特定のユーザーへのロールまたはポリシーの割り当ては、",
    linkLabel: "ユーザー",
    suffix: "画面から行えます。",
  },
  ko: {
    prefix: "역할과 정책은 운영자 사용자에게 접근 권한을 부여합니다. ",
    linkLabel: "사용자",
    suffix: " 화면에서 특정 사용자에게 역할이나 정책을 할당하세요.",
  },
  pl: {
    prefix:
      "Role i zasady nadają dostęp użytkownikom operatorów. Przypisz rolę lub zasadę konkretnemu użytkownikowi z ekranu ",
    linkLabel: "Użytkownicy",
    suffix: ".",
  },
  hu: {
    prefix:
      "A szerepkörök és szabályzatok hozzáférést biztosítanak az üzemeltetői felhasználóknak. Egy adott felhasználóhoz a ",
    linkLabel: "Felhasználók",
    suffix: " képernyőn rendelhetsz szerepkört vagy szabályzatot.",
  },
  fr: {
    prefix:
      "Les rôles et les politiques accordent l'accès aux utilisateurs opérateurs. Attribuez un rôle ou une politique à un utilisateur spécifique depuis l'écran ",
    linkLabel: "Utilisateurs",
    suffix: ".",
  },
  uk: {
    prefix:
      "Ролі та політики надають доступ користувачам-операторам. Призначте роль або політику конкретному користувачу на екрані «",
    linkLabel: "Користувачі",
    suffix: "».",
  },
  tr: {
    prefix:
      "Roller ve politikalar, operatör kullanıcılara erişim sağlar. Belirli bir kullanıcıya rol veya politika atamak için ",
    linkLabel: "Kullanıcılar",
    suffix: " ekranını kullanın.",
  },
  th: {
    prefix:
      "บทบาทและนโยบายให้สิทธิ์การเข้าถึงแก่ผู้ใช้ที่เป็นผู้ควบคุม คุณสามารถกำหนดบทบาทหรือนโยบายให้กับผู้ใช้รายใดรายหนึ่งได้จากหน้าจอ",
    linkLabel: "ผู้ใช้",
    suffix: "นี้",
  },
  it: {
    prefix:
      "I ruoli e i criteri concedono l'accesso agli utenti operatori. Assegna un ruolo o un criterio a un utente specifico dalla schermata ",
    linkLabel: "Utenti",
    suffix: ".",
  },
  hi: {
    prefix:
      "भूमिकाएँ और नीतियाँ ऑपरेटर उपयोगकर्ताओं को पहुँच प्रदान करती हैं। किसी विशिष्ट उपयोगकर्ता को भूमिका या नीति असाइन करने के लिए ",
    linkLabel: "उपयोगकर्ता",
    suffix: " स्क्रीन का उपयोग करें।",
  },
  ur: {
    prefix:
      "کردار اور پالیسیاں آپریٹر صارفین کو رسائی فراہم کرتی ہیں۔ کسی مخصوص صارف کو کردار یا پالیسی تفویض کرنے کے لیے ",
    linkLabel: "صارفین",
    suffix: " اسکرین استعمال کریں۔",
  },
  bn: {
    prefix:
      "ভূমিকা ও নীতি অপারেটর ব্যবহারকারীদের অ্যাক্সেস প্রদান করে। কোনো নির্দিষ্ট ব্যবহারকারীকে ভূমিকা বা নীতি বরাদ্দ করতে ",
    linkLabel: "ব্যবহারকারী",
    suffix: " স্ক্রিন ব্যবহার করুন।",
  },
};

export function rolesDescriptionParts({ locale }: { locale: string }, _optional: Record<string, never> = {}): { prefix: string; linkLabel: string; suffix: string } {
  return localeEntry({ table: ROLES_DESCRIPTION_PARTS, locale });
}

/** The role-delete confirm body's prefix/suffix around the role's own (untranslated) name — same
 *  "own the whole sentence per locale" reasoning as {@link rolesDescriptionParts}: Spanish's leading
 *  "¿" has no English equivalent to concatenate onto. */
const ROLE_DELETE_BODY_PARTS: Record<string, { prefix: string; suffix: string }> = {
  en: { prefix: 'Delete role "', suffix: '"?' },
  es: { prefix: '¿Eliminar el rol "', suffix: '"?' },
  id: { prefix: 'Hapus peran "', suffix: '"?' },
  de: { prefix: 'Rolle „', suffix: '“ löschen?' },
  "zh-CN": { prefix: '删除角色"', suffix: '"？' },
  "zh-TW": { prefix: '刪除角色「', suffix: '」？' },
  "pt-BR": { prefix: 'Excluir a função "', suffix: '"?' },
  ru: { prefix: 'Удалить роль «', suffix: '»?' },
  fa: { prefix: 'نقش «', suffix: '» حذف شود؟' },
  ar: { prefix: 'حذف الدور "', suffix: '"؟' },
  ja: { prefix: 'ロール「', suffix: '」を削除しますか？' },
  ko: { prefix: '역할 "', suffix: '"을(를) 삭제하시겠습니까?' },
  pl: { prefix: 'Usunąć rolę „', suffix: '”?' },
  hu: { prefix: 'Törlöd a(z) „', suffix: '” szerepkört?' },
  fr: { prefix: 'Supprimer le rôle « ', suffix: ' » ?' },
  uk: { prefix: 'Видалити роль «', suffix: '»?' },
  tr: { prefix: '"', suffix: '" rolü silinsin mi?' },
  th: { prefix: 'ลบบทบาท "', suffix: '" หรือไม่?' },
  it: { prefix: 'Eliminare il ruolo "', suffix: '"?' },
  hi: { prefix: 'भूमिका "', suffix: '" हटाएं?' },
  ur: { prefix: 'کردار "', suffix: '" حذف کریں؟' },
  bn: { prefix: 'ভূমিকা "', suffix: '" মুছবেন?' },
};

export function roleDeleteBodyParts({ locale }: { locale: string }, _optional: Record<string, never> = {}): { prefix: string; suffix: string } {
  return localeEntry({ table: ROLE_DELETE_BODY_PARTS, locale });
}

/** Same as {@link roleDeleteBodyParts}, for the policy-delete confirm body. */
const POLICY_DELETE_BODY_PARTS: Record<string, { prefix: string; suffix: string }> = {
  en: { prefix: 'Delete policy "', suffix: '"?' },
  es: { prefix: '¿Eliminar la política "', suffix: '"?' },
  id: { prefix: 'Hapus kebijakan "', suffix: '"?' },
  de: { prefix: 'Richtlinie „', suffix: '“ löschen?' },
  "zh-CN": { prefix: '删除策略"', suffix: '"？' },
  "zh-TW": { prefix: '刪除政策「', suffix: '」？' },
  "pt-BR": { prefix: 'Excluir a política "', suffix: '"?' },
  ru: { prefix: 'Удалить политику «', suffix: '»?' },
  fa: { prefix: 'خط‌مشی «', suffix: '» حذف شود؟' },
  ar: { prefix: 'حذف السياسة "', suffix: '"؟' },
  ja: { prefix: 'ポリシー「', suffix: '」を削除しますか？' },
  ko: { prefix: '정책 "', suffix: '"을(를) 삭제하시겠습니까?' },
  pl: { prefix: 'Usunąć zasadę „', suffix: '”?' },
  hu: { prefix: 'Törlöd a(z) „', suffix: '” szabályzatot?' },
  fr: { prefix: 'Supprimer la politique « ', suffix: ' » ?' },
  uk: { prefix: 'Видалити політику «', suffix: '»?' },
  tr: { prefix: '"', suffix: '" politikası silinsin mi?' },
  th: { prefix: 'ลบนโยบาย "', suffix: '" หรือไม่?' },
  it: { prefix: 'Eliminare il criterio "', suffix: '"?' },
  hi: { prefix: 'नीति "', suffix: '" हटाएं?' },
  ur: { prefix: 'پالیسی "', suffix: '" حذف کریں؟' },
  bn: { prefix: 'নীতি "', suffix: '" মুছবেন?' },
};

export function policyDeleteBodyParts({ locale }: { locale: string }, _optional: Record<string, never> = {}): { prefix: string; suffix: string } {
  return localeEntry({ table: POLICY_DELETE_BODY_PARTS, locale });
}

/** Same "own the whole sentence per locale" shape as {@link roleDeleteBodyParts}/
 *  {@link policyDeleteBodyParts} (C1) — the permission string sits between the quotes, and the
 *  sentence continues past the closing quote to name the consequence ("Anyone with this policy
 *  loses it."), which a fixed English word order concatenated onto a translated prefix would not
 *  reliably place for every locale. */
const PERMISSION_REMOVE_BODY_PARTS: Record<string, { prefix: string; suffix: string }> = {
  en: { prefix: 'Remove "', suffix: '" from this policy? Anyone with this policy loses it.' },
  es: { prefix: '¿Quitar el permiso "', suffix: '" de esta política? Cualquiera que tenga esta política lo perderá.' },
  id: { prefix: 'Hapus izin "', suffix: '" dari kebijakan ini? Semua orang yang memiliki kebijakan ini akan kehilangannya.' },
  de: { prefix: 'Die Berechtigung „', suffix: '“ aus dieser Richtlinie entfernen? Jeder, der diese Richtlinie hat, verliert sie.' },
  "zh-CN": { prefix: '从此策略中移除权限"', suffix: '"？拥有此策略的所有人都会失去该权限。' },
  "zh-TW": { prefix: '從此政策中移除權限「', suffix: '」？擁有此政策的所有人都會失去該權限。' },
  "pt-BR": { prefix: 'Remover a permissão "', suffix: '" desta política? Todos que têm essa política a perderão.' },
  ru: { prefix: 'Удалить разрешение «', suffix: '» из этой политики? Все, у кого есть эта политика, потеряют его.' },
  fa: { prefix: 'مجوز «', suffix: '» از این خط‌مشی حذف شود؟ هرکسی که این خط‌مشی را دارد آن را از دست می‌دهد.' },
  ar: { prefix: 'إزالة الإذن "', suffix: '" من هذه السياسة؟ سيفقده كل من يملك هذه السياسة.' },
  ja: { prefix: 'このポリシーから権限「', suffix: '」を削除しますか？このポリシーを持つすべてのユーザーがこの権限を失います。' },
  ko: { prefix: '이 정책에서 "', suffix: '" 권한을 제거하시겠습니까? 이 정책을 가진 모든 사용자가 이 권한을 잃습니다.' },
  pl: { prefix: 'Usunąć uprawnienie „', suffix: '” z tej zasady? Każdy, kto ma tę zasadę, je straci.' },
  hu: { prefix: 'Eltávolítod a(z) „', suffix: '” jogosultságot ebből a szabályzatból? Mindenki elveszíti, akinek ez a szabályzata van.' },
  fr: { prefix: "Retirer l'autorisation « ", suffix: ' » de cette politique ? Toute personne disposant de cette politique la perdra.' },
  uk: { prefix: 'Вилучити дозвіл «', suffix: '» із цієї політики? Усі, хто має цю політику, втратять його.' },
  tr: { prefix: '"', suffix: '" izni bu politikadan kaldırılsın mı? Bu politikaya sahip herkes bu izni kaybeder.' },
  th: { prefix: 'นำสิทธิ์ "', suffix: '" ออกจากนโยบายนี้หรือไม่? ทุกคนที่มีนโยบายนี้จะสูญเสียสิทธิ์นี้' },
  it: { prefix: "Rimuovere l'autorizzazione \"", suffix: '" da questo criterio? Chiunque abbia questo criterio la perderà.' },
  hi: { prefix: 'इस नीति से अनुमति "', suffix: '" हटाएं? इस नीति वाला हर व्यक्ति इसे खो देगा।' },
  ur: { prefix: 'اس پالیسی سے اجازت "', suffix: '" ہٹائیں؟ اس پالیسی کا حامل ہر شخص اسے کھو دے گا۔' },
  bn: { prefix: 'এই নীতি থেকে "', suffix: '" অনুমতি সরাবেন? এই নীতি থাকা প্রত্যেকে এটি হারাবে।' },
};

export function permissionRemoveBodyParts({ locale }: { locale: string }, _optional: Record<string, never> = {}): { prefix: string; suffix: string } {
  return localeEntry({ table: PERMISSION_REMOVE_BODY_PARTS, locale });
}
