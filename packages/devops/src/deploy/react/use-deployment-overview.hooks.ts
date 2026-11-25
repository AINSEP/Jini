import type { Translate } from "@jini-ai/core/text";
/**
 * @file Everything the Overview tab does, so `OverviewTab.tsx` is only markup.
 *
 * Read-only, single query, no mutations — the simplest member of this app's `useX(port, t, locale)`
 * / `useWiredX()` pair (see `use-integrations.hooks.ts` for the canonical fuller example). `port` is
 * injected — see `deployment-overview-port.hooks.ts` — so a test can describe the loading/loaded/
 * error states against `createFakeDeploymentOverviewPort` instead of stubbing global `fetch`.
 *
 * `t`/`locale` follow the same standing i18n rule every other feature hook in this app follows: a
 * component with a hook gets a BOUND `t` from that hook, not its own `useAdminLocale()`/dictionary
 * import (see `use-recovery.hooks.ts`'s header for the original statement of this rule).
 */
export interface DeploymentOverviewController<Snapshot> {
  /** `undefined` until the first successful load — `OverviewTab.tsx` renders the loading state. */
  snapshot: Snapshot | undefined;
  /** Already-formatted, translated message — `null` while loading or once loaded successfully. */
  error: string | null;
  /** Bound translator — see this file's header. */
  t: Translate;
}

export interface DeploymentOverviewArgs<Snapshot> {
  port: { getDeploymentOverview(): Promise<Snapshot> };
  t: Translate;
  locale: string;
  useFetchQueryHook: (
    required: { key: readonly string[]; fetch: () => Promise<Snapshot> },
    optional?: Record<string, never>,
  ) => { data: Snapshot | undefined; error: unknown };
  describeError: (
    required: { error: unknown; locale: string },
    optional?: Record<string, never>,
  ) => string;
}

export function useDeploymentOverview<Snapshot>(
  { port, t, locale, useFetchQueryHook, describeError }: DeploymentOverviewArgs<Snapshot>,
  _optional = {},
): DeploymentOverviewController<Snapshot> {
  const query = useFetchQueryHook({
    key: ["deployment", "overview"],
    fetch: () => port.getDeploymentOverview(),
  });

  const error = query.error
    ? describeError({ error: query.error, locale })
    : null;

  return { snapshot: query.data, error, t };
}
