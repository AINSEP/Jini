import { useCallback, useEffect, useState } from "react";
import type { RetentionPassResult, RetentionPolicyKind, RetentionPolicyOutcome } from "@jini-ai/platform/retention";
import type { StoragePanel } from "../StoragePanel.js";

import type { StorageClient, StoragePass, StorageReport } from "../api/storage-api.js";

/** What Jini's `StoragePanel` asks its required `useStorage` hook for. */
export type StorageView = ReturnType<Parameters<typeof StoragePanel>[0]["useStorage"]>;
/** A domain screen the owner manages a category from; `categories` names the report categories it owns. */
export interface StorageLink { label: string; href: string; categories?: readonly string[] }
type Phase = StorageView["phase"];

const PANEL_CLASS = { automatic: "automatic", yours: "yours", "report-only": "shown" } as const;
const UNITS = [["gigabyte", 1024 ** 3], ["megabyte", 1024 ** 2], ["kilobyte", 1024], ["byte", 1]] as const;

/** Localised size; `null` is "could not tell", never zero. */
export function formatBytes({ bytes, locale, t }: { bytes: number | null; locale: string; t: Parameters<typeof useWiredStorage>[0]["t"] }, _optional: Record<string, never> = {}): string {
  if (bytes === null) return t({ locale, key: "Size unknown" });
  const [unit, size] = UNITS.find(([, step]) => bytes >= step) ?? UNITS[3];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: 1 }).format(bytes / size);
}

function toClasses({ report, locale, links, t, categoryLabels }: { report: StorageReport | undefined; locale: string; links: readonly StorageLink[]; t: Parameters<typeof useWiredStorage>[0]["t"]; categoryLabels: Readonly<Record<string, string>> }): StorageView["classes"] {
  const classes: { [K in keyof StorageView["classes"]]: { id: string; label: string; bytes: string }[] } = { automatic: [], yours: [], shown: [] };
  for (const [id, amount] of Object.entries(report?.categories ?? {})) {
    if (amount.files === 0 && amount.bytes === 0) continue;
    const where = links.find(link => link.categories?.includes(id));
    const label = t({ locale, key: categoryLabels[id] ?? "Other" });
    classes[PANEL_CLASS[amount.class]].push({ id, label: where === undefined ? label : `${label} (${where.label})`, bytes: formatBytes({ bytes: amount.bytes, locale, t }) });
  }
  return classes;
}

function toOutcome({ policy, locale, t }: { policy: RetentionPolicyOutcome; locale: string; t: Parameters<typeof useWiredStorage>[0]["t"] }): string {
  if (policy.status === "measured") return `${t({ locale, key: "would free" })} ${formatBytes({ bytes: policy.measurement.bytes, locale, t })}`;
  if (policy.status === "swept") return `${t({ locale, key: "Freed" })} ${formatBytes({ bytes: policy.result.freedBytes, locale, t })}`;
  return `${t({ locale, key: "Could not clean" })}: ${policy.message}`;
}

function policiesOf(pass: RetentionPassResult | undefined): readonly RetentionPolicyOutcome[] {
  return pass?.status === "completed" ? pass.policies : [];
}

function summarize({ live, locale, t }: { live: RetentionPassResult | undefined; locale: string; t: Parameters<typeof useWiredStorage>[0]["t"] }): Pick<StorageView, "freed" | "failures"> {
  const policies = policiesOf(live);
  if (live === undefined) return {};
  const swept = policies.flatMap(policy => (policy.status === "swept" ? [policy.result.freedBytes] : []));
  const failed = policies.flatMap(policy => (policy.status === "failed" ? [policy.message] : []));
  const freed = swept.includes(null) ? null : swept.reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0);
  return { freed: formatBytes({ bytes: freed, locale, t }), ...(failed.length === 0 ? {} : { failures: failed.join("; ") }) };
}

function lastPassLabel({ report, locale, t }: { report: StorageReport | undefined; locale: string; t: Parameters<typeof useWiredStorage>[0]["t"] }): string | undefined {
  const last = report?.lastPass;
  if (last === null || last === undefined || last.status !== "completed") return undefined;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(last.finishedAt);
  return last.dryRun ? `${when} (${t({ locale, key: "measured only" })})` : when;
}

