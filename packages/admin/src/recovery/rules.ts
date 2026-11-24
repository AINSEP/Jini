import type { AdminDegradedBanner, AdminRestorePoint, DatabaseContextEnvelope } from "../core/index.js";
import { t } from "./recovery-i18n.js";

import { interpolate, localeEntry, formatTimestamp } from '@jini-ai/core/text';
/**
 * @file Pure logic for the `recovery` feature — everything that computes a value rather than
 * rendering one. Follows the convention `features/posts/rules.ts` establishes: no React, no
 * hooks, importable and directly testable.
 */

/** This screen's name on `lib/content-refresh-bus.ts` — see `taxonomy/rules.ts`'s
 *  `TAXONOMY_RESOURCE` for why this is a plain colocated constant rather than a shared registry.
 *  `use-recovery.hooks.ts`'s own `points` reads the SAME restore-points table the former Database hook listed, through a separate read endpoint
 *  (`listRecoveryRestorePoints`) — so it goes stale for the identical reason and the identical
 *  write tool: `backup_create_restore_point` (the host's database agent tools;
 *  Recovery's OWN catalog entry of that same name is deliberately left unwired — see that file's
 *  header). `backup_execute_restore` (the host's recovery agent tools, wired,
 *  token-gated) also mutates durable state but a full restore leaves nothing on this screen worth
 *  refreshing afterward, so it needs no separate justification here.
 */
export const RECOVERY_RESOURCE = "recovery";

const CATEGORY_LABELS: Record<string, string> = {
  posts_pages: "posts/pages writes",
  plugin_table: "plugin-table rows",
};

const UNTAUGHT_CATEGORY_TEMPLATE: Record<string, string> = {
  en: "{category} writes",
  es: "escrituras de {category}",
  id: "penulisan {category}",
  de: "{category}-Schreibvorgänge",
  "zh-CN": "{category} 写入",
  "zh-TW": "{category} 寫入",
  "pt-BR": "gravações de {category}",
  ru: "записи {category}",
  fa: "نوشتن {category}",
  ar: "عمليات كتابة {category}",
  ja: "{category}の書き込み",
  ko: "{category} 쓰기",
  pl: "zapisy {category}",
  hu: "{category} írások",
  fr: "écritures {category}",
  uk: "записи {category}",
  tr: "{category} yazmaları",
  th: "การเขียน {category}",
  it: "scritture {category}",
};

/** Human label for one discarded-write-window category (design-spec.md §4.3). Falls back to
 *  `"<category> writes"` for a category the server sends that this table has not been taught yet,
 *  so a new category degrades to readable-but-generic copy instead of `undefined`.
 *
 * Translated via `recovery-i18n.ts`'s `t()`, same two-step fallback as every other translated
 * string in this app: the untaught-category fallback template is translated as a whole (word order
 * differs between "<category> writes" and Spanish "escrituras de <category>"), not word-by-word. */
export function categoryLabel({ category, locale }: { category: string; locale: string }, _options: Record<string, never> = {}): string {
  const known = CATEGORY_LABELS[category];
  if (known) return t({ locale: locale, key: known });
  return interpolate({ template: localeEntry({ table: UNTAUGHT_CATEGORY_TEMPLATE, locale }), vars: { category } });
}

/** Short, human badge text for a `restorePoint.costClass`/`status.costClass` value. Never rendered
 *  as the raw `"cheap"`/`"expensive"`/`"unavailable"` enum value itself — that leaked straight into
 *  the "Restore capability:" status bar as-is before this fix, meaningless to an operator who does
 *  not know the API's own vocabulary. Falls back to the raw value for anything this table hasn't
 *  been taught, same defensive shape as {@link categoryLabel}, since `AdminRestorePoint.costClass`
 *  is typed as plain `string` (not the `RestorePointCostClass` union `AdminRecoveryStatus.costClass`
 *  gets), so a server sending an unrecognised value must not throw here. */
const COST_CLASS_LABELS: Record<string, string> = {
  cheap: "Fast restore",
  expensive: "Costly restore",
  unavailable: "Restore unavailable",
};

export function costClassLabel({ costClass, locale }: { costClass: string; locale: string }, _options: Record<string, never> = {}): string {
  const known = COST_CLASS_LABELS[costClass];
  return known ? t({ locale: locale, key: known }) : costClass;
}

