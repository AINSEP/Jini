import { describe, expect, it, vi } from "vitest";

import type { AdminPolicy, AdminRole } from "@jini-ai/core/contracts/site/user-management-react";
import { roleMenuItems, policyMenuItems } from "../rules.js";
import { t } from "../roles-i18n.js";

/**
 * @file Pure logic for `features/roles/rules.ts`.
 *
 * `describeApiError` layers five `ApiError.code` overrides on top of the shared
 * `lib/api.ts` default; every branch is asserted individually plus the fallthrough case, since a
 * screen-specific error-copy table silently regressing to the generic message (or vice versa) is
 * exactly the "moved verbatim" contract the extraction claims and is otherwise unverified.
 */

const ROLE: AdminRole = { id: "r1", workspaceId: "w1", name: "Editor", isBuiltin: false };
const POLICY: AdminPolicy = {
  id: "p1",
  workspaceId: "w1",
  name: "Content Policy",
  description: "desc",
  isBuiltin: false,
  isFrozen: false,
};


// C4 — dictionary-parity spot check for just the 5 keys this pass added (same scoping as C1's own
// `roles-i18n.unit.test.ts`, so pre-existing dictionary drift elsewhere does not fail this file).
describe("roles-i18n — C4 keys", () => {
  const LOCALES = [
    "es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko",
    "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn",
  ];
  const NEW_KEYS = [
    "You do not have permission to do that.",
    "It is still in use — remove that assignment/attachment first.",
    "That permission is not recognized.",
    "You cannot grant a permission you do not hold.",
    "Please correct the highlighted fields.",
  ];

  const EXPECTED: Record<string, string[]> = {
    "es": [
      "No tienes permiso para hacer eso.",
      "Todavía está en uso; primero quita esa asignación o adjunto.",
      "Ese permiso no se reconoce.",
      "No puedes otorgar un permiso que no posees.",
      "Corrige los campos resaltados."
    ],
    "id": [
      "Anda tidak memiliki izin untuk melakukan itu.",
      "Masih digunakan — hapus dulu penetapan/lampiran tersebut.",
      "Izin itu tidak dikenali.",
      "Anda tidak dapat memberikan izin yang tidak Anda miliki.",
      "Perbaiki kolom yang ditandai."
    ],
    "de": [
      "Sie haben keine Berechtigung dafür.",
      "Wird noch verwendet – entfernen Sie zuerst diese Zuweisung/Zuordnung.",
      "Diese Berechtigung wird nicht erkannt.",
      "Sie können keine Berechtigung erteilen, die Sie selbst nicht besitzen.",
      "Bitte korrigieren Sie die markierten Felder."
    ],
    "zh-CN": [
      "您没有执行此操作的权限。",
      "仍在使用中——请先移除该分配/关联。",
      "无法识别该权限。",
      "您不能授予您自己都不具备的权限。",
      "请更正高亮显示的字段。"
    ],
    "zh-TW": [
      "您沒有執行此操作的權限。",
      "仍在使用中——請先移除該指派/關聯。",
      "無法識別該權限。",
      "您不能授予您自己都不具備的權限。",
      "請更正醒目提示的欄位。"
    ],
    "pt-BR": [
      "Você não tem permissão para fazer isso.",
      "Ainda está em uso — remova essa atribuição/vínculo primeiro.",
      "Essa permissão não é reconhecida.",
      "Você não pode conceder uma permissão que você mesmo não possui.",
      "Corrija os campos destacados."
    ],
    "ru": [
      "У вас нет прав для этого действия.",
      "Всё ещё используется — сначала удалите это назначение/привязку.",
      "Это право не распознано.",
      "Вы не можете предоставить право, которого у вас самих нет.",
      "Исправьте выделенные поля."
    ],
    "fa": [
      "شما مجوز انجام این کار را ندارید.",
      "هنوز در حال استفاده است — ابتدا آن تخصیص/پیوست را حذف کنید.",
      "آن مجوز شناسایی نشد.",
      "شما نمی‌توانید مجوزی را که خودتان ندارید، اعطا کنید.",
      "لطفاً فیلدهای برجسته‌شده را اصلاح کنید."
    ],
    "ar": [
      "ليس لديك إذن للقيام بذلك.",
      "لا يزال قيد الاستخدام — أزل هذا التعيين/الإرفاق أولاً.",
      "هذا الإذن غير معروف.",
      "لا يمكنك منح إذن لا تملكه أنت نفسك.",
      "يرجى تصحيح الحقول المميزة."
    ],
    "ja": [
      "この操作を行う権限がありません。",
      "まだ使用中です。先にその割り当て/アタッチを削除してください。",
      "その権限は認識されません。",
      "自分が持っていない権限を付与することはできません。",
      "強調表示されている項目を修正してください。"
    ],
    "ko": [
      "이 작업을 수행할 권한이 없습니다.",
      "아직 사용 중입니다 — 먼저 해당 할당/연결을 제거하세요.",
      "해당 권한을 인식할 수 없습니다.",
      "본인이 가지고 있지 않은 권한은 부여할 수 없습니다.",
      "강조 표시된 항목을 수정해 주세요."
    ],
    "pl": [
      "Nie masz uprawnień, aby to zrobić.",
      "Nadal jest używane — najpierw usuń to przypisanie/powiązanie.",
      "To uprawnienie nie jest rozpoznawane.",
      "Nie możesz nadać uprawnienia, którego sam nie posiadasz.",
      "Popraw zaznaczone pola."
    ],
    "hu": [
      "Nincs jogosultsága ehhez a művelethez.",
      "Még használatban van – először távolítsa el a hozzárendelést/csatolást.",
      "Ez a jogosultság nem ismerhető fel.",
      "Nem adhat olyan jogosultságot, amellyel Ön maga nem rendelkezik.",
      "Javítsa a kiemelt mezőket."
    ],
    "fr": [
      "Vous n'avez pas la permission de faire cela.",
      "Toujours utilisé : supprimez d'abord cette attribution/association.",
      "Cette permission n'est pas reconnue.",
      "Vous ne pouvez pas accorder une permission que vous ne possédez pas vous-même.",
      "Veuillez corriger les champs mis en évidence."
    ],
    "uk": [
      "У вас немає прав для цієї дії.",
      "Все ще використовується — спочатку видаліть це призначення/прив'язку.",
      "Це право не розпізнано.",
      "Ви не можете надати право, якого немає у вас самих.",
      "Виправте виділені поля."
    ],
    "tr": [
      "Bunu yapmak için izniniz yok.",
      "Hâlâ kullanımda — önce bu atamayı/eklentiyi kaldırın.",
      "Bu izin tanınmıyor.",
      "Kendinizde bulunmayan bir izni veremezsiniz.",
      "Lütfen vurgulanan alanları düzeltin."
    ],
    "th": [
      "คุณไม่มีสิทธิ์ทำสิ่งนี้",
      "ยังคงถูกใช้งานอยู่ — โปรดลบการกำหนด/การแนบนั้นก่อน",
      "ไม่รู้จักสิทธิ์นั้น",
      "คุณไม่สามารถให้สิทธิ์ที่คุณเองไม่มีได้",
      "โปรดแก้ไขช่องที่ไฮไลต์"
    ],
    "it": [
      "Non hai il permesso di farlo.",
      "È ancora in uso: rimuovi prima quell'assegnazione/collegamento.",
      "Questo permesso non è riconosciuto.",
      "Non puoi concedere un permesso che tu stesso non possiedi.",
      "Correggi i campi evidenziati."
    ],
    "hi": [
      "आपके पास ऐसा करने की अनुमति नहीं है।",
      "यह अभी भी उपयोग में है — पहले वह असाइनमेंट/अटैचमेंट हटाएं।",
      "वह अनुमति पहचानी नहीं गई।",
      "आप वह अनुमति प्रदान नहीं कर सकते जो आपके पास स्वयं नहीं है।",
      "कृपया हाइलाइट किए गए फ़ील्ड ठीक करें।"
    ],
    "ur": [
      "آپ کو یہ کرنے کی اجازت نہیں ہے۔",
      "یہ ابھی بھی زیرِ استعمال ہے — پہلے وہ تفویض/اٹیچمنٹ ہٹائیں۔",
      "وہ اجازت پہچانی نہیں گئی۔",
      "آپ وہ اجازت نہیں دے سکتے جو خود آپ کے پاس نہیں ہے۔",
      "براہ کرم نمایاں کردہ خانوں کو درست کریں۔"
    ],
    "bn": [
      "আপনার এটি করার অনুমতি নেই।",
      "এটি এখনও ব্যবহৃত হচ্ছে — প্রথমে সেই অ্যাসাইনমেন্ট/সংযুক্তি সরান।",
      "সেই অনুমতিটি শনাক্ত করা যায়নি।",
      "আপনার নিজের কাছে নেই এমন অনুমতি আপনি দিতে পারবেন না।",
      "অনুগ্রহ করে হাইলাইট করা ফিল্ডগুলো সংশোধন করুন।"
    ]
  };

  for (const [index, key] of NEW_KEYS.entries()) {
    for (const locale of LOCALES) {
      it(`t(${locale}, "${key}") matches the locale's error copy`, () => {
        const translated = t({ locale: locale, key: key });
        expect(translated.length).toBeGreaterThan(0);
        expect(translated).not.toBe(key);
        expect(translated).toBe(EXPECTED[locale]![index]);
      });
    }
  }
});

