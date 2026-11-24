/**
 * @file Replacement navigation for retired admin URLs. Markup only (there is none): this component's
 * entire job is to redirect, via the host-supplied redirect hook. The hook is a REQUIRED prop because it
 * navigates through the host's router and owns the host's legacy-route table — a default here would
 * make this package import host navigation.
 */

/** The host's redirect effect: replaces browser history with `routePath` (or the host's legacy default
 *  when it is `undefined`) and notifies route subscribers after render. */
export type UseIntegrationsRedirect = (required: { routePath?: string | undefined }, optional?: Record<string, never>) => void;

export interface IntegrationsRedirectProps {
  /** Destination route path supplied by the migration adapter; `undefined` keeps the host hook's default. */
  routePath?: string | undefined;
  /** The host's redirect hook. Required: never defaulted to a hook this package owns. */
  useIntegrationsRedirectHook: UseIntegrationsRedirect;
}

/** Renders nothing; calls the host's redirect hook with `routePath`.
 *  @example <IntegrationsRedirect routePath="/email" useIntegrationsRedirectHook={useIntegrationsRedirect} />
 *  @complexity O(1). */
export function IntegrationsRedirect({ routePath, useIntegrationsRedirectHook }: IntegrationsRedirectProps, _optional: Record<string, never> = {}) {
  useIntegrationsRedirectHook({ routePath });
  return null;
}
