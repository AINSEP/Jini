import { useCallback as useQueryFetchCallback, useState } from "react";
import { useFetchQuery } from "../../../react/kit.js";

import type { AdminObservabilityStatus, AdminTelemetryTestResult } from "../api/observability-api.types.js";
import { t as translateObservability } from "../observability-i18n.js";
import type { ObservabilityStatusPort } from "./observability-status-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file State for the Observability screen's Overview tab, so `Observability.tsx` is only markup —
 * same split as the agent-plugins screen's own hook.
 *
 * `t`/`locale` arrive with the dependencies, not read directly by `Observability.tsx` — the same
 * standing i18n rule (2026-08-11). The host binds the port, locale, translator and error describer.
 */

export interface ObservabilityStatusDependencies {
  port: ObservabilityStatusPort;
  locale: string;
  t: Translate;
  /** The host's API-error describer: the user-facing message for a failed call, else `fallback`. */
  describeError: ObservabilityErrorDescriber;
}

/** Turns a thrown API failure into the line the tab shows; the host owns which errors carry their own words. */
export type ObservabilityErrorDescriber = (required: { e: unknown; fallback: string }, optional?: Record<string, never>) => string;

export interface ObservabilityStatusController {
  /** `null` until the initial load settles — the caller renders a loading state. */
  status: AdminObservabilityStatus | null;
  error: string | null;
  /** Bound translator — `Observability.tsx`'s only source of UI copy. */
  t: Translate;
  /** The raw resolved locale — exposed only because `Observability.tsx` passes it straight
   *  through to `I18nProvider`'s own `initialLocale`, not because anything here needs it beyond
   *  `t`. Same reasoning as `AgentPluginsController.locale`. */
  locale: string;
  sendTestError?: () => Promise<void>;
  sendingTestError?: boolean;
  testResult?: AdminTelemetryTestResult | null;
  testError?: string | null;
  refresh?: () => void;
}

/**
 * Loads provider configuration and delivery evidence on mount and explicit refresh. The diagnostic
 * action uses the same authorized endpoint as the assistant tool and never submits error text.
 *
 * @complexity One GET on mount.
 */
export function useObservabilityStatus({ port, locale, t, describeError }: ObservabilityStatusDependencies): ObservabilityStatusController {
  const queryFetch = useQueryFetchCallback(async () => {
    try { return await port.getObservabilityStatus(); }
    catch (error) { throw new Error(describeError({ e: error, fallback: translateObservability({ locale, key: "failed to load observability status" }) })); }
  }, [port, locale, describeError]);
  const query = useFetchQuery({ key: ["observability", "status"], fetch: queryFetch }, { staleTime: 0 });
  const status = query.data ?? null;
  const error = query.error?.message ?? null;
  const [sendingTestError, setSendingTestError] = useState(false);
  const [testResult, setTestResult] = useState<AdminTelemetryTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const sendTestError = async (): Promise<void> => {
    if (sendingTestError || !port.sendTestError) return;
    setSendingTestError(true); setTestResult(null); setTestError(null);
    try { setTestResult(await port.sendTestError()); query.refetch(); }
    catch (failure) { setTestError(describeError({ e: failure, fallback: t("Failed to send test error") })); }
    finally { setSendingTestError(false); }
  };
  return { status, error, t, locale, sendingTestError, testResult, testError, sendTestError, refresh: query.refetch };
}
