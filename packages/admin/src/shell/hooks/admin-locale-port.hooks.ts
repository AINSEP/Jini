/**
 * @file What `use-admin-locale.hooks.ts` needs from the outside world, as an interface rather than
 * direct `lib/settings-tabs`/`lib/settings-refresh-bus` imports. Follows the `useX(dependencies)` /
 * `useWiredX()` pair documented in the host admin app's INFO doc (Hooks section).
 *
 * Both members are dependencies, not just the fetch. `subscribeToSettingsRefresh` is exactly what
 * `AssistantDock.unit.test.tsx` previously had to fight by partially un-mocking
 * `lib/settings-refresh-bus` (`vi.importActual`) — injecting it here means a test can drive a
 * refresh through the fake instead. Narrowed to a plain no-argument `listener`, not the raw
 * `(scope) => void` shape the real bus delivers: whether a given refresh notification is actually
 * about `core.language` is a fact only the real binding needs to compute (see
 * `admin-locale-dependencies.hooks.ts`'s `refreshApplies`) — matching `theme-pages-port.hooks.ts`'s
 * own "narrowed to the one field this hook reads" precedent.
 */
export interface AdminLocalePort {
  /** Resolves the operator's stored `core.language.locale`. A rejection is handled by
   *  `use-admin-locale.hooks.ts` itself (falls back to `DEFAULT_LOCALE`), not by this port. */
  loadLanguage(): Promise<string>;
  /** Calls `listener` whenever a refresh notification is relevant to the locale — already filtered
   *  by namespace, so the hook never has to reason about scope. Returns an unsubscribe function,
   *  same shape as the real `subscribeToSettingsRefresh`. */
  subscribeToSettingsRefresh(required: { listener: () => void }): () => void;
}
