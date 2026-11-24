import { useState } from "react";
import { useFetchMutation, useInvalidate } from "../../../react/kit.js";
import type { QueryKey } from "@jini-ai/core/fetch";
import { KEYS } from "../rules.js";
import { t } from "../database-i18n.js";
import type { MigrateForwardSectionPort } from "./migrate-forward-section-port.hooks.js";

/**
 * @file Everything `MigrateForwardSection` (the Database screen's plan/confirm/execute
 * migrate-forward ceremony) does, so `Database.tsx` is only markup.
 *
 * Extracted verbatim — same declaration order, same handlers, same error strings.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — see `use-timeline-section.hooks.ts`'s own file
 * header for the full rationale): this hook already resolved the locale (`host.useLocale()`) for its
 * own error-string translations, so exposing that same already-resolved `locale` as a bound `t` (plus
 * the raw value, still needed for this section's own local step subcomponents and
 * `planReadyMessage`) on the return value adds no new fetch.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `startPlan`/`doConfirm`/`doExecute` are three
 * `useFetchMutation`s. `startPlan`/`doConfirm` declare no `invalidates` — they write nothing another
 * screen reads (`step`/`plan`/`confirmationToken`/`done` are pure client-side workflow state, not a
 * server resource another screen could invalidate into). `useFetchMutation` is still the right seam
 * here purely for its consistent pending/error tracking (`mutation.status`/`.error`), replacing the
 * hand-rolled `setBusy`/`setError` pairs each handler used to open and close by hand. `step`/`plan`/
 * `confirmationToken`/`done` stay local `useState` — they encode the ceremony's own sequence, which
 * no mutation object carries on its own. `error` is a simple precedence chain (not
 * `clearOtherWriteErrors`): the three mutations are mutually exclusive by construction
 * (`doConfirm`/`doExecute` both no-op without their predecessor's output), so at most one ever holds
 * a non-null `.error` at a time. `reset()` now also resets all three mutations, so a stale failure
 * from an earlier attempt at the current step doesn't survive a full ceremony reset.
 *
 * `doExecute` invalidates `KEYS.schemaState` and `KEYS.timelineAll` (2026-09-20 platform-review fix):
 * unlike `startPlan`/`doConfirm`, `execute` performs the ceremony's one real server write — it saves
 * a `restore_points` row and appends a `core.migration` `database_ledger` row
 * (the server's gated `executeMigrateForward`) — and those are exactly what the drift banner
 * (`use-schema-state-section.hooks.ts`) and the Timeline (`use-timeline-section.hooks.ts`) read.
 * Neither of those reads has any polling or `refetchOnWindowFocus`, and `SchemaStateWarningBanner`
 * stays mounted across the Migrate forward tab (`Database.tsx`), so without this the banner and
 * Timeline went stale until a manual page reload. `startPlan`/`doConfirm` still declare no
 * `invalidates` — plan and confirm write nothing the screen lists. A REJECTED execute also
 * re-invalidates both keys (via `useInvalidate()` in `doExecute`'s `catch`, not `FetchMutationOptions.
 * invalidates`, which only fires `onSuccess`): a rejection can be a lost response after the server
 * already committed (a timeout or a dropped connection after the write lands), and a re-read can only
 * make the screen more truthful. This is a deliberate, one-write-only departure from
 * `FetchMutationOptions.invalidates`'s "a rejected write changed nothing" assumption.
 *
 * DI seam (2026-08-14, Orc-BASH pass): `port` is now injected — see `migrate-forward-section-
 * port.hooks.ts` — rather than reaching the host's HTTP client directly, so a test can describe the
 * plan/confirm/execute ceremony against `createFakeMigrateForwardSectionPort` instead of stubbing
 * global `fetch`. The host's `useWiredMigrateForwardSection` binding is the zero-argument pair
 * the screen actually mounts.
 *
 * Host seam: the locale hook and the API-error describer (`MigrateForwardSectionHost`) arrive on `host`, so this file reaches neither the host's HTTP client
 * nor the admin shell. Pass a module-level `host` object: its hook fields are called on every render
 * and must keep their identity.
 */

export type CeremonyStep = "idle" | "planned" | "confirmed" | "done";

/** The reads a successful (or possibly-committed-but-rejected) `doExecute` changes — see this
 *  file's header. Shared between `executeMutation`'s `invalidates` and `doExecute`'s own rejected-path
 *  re-read so the two lists cannot drift apart. */
const MIGRATION_CHANGES_READS: readonly QueryKey[] = [KEYS.schemaState, KEYS.timelineAll];

