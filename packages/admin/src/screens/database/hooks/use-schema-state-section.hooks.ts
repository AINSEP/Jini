import { useFetchQuery } from "../../../react/kit.js";
import { KEYS, resolveSchemaStateWarning, type SchemaStateWarning } from "../rules.js";
import { t } from "../database-i18n.js";
import type { SchemaStateSectionPort } from "./schema-state-section-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Everything the Database screen's drift warning does, so `Database.tsx` stays markup only.
 * Same `useX(dependencies)` / `useWiredX()` shape as this feature's three older sections.
 *
 * This is the client half of the gap closed on 2026-08-24: the server's `getDriftStatus` drift check was
 * built, correct, and reachable only from an agent tool, so a site owner on a diverged database was
 * never told. `Database.tsx`'s own header used to record the drift banner as having "no route yet".
 *
 * ALL of the decision lives in `rules.ts`'s pure `resolveSchemaStateWarning` — this hook only feeds
 * it the two inputs (`state`, `error`) and hands back what it returns. That split is deliberate:
 * the honesty rules (a failed check must warn; an unrecognised status must warn; only a confirmed
 * `"in-sync"` may stay silent) are worth testing without a React tree around them.
 *
 * NO `refetchInterval`/polling: drift changes only when someone migrates, and `use-migrate-forward-
 * section.hooks.ts`'s `doExecute` invalidates `KEYS.schemaState` on success or rejection (see that
 * hook's own header) — so the one deliberate act that can change this screen's answer already forces
 * a re-read. A background poll would add request volume for no new signal.
 *
 * Host seam: the locale hook (`SchemaStateSectionHost`) arrives on `host`, so this file reaches neither the host's HTTP client
 * nor the admin shell. Pass a module-level `host` object: its hook field is called on every render
 * and must keep their identity.
 */

export interface SchemaStateSectionController {
  /** The one warning to render, or `null` for "confirmed clean" / "not read yet" — distinguish
   *  those two with {@link SchemaStateSectionController.settled}, never by treating `null` alone as
   *  good news. */
  warning: SchemaStateWarning | null;
  /** Whether the first read has finished, either way. Exists so a caller cannot mistake the
   *  pre-read silence for a clean bill of health. */
  settled: boolean;
  /** Bound translator — `key` already resolved against the caller's locale, so `Database.tsx`
   *  never imports `useAdminLocale`/`database-i18n` for this section. */
  t: Translate;
}

/** What the host supplies so this hook stays free of its locale query. */
export interface SchemaStateSectionHost {
  /** The admin's resolved UI locale (a React hook). */
  useLocale: () => string;
}

export interface SchemaStateSectionDependencies {
  port: SchemaStateSectionPort;
  host: SchemaStateSectionHost;
}

/**
 * @param deps Injected dependencies — the `SchemaStateSectionPort` to read drift status through and
 *   the REQUIRED `host` (its locale hook).
 * @returns The resolved warning (or `null`), whether the read has settled, and a bound `t`.
 */
export function useSchemaStateSection(deps: SchemaStateSectionDependencies, _optional: Record<string, never> = {}): SchemaStateSectionController {
  const { port, host } = deps;
  const locale = host.useLocale();
  const boundT: Translate = (key: string): string => t({ locale: locale, key: key });

  const query = useFetchQuery({ key: KEYS.schemaState, fetch: () => port.getDatabaseSchemaState() });

  // `query.error` is passed through as a plain presence flag, not as display copy: the user-facing
  // sentence for a failed check comes from `resolveSchemaStateWarning`, which says the same honest
  // thing regardless of WHICH transport error occurred. A raw API-error description here would
  // put transport vocabulary in front of a non-technical site owner for no added meaning.
  const warning = resolveSchemaStateWarning({
    state: query.data ?? null,
    error: query.error ? "unavailable" : null,
  });

  return { warning, settled: query.status !== "loading", t: boundT };
}
