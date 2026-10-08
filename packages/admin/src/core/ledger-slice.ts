/**
 * @file The shared read/diff-write half of every settings-dialog tab adapter.
 *
 * Each tab maps a SPEC-007 ledger namespace onto one `@jini-ai/ui` config
 * object. Three things are identical across all of them and live here:
 *
 * 1. **Cold-start tolerance.** A namespace with no registered definitions
 *    404s, which is the expected state before the boot registrar has run (or
 *    on a database predating the tab). That is not an error worth surfacing —
 *    it means "use defaults". Every OTHER failure still propagates.
 * 2. **Field-level diffing.** The ledger is append-only per key
 *    (ADR-028 §4), so writing all N keys on every save would burn N revisions
 *    per keystroke. Only changed keys are written.
 * 3. **Typed reads.** Ledger values arrive as `unknown`; a missing or
 *    wrong-typed value falls back field by field rather than throwing, so a
 *    partially-written namespace still yields a usable config.
 *
 * What deliberately does NOT live here: anything about a specific tab's
 * shape, and anything about credentials. `execution-settings.ts` keeps its own
 * localStorage half because the ADR-028 §6 secret gate is an execution-tab
 * problem, not a general one — see that file's header.
 */

import type { AdminSettingsPort, SettingScope } from "./ports/settings.js";

/** A single ledger write: the key within the namespace and its new JSON value. */
export interface LedgerEntry {
  key: string;
  valueJson: unknown;
}

/** A candidate write plus whether it actually differs from the persisted value. */
export interface LedgerCandidate extends LedgerEntry {
  changed: boolean;
}

/**
 * Reads every effective value in `namespace` as a key -> value map.
 *
 * Returns an EMPTY map (not an error) when the namespace has no registered
 * definitions yet — see this file's header, item 1. Any other failure
 * propagates, per the error-reporting contract: a network error or a 500 must
 * not be laundered into "no settings", which would silently show defaults and
 * then overwrite real saved values on the next keystroke.
 */
export async function loadNamespaceValues(
  { namespace, port }: { namespace: string; port: Pick<AdminSettingsPort, "getSettingsEffective"> },
  { isUnregisteredNamespace }: { isUnregisteredNamespace: (required: { error: unknown }, optional?: Record<string, never>) => boolean },
): Promise<Map<string, unknown>> {
  try {
    const data = await port.getSettingsEffective({ namespace }, {});
    return new Map(data.map((row) => [row.key, row.value]));
  } catch (error) {
    if (isUnregisteredNamespace({ error }, {})) return new Map();
    throw error;
  }
}

/**
 * Writes the changed subset of `candidates`, in order, and returns the keys
 * actually written.
 *
 * Sequential rather than parallel on purpose: each `setSetting` opens the
 * settings write chokepoint's transaction, and concurrent openers throw on the
 * SQLite root — the same hazard the server's boot registrars chain around.
 */
export async function saveChangedEntries(
  { namespace, scope, candidates, port }: { namespace: string; scope: SettingScope; candidates: readonly LedgerCandidate[]; port: Pick<AdminSettingsPort, "setSetting"> },
  _options: Record<string, never> = {},
): Promise<readonly string[]> {
  const changed = candidates.filter((candidate) => candidate.changed);
  for (const { key, valueJson } of changed) {
    await port.setSetting({ namespace, key, scope, value: valueJson }, {});
  }
  return changed.map((entry) => entry.key);
}

/** Reads a string, falling back when the key is absent or holds another type. */
export function readString({ values, key, fallback }: { values: ReadonlyMap<string, unknown>; key: string; fallback: string }, _options: Record<string, never> = {}): string {
  const value = values.get(key);
  return typeof value === "string" ? value : fallback;
}

/** Reads a boolean, falling back when the key is absent or holds another type. */
export function readBoolean({ values, key, fallback }: { values: ReadonlyMap<string, unknown>; key: string; fallback: boolean }, _options: Record<string, never> = {}): boolean {
  const value = values.get(key);
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Reads a finite number, falling back when the key is absent, holds another
 * type, or holds `NaN`/`Infinity`.
 *
 * The finiteness check matters because these values round-trip through JSON,
 * where `NaN` and `Infinity` serialize to `null` — a value that survived a
 * write but not a read would otherwise reach a tab as a number it cannot
 * render.
 */
export function readNumber({ values, key, fallback }: { values: ReadonlyMap<string, unknown>; key: string; fallback: number }, _options: Record<string, never> = {}): number {
  const value = values.get(key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