export interface MigrateForwardSectionController {
  step: CeremonyStep;
  busy: boolean;
  error: string | null;
  plan: { planId: string; planHash: string } | null;
  confirmationToken: string | null;
  done: boolean;
  reset: () => void;
  startPlan: () => Promise<void>;
  doConfirm: () => Promise<void>;
  doExecute: () => Promise<void>;
  /** Bound translator — `key` already resolved against the caller's locale, so `Database.tsx`
   *  never imports `useAdminLocale`/`database-i18n` for this section. See this file's header. */
  t: (key: string) => string;
  /** Raw resolved locale — this section's own local step subcomponents (`PlanMigrationStep`,
   *  `PlannedStep`, …) and `planReadyMessage` take `locale` directly rather than a bound
   *  translator. See this file's header. */
  locale: string;
}

/** What the host supplies so this hook stays free of its locale query and HTTP client. */
export interface MigrateForwardSectionHost {
  /** The admin's resolved UI locale (a React hook). */
  useLocale: () => string;
  /** Turns a thrown API error into the operator-facing message, `fallback` when it has none. */
  describeError: (required: { e: unknown; fallback: string }) => string;
}

export interface MigrateForwardSectionDependencies {
  port: MigrateForwardSectionPort;
  host: MigrateForwardSectionHost;
}

/** The failure copy for whichever step failed, in step order; `null` when none did. */
function migrateForwardErrorKey(
  { planError, confirmError, executeError }: { planError: unknown; confirmError: unknown; executeError: unknown },
  _options = {},
): string | null {
  if (planError) return "Failed to plan the forward migration";
  if (confirmError) return "Failed to confirm the forward migration";
  if (executeError) return "Failed to execute the forward migration";
  return null;
}

/**
 * @param deps Injected dependencies — the `MigrateForwardSectionPort` to run the ceremony through.
 * @returns The ceremony's step/plan/token/done state plus `startPlan`/`doConfirm`/`doExecute`/
 * `reset`, and a bound `t`/`locale` — see this file's header for the full rationale.
 */
export function useMigrateForwardSection(deps: MigrateForwardSectionDependencies, _optional: Record<string, never> = {}): MigrateForwardSectionController {
  const { port, host } = deps;
  const locale = host.useLocale();
  const boundT = (key: string): string => t({ locale: locale, key: key });
  const invalidate = useInvalidate();
  const [step, setStep] = useState<CeremonyStep>("idle");
  const [plan, setPlan] = useState<{ planId: string; planHash: string } | null>(null);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const startPlanMutation = useFetchMutation({ run: ({ input: _ }: { input: undefined }) => port.planMigrateForward() });
  const confirmMutation = useFetchMutation({
    run: ({ input }: { input: { planId: string; planHash: string } }) => port.confirmMigrateForward(input),
  });
  const executeMutation = useFetchMutation({
    run: ({ input: confirmationTokenInput }: { input: string }) => port.executeMigrateForward({ confirmationToken: confirmationTokenInput }),
  }, {
    invalidates: MIGRATION_CHANGES_READS,
  });

  function reset() {
    setStep("idle");
    setPlan(null);
    setConfirmationToken(null);
    setDone(false);
    startPlanMutation.reset();
    confirmMutation.reset();
    executeMutation.reset();
  }

  async function startPlan() {
    try {
      const r = await startPlanMutation.mutate({ input: undefined });
      setPlan({ planId: r.planId, planHash: r.planHash });
      setStep("planned");
    } catch {
      // already surfaced through startPlanMutation.error -> error below
    }
  }

  async function doConfirm() {
    if (!plan) return;
    try {
      const r = await confirmMutation.mutate({ input: { planId: plan.planId, planHash: plan.planHash } });
      setConfirmationToken(r.confirmationToken);
      setStep("confirmed");
    } catch {
      // already surfaced through confirmMutation.error -> error below
    }
  }

  async function doExecute() {
    if (!confirmationToken) return;
    try {
      await executeMutation.mutate({ input: confirmationToken });
      setDone(true);
      setStep("done");
    } catch {
      // already surfaced through executeMutation.error -> error below.
      // Re-read the schema state and Timeline anyway: a rejection here can be a lost response after
      // the server already committed the write (a timeout or a dropped connection), so a stale
      // "in-sync"/old-Timeline read is a worse failure mode than one extra fetch. See this file's
      // header.
      for (const key of MIGRATION_CHANGES_READS) invalidate({ key: key });
    }
  }

  const busy = startPlanMutation.status === "pending" || confirmMutation.status === "pending" || executeMutation.status === "pending";
  // Mutually exclusive by construction (`doConfirm`/`doExecute` both no-op without their
  // predecessor's output — see this file's own header), so at most one of these three is ever
  // non-null at a time; a plain precedence chain is enough, no `clearOtherWriteErrors` needed.
  const rawError = startPlanMutation.error ?? confirmMutation.error ?? executeMutation.error;
  const errorKey = migrateForwardErrorKey({ planError: startPlanMutation.error, confirmError: confirmMutation.error, executeError: executeMutation.error });
  const error = errorKey === null ? null : host.describeError({ e: rawError, fallback: t({ locale: locale, key: errorKey }) });

  return { step, busy, error, plan, confirmationToken, done, reset, startPlan, doConfirm, doExecute, t: boundT, locale };
}