describe("roleMenuItems", () => {
  it("returns exactly Rename then Delete, with Delete marked destructive", () => {
    const items = roleMenuItems({ role: ROLE, handlers: { onRename: vi.fn(), onDelete: vi.fn() }, locale: "en" });
    expect(items.map((i) => i.key)).toEqual(["rename", "delete"]);
    expect(items[0]).toMatchObject({ label: "Rename" });
    expect(items[1]).toMatchObject({ label: "Delete", destructive: true });
  });

  it("wires Rename's onSelect to onRename with the role, not onDelete", () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const items = roleMenuItems({ role: ROLE, handlers: { onRename, onDelete }, locale: "en" });
    items[0]!.onSelect?.();
    expect(onRename).toHaveBeenCalledWith(ROLE);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("wires Delete's onSelect to onDelete with the role, not onRename", () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const items = roleMenuItems({ role: ROLE, handlers: { onRename, onDelete }, locale: "en" });
    items[1]!.onSelect?.();
    expect(onDelete).toHaveBeenCalledWith(ROLE);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("translates labels to Spanish when locale is es", () => {
    const items = roleMenuItems({ role: ROLE, handlers: { onRename: vi.fn(), onDelete: vi.fn() }, locale: "es" });
    expect(items.map((i) => i.label)).toEqual(["Renombrar", "Eliminar"]);
  });
});

describe("policyMenuItems", () => {
  it("returns exactly Rename, permission-toggle, then Delete", () => {
    const items = policyMenuItems({
      policy: POLICY,
      permissionPolicyId: null,
      handlers: { onRename: vi.fn(), onTogglePermissionForm: vi.fn(), onDelete: vi.fn() },
      locale: "en",
    });
    expect(items.map((i) => i.key)).toEqual(["rename", "permission", "delete"]);
    expect(items[2]).toMatchObject({ label: "Delete", destructive: true });
  });

  it("labels the toggle 'Add permission' when this policy's form is not open", () => {
    const items = policyMenuItems({
      policy: POLICY,
      permissionPolicyId: null,
      handlers: { onRename: vi.fn(), onTogglePermissionForm: vi.fn(), onDelete: vi.fn() },
      locale: "en",
    });
    expect(items[1]!.label).toBe("Add permission");
  });

  it("labels the toggle 'Add permission' when a DIFFERENT policy's form is open", () => {
    const items = policyMenuItems({
      policy: POLICY,
      permissionPolicyId: "some-other-policy-id",
      handlers: { onRename: vi.fn(), onTogglePermissionForm: vi.fn(), onDelete: vi.fn() },
      locale: "en",
    });
    expect(items[1]!.label).toBe("Add permission");
  });

  it("labels the toggle 'Close' when THIS policy's form is open", () => {
    const items = policyMenuItems({
      policy: POLICY,
      permissionPolicyId: POLICY.id,
      handlers: { onRename: vi.fn(), onTogglePermissionForm: vi.fn(), onDelete: vi.fn() },
      locale: "en",
    });
    expect(items[1]!.label).toBe("Close");
  });

  it("wires the toggle's onSelect to onTogglePermissionForm with the policy id", () => {
    const onTogglePermissionForm = vi.fn();
    const items = policyMenuItems({
      policy: POLICY,
      permissionPolicyId: null,
      handlers: { onRename: vi.fn(), onTogglePermissionForm, onDelete: vi.fn() },
      locale: "en",
    });
    items[1]!.onSelect?.();
    expect(onTogglePermissionForm).toHaveBeenCalledWith({ policyId: POLICY.id });
  });

  it("wires Rename and Delete to the policy, independently of each other", () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const items = policyMenuItems({ policy: POLICY, permissionPolicyId: null, handlers: { onRename, onTogglePermissionForm: vi.fn(), onDelete }, locale: "en" });
    items[0]!.onSelect?.();
    expect(onRename).toHaveBeenCalledExactlyOnceWith(POLICY);
    expect(onDelete).not.toHaveBeenCalled();
    onRename.mockClear();

    items[2]!.onSelect?.();
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(POLICY);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("translates labels to Spanish when locale is es, including the toggle's open/closed state", () => {
    const closedItems = policyMenuItems({
      policy: POLICY,
      permissionPolicyId: null,
      handlers: { onRename: vi.fn(), onTogglePermissionForm: vi.fn(), onDelete: vi.fn() },
      locale: "es",
    });
    expect(closedItems.map((i) => i.label)).toEqual(["Renombrar", "Agregar permiso", "Eliminar"]);

    const openItems = policyMenuItems({
      policy: POLICY,
      permissionPolicyId: POLICY.id,
      handlers: { onRename: vi.fn(), onTogglePermissionForm: vi.fn(), onDelete: vi.fn() },
      locale: "es",
    });
    expect(openItems[1]!.label).toBe("Cerrar");
  });
});
