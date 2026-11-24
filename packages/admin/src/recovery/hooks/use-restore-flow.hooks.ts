import { useEffect, useState } from "react";

import type { AdminDisclosureResult, AdminRestorePoint } from "../../core/index.js";
import { t } from "../recovery-i18n.js";

import type { RestoreFlowPort } from "./restore-flow-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file The restore ceremony (`plan`/`confirm`/`execute`, SPEC-019 C-301/C-302/C-303) plus the
 * discarded-write-window disclosure fetch, so `RestoreFlow` in `Recovery.tsx` is only markup.
 *
 * Extracted verbatim — same nine pieces of state, same reset-on-point-change effect, same three
 * ceremony steps, same error strings. See `Recovery.tsx`'s file header for why the ceremony is
 * restart-based rather than a live hot-swap.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/recovery` needs it.
 *
 * `t`/`locale` (2026-08-11, standing i18n rule — see `use-recovery.hooks.ts`'s own file header for
 * the full rationale): this hook already called `useAdminLocale()` for its own error-string
 * translations, so exposing that same already-resolved `locale` as a bound `t` (plus the raw value,
 * still needed for `RestoreFlow`'s own local step subcomponents and the several `recovery-i18n.tsx`
 * helpers that take `locale` directly) on the return value adds no new fetch.
 *
 * DI seam (2026-08-14, Orc-BASH pass): `port` is injected — see `restore-flow-port.hooks.ts` —
 * rather than reaching `lib/api` directly, so a test can describe the disclosure/plan/confirm/execute
 * ceremony against `createFakeRestoreFlowPort` instead of stubbing global `fetch`. `point` is the
 * business input; `port` and `host` are the external dependencies, all three named fields of the
 * one required argument. The host's `useWiredRestoreFlow` binding is the pair `RestoreFlow` in
 * `Recovery.tsx` actually mounts.
 *
 * Host seam: the locale hook and the API-error describer arrive on `host` (`RestoreFlowHost`), so
 * this file never reaches the host's HTTP client. Pass a module-level `host` object: its locale
 * hook is called on every render and must keep its identity.
 */

/** What the host supplies so the ceremony stays free of its HTTP client and locale store. */
export interface RestoreFlowHost {
  /** The admin's resolved UI locale (a React hook). */
  useLocale: () => string;
  /** Turns a thrown API error into the operator-facing message, `fallback` when it has none. */
  describeError: (required: { e: unknown; fallback: string }) => string;
}

/** The restore point a ceremony targets plus its injected collaborators. */
export interface RestoreFlowArgs {
  point: AdminRestorePoint;
  port: RestoreFlowPort;
  host: RestoreFlowHost;
}

export type CeremonyStep = "idle" | "planned" | "confirmed" | "done";

export interface RestoreFlowController {
  disclosure: AdminDisclosureResult | null;
  error: string | null;
  acknowledged: boolean;
  setAcknowledged: (checked: boolean) => void;
  step: CeremonyStep;
  busy: boolean;
  ceremonyError: string | null;
  plan: { planId: string; planHash: string } | null;
  confirmationToken: string | null;
  result: { restoreRunId: string; state: string; restartRequired?: boolean | undefined } | null;
  startPlan: () => Promise<void>;
  doConfirm: () => Promise<void>;
  doExecute: () => Promise<void>;
  /** Bound translator — `key` already resolved against the caller's locale, so `RestoreFlow` never
   *  imports `useAdminLocale`/`recovery-i18n` itself. See this file's header. */
  t: Translate;
  /** Raw resolved locale — `RestoreFlow`'s own local step subcomponents and several
   *  `recovery-i18n.tsx` helpers take `locale` directly rather than a bound translator. See this
   *  file's header. */
  locale: string;
}

/**
 * @param args `point` — the restore point this ceremony targets; `port` — the `RestoreFlowPort` to
 * run disclosure/plan/confirm/execute through; `host` — the locale hook and error describer.
 * @returns The disclosure/ceremony state plus `setAcknowledged`/`startPlan`/`doConfirm`/`doExecute`,
 * and a bound `t`/`locale` — see this file's header for the full rationale.
 */
export function useRestoreFlow(args: RestoreFlowArgs, _optional: Record<string, never> = {}): RestoreFlowController {
  const { port, host } = args;
  const props = { point: args.point };
  const {
    locale, boundT, disclosure, error, acknowledged, setAcknowledged, step, setStep, busy, setBusy, ceremonyError, setCeremonyError, plan, setPlan,
    confirmationToken, setConfirmationToken, result, setResult,
    describeError,
  } = useRestoreFlowState({ port, host, props });
  const { startPlan, doConfirm } = createRestorePlanningActions({ describeError, setBusy, setCeremonyError, port, props, setPlan, setStep, locale, plan, acknowledged, setConfirmationToken });
  const { doExecute } = createRestoreExecuteAction({ describeError, confirmationToken, setBusy, setCeremonyError, port, props, setResult, setStep, locale });

  return {
    disclosure,
    error,
    acknowledged,
    setAcknowledged,
    step,
    busy,
    ceremonyError,
    plan,
    confirmationToken,
    result,
    startPlan,
    doConfirm,
    doExecute,
    t: boundT,
    locale,
  };
}

function createRestoreExecuteAction(
  { describeError, confirmationToken, setBusy, setCeremonyError, port, props, setResult, setStep, locale }:
    Pick<ReturnType<typeof useRestoreFlowState>, "describeError" | "confirmationToken" | "setBusy" | "setCeremonyError" | "setResult" | "setStep" | "locale"> &
    { port: RestoreFlowPort; props: { point: AdminRestorePoint } }
) {
  async function doExecute() {
    if (!confirmationToken) return;
    setBusy(true);
    setCeremonyError(null);
    try {
      const r = await port.executeRestore({ confirmationToken, restorePointId: props.point.id });
      setResult({ restoreRunId: r.restoreRunId, state: r.state, restartRequired: r.restartRequired });
      setStep("done");
    } catch (e) {
      setCeremonyError(describeError({ e, fallback: t({ locale: locale, key: "Failed to execute the restore" }) }));
    } finally {
      setBusy(false);
    }
  }
  return { doExecute };
}

function createRestorePlanningActions(
  { describeError, setBusy, setCeremonyError, port, props, setPlan, setStep, locale, plan, acknowledged, setConfirmationToken }:
    Pick<ReturnType<typeof useRestoreFlowState>, "describeError" | "setBusy" | "setCeremonyError" | "setPlan" | "setStep" | "locale" | "plan" | "acknowledged"
    | "setConfirmationToken"> &
    { port: RestoreFlowPort; props: { point: AdminRestorePoint } }
) {
  async function startPlan() {
    setBusy(true);
    setCeremonyError(null);
    try {
      const r = await port.planRestore({ restorePointId: props.point.id });
      setPlan({ planId: r.planId, planHash: r.planHash });
      setStep("planned");
    } catch (e) {
      setCeremonyError(describeError({ e, fallback: t({ locale: locale, key: "Failed to plan the restore" }) }));
    } finally {
      setBusy(false);
    }
  }

  async function doConfirm() {
    if (!plan) return;
    setBusy(true);
    setCeremonyError(null);
    try {
      const r = await port.confirmRestore({
        planId: plan.planId,
        planHash: plan.planHash,
        disclosureAcknowledged: acknowledged,
      });
      setConfirmationToken(r.confirmationToken);
      setStep("confirmed");
    } catch (e) {
      setCeremonyError(describeError({ e, fallback: t({ locale: locale, key: "Failed to confirm the restore" }) }));
    } finally {
      setBusy(false);
    }
  }
  return { startPlan, doConfirm };
}

function useRestoreFlowState(
  { port, host, props }:
    { port: RestoreFlowPort; host: RestoreFlowHost; props: { point: AdminRestorePoint } }
) {
  const locale = host.useLocale();
  const { describeError } = host;
  const boundT = (key: string): string => t({ locale: locale, key: key });
  const [disclosure, setDisclosure] = useState<AdminDisclosureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const [step, setStep] = useState<CeremonyStep>("idle");
  const [busy, setBusy] = useState(false);
  const [ceremonyError, setCeremonyError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ planId: string; planHash: string } | null>(null);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [result, setResult] = useState<{ restoreRunId: string; state: string; restartRequired?: boolean | undefined } | null>(
    null,
  );

  useEffect(() => {
    setDisclosure(null);
    setAcknowledged(false);
    setError(null);
    setStep("idle");
    setBusy(false);
    setCeremonyError(null);
    setPlan(null);
    setConfirmationToken(null);
    setResult(null);
    port
      .computeRecoveryDisclosure({ restorePointId: props.point.id })
      .then(setDisclosure)
      .catch((e) => setError(describeError({ e, fallback: t({ locale: locale, key: "Failed to compute the discarded-write-window disclosure" }) })));
  }, [props.point.id, port]);
  return {
    locale, boundT, disclosure, error, acknowledged, setAcknowledged, step, setStep, busy, setBusy, ceremonyError, setCeremonyError, plan, setPlan,
    confirmationToken, setConfirmationToken, result, setResult, describeError,
  };
}

