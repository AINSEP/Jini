/**
 * Generalized from OD `packages/host/src/index.ts` (~675 lines) —
 * `window.__od__`'s `OpenDesignHostBridge`. The wire-protocol MECHANISM
 * (a typed global the renderer probes for and validates before trusting,
 * namespaced capabilities, a scope-aware getter that checks both
 * `globalThis` and `globalThis.window`, thin action wrappers that
 * translate "host missing"/thrown errors into a uniform failure shape) is
 * exactly what any renderer-hosted-by-a-native-shell package needs and is
 * ported here as-is. Everything OD-specific is stripped:
 *
 * - Global renamed `__od__` → `__jini__`; version reset to 1 (this is a
 *   new protocol, not OD's v2 — there is no compatibility to preserve).
 * - `browser`/`capture`/`pdf`/`pet`/`project` namespaces are dropped
 *   entirely. `project`/`pdf`/`pet` are OD design/product concepts
 *   (project import, deck PDF export, the desktop pet) that stay
 *   OD-side. `capture`/`pdf` rendering capability is NOT part of this
 *   bridge at all — see `render-service.ts`: `RenderService` is a
 *   host-process-side provider a daemon/export route calls directly, not
 *   a renderer-facing bridge action, so it does not belong in a
 *   `window.__jini__` namespace.
 * - `client.type` is `'electron' | 'tauri'` (this package's two real
 *   backends) instead of OD's single hardcoded `'desktop'`.
 * - `shell.openPath` takes a raw path string instead of OD's
 *   `projectId` (OD resolves project → path itself before crossing the
 *   bridge; a generic host has no project concept to resolve from).
 * - `updater` is kept only as a documented, OPTIONAL extension point
 *   (`checkAvailability`) — the task brief is explicit that update
 *   business logic (OD's ~3.5k line `updater.ts`) is out of scope, so
 *   this package ships the namespace's *shape* and no implementation;
 *   validation does not require a host to provide it, mirroring how OD's
 *   own bridge treats `project.pickWorkingDir?` as feature-detected.
 */

export const JINI_HOST_GLOBAL = '__jini__';
export const JINI_HOST_VERSION = 1;

export const JINI_HOST_CLIENT_TYPES = Object.freeze({
  ELECTRON: 'electron',
  TAURI: 'tauri',
} as const);

export type JiniHostClientType = (typeof JINI_HOST_CLIENT_TYPES)[keyof typeof JINI_HOST_CLIENT_TYPES];

export interface JiniHostClient {
  type: JiniHostClientType;
  platform?: string;
  osLocale?: string;
}

export interface JiniHostFailure {
  ok: false;
  reason: string;
  details?: unknown;
}

export type JiniHostActionResult = { ok: true } | JiniHostFailure;

export interface JiniHostUpdaterAvailability {
  available: boolean;
}

/**
 * Extension point only — no adapter in this package implements update
 * business logic. A consumer that wants real update-checking wires its
 * own implementation behind this single method.
 */
export interface JiniHostUpdaterNamespace {
  checkAvailability(): Promise<JiniHostUpdaterAvailability>;
}

export interface JiniHostBridge {
  version: typeof JINI_HOST_VERSION;
  client: JiniHostClient;
  shell: {
    openExternal({ url }: { url: string }): Promise<JiniHostActionResult>;
    openPath({ path }: { path: string }): Promise<JiniHostActionResult>;
  };
  updater?: JiniHostUpdaterNamespace;
}

export type JiniHostGlobalScope = Record<string, unknown> & { window?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function hasFunction(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'function';
}

// OD's original `failure(reason, details?)` accepts an optional `details`
// carried over from `packages/host/src/actions.ts`, but every call site in
// that file (and every call site here) only ever supplies `reason` — the
// `details` plumbing is exercised solely by OD's `normalize.ts` (a
// project-import-result normalizer, an explicitly out-of-scope OD product
// concept per archived provenance ledger). With no caller in this file ever passing
// `details`, keeping the parameter here would be untestable dead code, so
// it's dropped; `JiniHostFailure.details` remains part of the public type
// for any external implementer that wants to populate it directly.
function failure(reason: string): JiniHostFailure {
  return { ok: false, reason };
}

export function isJiniHostBridge(requiredArgs: { value: unknown }): requiredArgs is { value: JiniHostBridge } {
  const { value } = requiredArgs;
  if (!isRecord(value)) return false;
  if (value.version !== JINI_HOST_VERSION) return false;

  const client = value.client;
  if (!isRecord(client)) return false;
  const clientTypes: string[] = Object.values(JINI_HOST_CLIENT_TYPES);
  if (typeof client.type !== 'string' || !clientTypes.includes(client.type)) return false;
  if (client.platform != null && typeof client.platform !== 'string') return false;
  if (client.osLocale != null && typeof client.osLocale !== 'string') return false;

  const shell = value.shell;
  if (!isRecord(shell) || !hasFunction(shell, 'openExternal') || !hasFunction(shell, 'openPath')) return false;

  if (value.updater !== undefined) {
    const updater = value.updater;
    if (!isRecord(updater) || !hasFunction(updater, 'checkAvailability')) return false;
  }

  return true;
}

function candidateFromScope(scope: JiniHostGlobalScope): unknown {
  if (JINI_HOST_GLOBAL in scope) return scope[JINI_HOST_GLOBAL];
  const windowValue = scope.window;
  if (isRecord(windowValue) && JINI_HOST_GLOBAL in windowValue) return windowValue[JINI_HOST_GLOBAL];
  return undefined;
}

export function getJiniHost(_requiredArgs: Record<string, never>, { scope = globalThis }: { scope?: JiniHostGlobalScope } = {}): JiniHostBridge | null {
  const candidate = { value: candidateFromScope(scope) };
  return isJiniHostBridge(candidate) ? candidate.value : null;
}

export function isJiniHostAvailable(_requiredArgs: Record<string, never>, { scope = globalThis }: { scope?: JiniHostGlobalScope } = {}): boolean {
  return getJiniHost({}, { scope }) != null;
}

export function detectJiniHostClientType(_requiredArgs: Record<string, never>, { scope = globalThis }: { scope?: JiniHostGlobalScope } = {}): JiniHostClientType | 'web' {
  return getJiniHost({}, { scope })?.client.type ?? 'web';
}

function unavailable(reason = 'jini host is not available'): JiniHostFailure {
  return failure(reason);
}

export async function openHostExternalUrl({ url }: { url: string }, { scope = globalThis }: { scope?: JiniHostGlobalScope } = {}): Promise<JiniHostActionResult> {
  const host = getJiniHost({}, { scope });
  if (host == null) return unavailable();
  try {
    return await host.shell.openExternal({ url });
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function openHostPath({ path }: { path: string }, { scope = globalThis }: { scope?: JiniHostGlobalScope } = {}): Promise<JiniHostActionResult> {
  const host = getJiniHost({}, { scope });
  if (host == null) return unavailable();
  try {
    return await host.shell.openPath({ path });
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function checkJiniHostUpdaterAvailability(_requiredArgs: Record<string, never>, { scope = globalThis }: { scope?: JiniHostGlobalScope } = {}
): Promise<JiniHostUpdaterAvailability | JiniHostFailure> {
  const host = getJiniHost({}, { scope });
  if (host == null) return unavailable();
  if (host.updater == null) return unavailable('host build does not support the updater extension point');
  try {
    return await host.updater.checkAvailability();
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}