interface StorageState { phase: Phase; report?: StorageReport | undefined; shown?: StoragePass | undefined; live?: RetentionPassResult | undefined; notice?: string | undefined }

/**
 * The Storage screen's state over the owner-only storage routes: load → ready → dry run → outcomes →
 * owner confirm → live → done. A live request is only ever built from a dry run already on screen.
 * `reportErrors` reports a failed request and answers the plain words the panel shows.
 * @complexity O(categories + policies) per render.
 */
export function useWiredStorage(
  { client, reportErrors, locale, links, t, categoryLabels, kindLabels }: { client: StorageClient; reportErrors: (required: { error: unknown }) => string; locale: string; links: readonly StorageLink[]; t: (required: { locale: string; key: string }) => string; categoryLabels: Readonly<Record<string, string>>; kindLabels: Readonly<Record<RetentionPolicyKind, string>> },
  _optional: Record<string, never> = {},
): StorageView {
  const [state, setState] = useState<StorageState>({ phase: "load" });
  const fail = useCallback((phase: Phase, error: unknown) => setState(previous => ({ ...previous, phase, notice: reportErrors({ error }) })), [reportErrors]);
  const load = useCallback(async () => {
    try { const report = await client.report({}, {}); setState(previous => ({ ...previous, report, phase: previous.phase === "load" ? "ready" : previous.phase })); } catch (error) { fail("ready", error); }
  }, [client, fail]);
  useEffect(() => { void load(); }, [load]);

  const dryRun = useCallback(async () => {
    setState(previous => ({ ...previous, phase: "dry-run", notice: undefined, shown: undefined, live: undefined }));
    try {
      const shown = await client.cleanup({ dryRun: true }, {});
      const measured = policiesOf(shown).some(policy => policy.status === "measured");
      const notice = shown.status === "stopped" ? "The clean-up stopped before it finished." : measured ? undefined : "Nothing to clean up right now.";
      setState(previous => ({ ...previous, shown, phase: shown.status === "stopped" ? "ready" : "outcomes", notice: notice === undefined ? undefined : t({ locale, key: notice }) }));
    } catch (error) { fail("ready", error); }
  }, [client, fail, locale, t]);

  const confirm = useCallback(() => setState(previous => (previous.phase === "outcomes" ? { ...previous, phase: "confirm" } : previous)), []);

  const cleanup = useCallback(async () => {
    if (state.phase !== "confirm" || state.shown === undefined) return;
    // Only the runner's automatic kinds the owner was just shown go to the live pass. "Yours"
    // (chats, uploads, screenshots, revisions…) is owner content: it is removed only from its own
    // screen through a per-item preview and confirm, never by a bulk storage sweep. "Shown only"
    // (database working files, exports, temporary files) is measured to explain the disk, but its
    // lifetime belongs to a live writer — deleting it here could break the running site or lose
    // work. The website refuses any other class as well; this keeps the request honest at the source.
    const classes = [...new Set(policiesOf(state.shown).flatMap(policy => (policy.status === "measured" ? [policy.kind] : [])))];
    setState(previous => ({ ...previous, phase: "live" }));
    try {
      // The grant the shown preview carried: the website runs live only for exactly that plan, once.
      const grant = state.shown.previewToken === undefined ? {} : { previewToken: state.shown.previewToken };
      const live = await client.cleanup({ dryRun: false, classes, ...grant }, {});
      setState(previous => ({ ...previous, live, phase: "done" }));
      void load();
    } catch (error) { fail("outcomes", error); }
  }, [client, fail, load, state.phase, state.shown]);

  const outcomes = policiesOf(state.live ?? state.shown).map(policy => ({ id: policy.id, label: t({ locale, key: kindLabels[policy.kind] }), outcome: toOutcome({ policy, locale, t }) }));
  const lastAutomaticPass = lastPassLabel({ report: state.report, locale, t });
  return {
    phase: state.phase,
    classes: toClasses({ report: state.report, locale, links, t, categoryLabels }),
    outcomes,
    canConfirm: policiesOf(state.shown).some(policy => policy.status === "measured"),
    ...(lastAutomaticPass === undefined ? {} : { lastAutomaticPass }),
    ...summarize({ live: state.live, locale, t }),
    ...(state.notice === undefined ? {} : { notice: state.notice }),
    dryRun: () => { void dryRun(); }, confirm, cleanup: () => { void cleanup(); },
  };
}
