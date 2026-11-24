/**
 * @file Comments screen dictionary slice — the moderation-queue row-menu labels, in every locale. One of the slices the former single
 * host `comments-i18n.ts` was split into by screen area; `create-comments-dictionary.ts` composes them
 * (entries and their why-comments are unchanged, just regrouped).
 */
export const COMMENTS_ROW_MENU_I18N: Record<string, Record<string, string>> = {
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
  },
  id: {
    Approve: "Setujui",
    Spam: "Spam",
    Restore: "Pulihkan",
    Purge: "Hapus permanen",
  },
  de: {
    Approve: "Genehmigen",
    Spam: "Spam",
    Restore: "Wiederherstellen",
    Purge: "Endgültig löschen",
  },
  "zh-CN": {
    Approve: "批准",
    // Native term, not the "Spam" loanword — WordPress and most mainland Chinese moderation UIs
    // render this as 垃圾评论 ("junk comment"), not the bare English word.
    Spam: "垃圾评论",
    Restore: "恢复",
    Purge: "永久删除",
  },
  "zh-TW": {
    Approve: "核准",
    // Same reasoning as zh-CN — Taiwan's own moderation-UI convention is 垃圾留言, not "Spam".
    Spam: "垃圾留言",
    Restore: "還原",
    Purge: "永久刪除",
  },
  "pt-BR": {
    Approve: "Aprovar",
    Spam: "Spam",
    Restore: "Restaurar",
    Purge: "Excluir permanentemente",
  },
  ru: {
    Approve: "Одобрить",
    // Transliterated into Cyrillic ("Спам") rather than left in Latin script — that is how Russian
    // moderation UIs (Gmail included) render this word; the bare Latin "Spam" would read as a typo.
    Spam: "Спам",
    Restore: "Восстановить",
    Purge: "Удалить навсегда",
  },
  fa: {
    Approve: "تأیید",
    // Native term — Persian moderation UIs (Gmail Persian included) use هرزنامه, not a transliterated
    // loanword.
    Spam: "هرزنامه",
    Restore: "بازیابی",
    Purge: "حذف دائمی",
  },
  ar: {
    Approve: "موافقة",
    // Short native adjective rather than the multi-word "بريد إلكتروني مزعج" — reads naturally as a
    // one-word row-menu label alongside Approve/Trash/Restore/Purge.
    Spam: "مزعج",
    Restore: "استعادة",
    Purge: "حذف نهائي",
  },
  ja: {
    Approve: "承認",
    // "迷惑コメント" (nuisance comment) — the term Japanese CMSes use for comment-spam specifically,
    // distinct from 迷惑メール (email spam).
    Spam: "迷惑コメント",
    Restore: "復元",
    Purge: "完全に削除",
  },
  ko: {
    Approve: "승인",
    Spam: "스팸",
    Restore: "복원",
    Purge: "영구 삭제",
  },
  pl: {
    Approve: "Zatwierdź",
    Spam: "Spam",
    Restore: "Przywróć",
    Purge: "Usuń trwale",
  },
  hu: {
    Approve: "Jóváhagyás",
    Spam: "Spam",
    Restore: "Visszaállítás",
    Purge: "Végleges törlés",
  },
  fr: {
    Approve: "Approuver",
    Spam: "Spam",
    Restore: "Restaurer",
    Purge: "Supprimer définitivement",
  },
  uk: {
    Approve: "Схвалити",
    // Transliterated into Cyrillic ("Спам"), same reasoning as ru.
    Spam: "Спам",
    Restore: "Відновити",
    Purge: "Видалити назавжди",
  },
  tr: {
    Approve: "Onayla",
    Spam: "Spam",
    Restore: "Geri yükle",
    Purge: "Kalıcı olarak sil",
  },
  th: {
    Approve: "อนุมัติ",
    // Native term — Gmail's own Thai interface renders its Spam folder as สแปม (transliterated),
    // not the bare Latin word.
    Spam: "สแปม",
    Restore: "กู้คืน",
    Purge: "ลบอย่างถาวร",
  },
  it: {
    Approve: "Approva",
    Spam: "Spam",
    Restore: "Ripristina",
    Purge: "Elimina definitivamente",
  },
  hi: {
    Approve: "स्वीकृत करें",
    // Transliterated into Devanagari ("स्पैम") rather than translated — that is how Hindi
    // moderation UIs (Gmail included) render this word; the bare Latin "Spam" would read as a typo.
    Spam: "स्पैम",
    Restore: "पुनर्स्थापित करें",
    Purge: "स्थायी रूप से हटाएं",
  },
  ur: {
    Approve: "منظور کریں",
    // Transliterated ("سپیم") rather than translated — that is how Urdu moderation UIs (Gmail
    // included) render this word; the bare Latin "Spam" would read as a typo.
    Spam: "سپیم",
    Restore: "بحال کریں",
    Purge: "مستقل طور پر حذف کریں",
  },
  bn: {
    Approve: "অনুমোদন করুন",
    // Transliterated ("স্প্যাম") rather than translated — that is how Bengali moderation UIs
    // (Gmail included) render this word; the bare Latin "Spam" would read as a typo.
    Spam: "স্প্যাম",
    Restore: "পুনরুদ্ধার করুন",
    Purge: "স্থায়ীভাবে মুছুন",
  },
};
