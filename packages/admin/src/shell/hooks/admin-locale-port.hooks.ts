/**
 * @file What `use-admin-locale.hooks.ts` needs from the outside world, as an interface rather than
 * direct settings-read and refresh-bus imports. The host binds the real port; a test binds a fake.
 *
 * Both members are dependencies, not just the fetch. `subscribeToSettingsRefresh` is what a host's
 * dock test previously had to fight by partially un-mocking its refresh bus — injecting it here
 * means a test can drive a refresh through the fake instead. Narrowed to a plain no-argument
 * `listener`, not the raw `(scope) => void` shape a real bus delivers: whether a given refresh
 * notification is actually about the language namespace is a fact only the real binding needs to
 * compute, matching the "narrowed to the one field this hook reads" precedent of the other ports.
 */
export interface AdminLocalePort {
  /** Resolves the operator's stored locale. A rejection is handled by `useAdminLocale` itself
   *  (falls back to the injected `fallbackLocale`), not by this port. */
  loadLanguage(required: Record<string, never>, optional?: Record<string, never>): Promise<string>;
  /** Calls `listener` whenever a refresh notification is relevant to the locale — already filtered
   *  by namespace, so the hook never has to reason about scope. Returns an unsubscribe function. */
  subscribeToSettingsRefresh(required: { listener: () => void }, optional?: Record<string, never>): () => void;
}