/** Visual severity for a Recovery degraded banner — `.notice.error` vs `.notice.warning`, both
 *  already in `styles.css` (no new CSS). Mirrors `Database.tsx`'s `resolveSchemaStateWarning`
 *  `tone` field, the identical precedent for "not every degraded state is an error."
 *
 * `migration-interrupted`/`pending-migration` block normal Recovery/Database use until an operator
 * resolves them, and `cost-unavailable` means this site has no restore mechanism at all — all three
 * stay `error`. `operation-in-flight` is a transient, self-resolving wait (nothing is broken, a
 * restore/migrate is already running), and `watermark-baseline-unavailable` only narrows the
 * discarded-write disclosure to `"unknown"` counts — restoring itself still works — so operation-in-flight is `warning` and the standing disclosure limitation is neutral. Independent of {@link isAssertiveRecoveryBanner}: one axis is
 * "how urgently should this interrupt," the other is "how bad is this," and the two don't move
 * together (`cost-unavailable` is `error` but not assertive).
 *
 * @complexity Time/space: O(1) — one membership check.
 */
export function recoveryBannerTone(banner: AdminDegradedBanner): "error" | "warning" | "" {
  // D-33: unknown discard counts are a standing limitation, not an incident on a fresh site.
  // Keep the disclosure visible; the actual restore ceremony still requires acknowledgement.
  if (banner.kind === "watermark-baseline-unavailable") return "";
  return banner.kind === "operation-in-flight" ? "warning" : "error";
}

/**
 * Whether a Recovery degraded banner needs `role="alert"`/`aria-live="assertive"` rather than the
 * default polite announcement.
 *
 * AC-27/EC-06/INV-07: `pending-migration`'s action always deep-links to Database's own migration
 * ceremony, never a Recovery restore action — restoring to an older snapshot does not resolve
 * schema drift against the current runtime. Both this kind and `migration-interrupted` are urgent
 * enough that the operator should not have to notice them on their own.
 *
 * @complexity Time/space: O(1) — two fixed comparisons.
 */
export function isAssertiveRecoveryBanner(banner: AdminDegradedBanner): boolean {
  return banner.kind === "migration-interrupted" || banner.kind === "pending-migration";
}

/** Discriminated parse result for {@link parseDeepLinkEnvelope} — `ok: false` carries no reason
 *  because the caller's only response to either failure mode is the same silent no-op. */
export type DeepLinkEnvelopeParseResult = { ok: true; envelope: DatabaseContextEnvelope } | { ok: false };

/**
 * Client-side shape check for a deep-link envelope pulled out of `sessionStorage` — valid JSON,
 * nothing deeper. `resolveRecoveryDeepLink` (the server) always re-verifies `restorePointId`
 * itself (ADR-041 §7/ADR-045 §5, INV-04); this only decides whether the envelope is even worth
 * sending. `ok: false` on anything unparseable — a `JSON.parse` throw only, deliberately NOT a
 * truthiness check on the parsed value, so a literal `"null"`/`"0"`/`"false"` payload (valid JSON,
 * falsy value) is still forwarded rather than silently swallowed here, matching the original
 * `try { envelope = JSON.parse(raw) } catch { return }` guard exactly. The caller treats `ok:
 * false` as "no deep link", same as no envelope having been stashed at all — a
 * malformed/forged/stale value is an expected, non-exceptional case, not an error toast.
 *
 * @complexity Time/space: O(1) beyond `JSON.parse`'s own cost in input length.
 */
export function parseDeepLinkEnvelope({ raw }: { raw: string }, _options: Record<string, never> = {}): DeepLinkEnvelopeParseResult {
  try {
    return { ok: true, envelope: JSON.parse(raw) as DatabaseContextEnvelope };
  } catch {
    return { ok: false };
  }
}

/**
 * Distinct accessible name for one restore point's "Restore…" button.
 *
 * Every row's button carries the identical visible text (`t(locale, "Restore…")`), which is fine
 * for a sighted operator reading the row it sits in but reads as one ambiguous "Restore…" control
 * to anything that resolves elements by role+name rather than DOM position — an
 * accessibility-tree-driven agent (`getByRole("button", { name: "Restore…" })` matches every row at
 * once), or a screen-reader user who jumps button-to-button outside table-navigation mode. Restore
 * is also this screen's single most consequential action (SPEC-019 C-303: "this cannot be undone"),
 * so picking the wrong row's button is the worst possible place for that ambiguity to live.
 *
 * Appends the row's own timestamp — already the column's own visible, effectively-unique
 * identifier — AFTER the visible label rather than replacing it, so the accessible name still
 * starts with the exact visible text (WCAG 2.5.3 Label in Name: a speech-control user saying
 * "click Restore" should still land on it).
 *
 * @complexity O(1).
 */
export function restoreButtonAccessibleName({ locale, point, viewerTimeZone }: { locale: string; point: Pick<AdminRestorePoint, "createdAt">; viewerTimeZone: string }, _options: Record<string, never> = {}): string {
  return `${t({ locale: locale, key: "Restore…" })} ${formatTimestamp({ iso: point.createdAt }, { viewerTimeZone })}`;
}
