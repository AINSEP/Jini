/**
 * @module active-context
 *
 * Generic "what resource is the caller currently focused on?" channel: an
 * in-memory, TTL-scoped pointer a client POSTs to record its current focus
 * and GETs to read back (resolved against a real display name via an
 * injected lookup). Ported from the routes-classification table's
 * `active-context.ts` MIXED row (see `source-map.md`) — the origin's only
 * real coupling was `handleGetActive` calling into an OD project store to
 * resolve a display name; the TTL store and both handlers were already
 * product-neutral, and all handlers are synchronous (no async risk).
 *
 * The origin's `projectId`/`fileName` fields are generalized here to a
 * single opaque `resourceRef` (was `projectId`) plus an optional `detail`
 * string (was `fileName` — a sub-locator within that resource), matching
 * the source-map's own "renaming to a generic resource ref" note. The
 * origin's `deps.getProject` lookup becomes an injected `resolveResource`
 * dependency, matching this branch's DI convention (see
 * `daemon-status.ts`/`host-tools.ts`: real collaborators supplied by the
 * caller rather than read from a global store).
 */
import type { Express } from 'express';
import { createApiError } from '@injini/protocol';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { err, ok, type Result } from './types.js';

/** How long a recorded focus stays valid before a GET treats it as stale and clears it. */
export const ACTIVE_CONTEXT_TTL_MS = 5 * 60 * 1000;

interface ActiveContext {
  resourceRef: string;
  detail: string | null;
  ts: number;
}

interface ActiveContextStore {
  current: ActiveContext | null;
}

type SetActiveInput = { kind: 'clear' } | { kind: 'set'; resourceRef: string; detail: string | null };

type SetActiveOutput =
  | { active: false }
  | { active: true; resourceRef: string; detail: string | null; ts: number };

type GetActiveOutput =
  | { active: false }
  | {
      active: true;
      resourceRef: string;
      resourceName: string | null;
      detail: string | null;
      ts: number;
      ageMs: number;
    };

/** A resolved resource's display name. `resolveResource` itself may return `null`/`undefined` (not this type) when the caller has no entry at all for a given resource ref (e.g. unknown or deleted). */
export interface ActiveContextResource {
  readonly name?: string | null;
}

/** What a caller must supply to mount the active-context routes. */
export interface ActiveContextDeps {
  /**
   * Resolves a display name for a resource ref (was OD's project store's
   * `getProject`). Injected so this module has no dependency on any
   * particular resource store; may return `null`/`undefined` if the ref is
   * unknown.
   */
  resolveResource: (resourceRef: string) => ActiveContextResource | null | undefined;
  /** Returns the current time in epoch ms. Defaults to `Date.now` when omitted. */
  now?: () => number;
}

/**
 * Internal deps threaded to both handlers: the caller-supplied
 * {@link ActiveContextDeps} plus the shared in-memory store built once per
 * `registerActiveContextRoutes` call, so the two routes see the same state.
 */
interface ActiveContextRouteDeps {
  store: ActiveContextStore;
  resolveResource: ActiveContextDeps['resolveResource'];
  now: () => number;
}

function parseSetActive(raw: { body: unknown }): Result<SetActiveInput> {
  const body = (raw.body ?? {}) as Record<string, unknown>;
  if (body.active === false) {
    return ok({ kind: 'clear' });
  }
  const resourceRef = typeof body.resourceRef === 'string' ? body.resourceRef : '';
  if (!resourceRef) {
    return err(createApiError('BAD_REQUEST', 'resourceRef is required'));
  }
  const detail = typeof body.detail === 'string' && body.detail.length > 0 ? body.detail : null;
  return ok({ kind: 'set', resourceRef, detail });
}

function handleSetActive(input: SetActiveInput, deps: ActiveContextRouteDeps): Result<SetActiveOutput> {
  if (input.kind === 'clear') {
    deps.store.current = null;
    return ok({ active: false });
  }
  const next: ActiveContext = { resourceRef: input.resourceRef, detail: input.detail, ts: deps.now() };
  deps.store.current = next;
  return ok({ active: true, ...next });
}

function handleGetActive(_input: void, deps: ActiveContextRouteDeps): Result<GetActiveOutput> {
  const current = deps.store.current;
  if (!current || deps.now() - current.ts > ACTIVE_CONTEXT_TTL_MS) {
    deps.store.current = null;
    return ok({ active: false });
  }
  const resource = deps.resolveResource(current.resourceRef);
  return ok({
    active: true,
    resourceRef: current.resourceRef,
    resourceName: resource?.name ?? null,
    detail: current.detail,
    ts: current.ts,
    ageMs: deps.now() - current.ts,
  });
}

/**
 * `POST /api/active` — records (or, with `{active: false}`, clears) the
 * caller's current resource focus.
 */
export const setActiveRoute = defineJsonRoute<SetActiveInput, SetActiveOutput, ActiveContextRouteDeps>({
  method: 'post',
  path: '/api/active',
  requireSameOrigin: true,
  parse: parseSetActive,
  handle: handleSetActive,
});

/**
 * `GET /api/active` — reads back the current resource focus, resolving a
 * display name for it, or `{active: false}` if nothing is set or the
 * recorded focus has aged past {@link ACTIVE_CONTEXT_TTL_MS}.
 */
export const getActiveRoute = defineJsonRoute<void, GetActiveOutput, ActiveContextRouteDeps>({
  method: 'get',
  path: '/api/active',
  requireSameOrigin: true,
  parse: () => ok(undefined),
  handle: handleGetActive,
});

/** Mounts both active-context routes on `app`, sharing one in-memory store between them. A pack's `http(app, services)` calls this directly. */
export function registerActiveContextRoutes(app: Express, deps: ActiveContextDeps, adapter: AdapterContext): void {
  const store: ActiveContextStore = { current: null };
  const routeDeps: ActiveContextRouteDeps = {
    store,
    resolveResource: deps.resolveResource,
    now: deps.now ?? (() => Date.now()),
  };
  mountJsonRoute(app, setActiveRoute, routeDeps, adapter);
  mountJsonRoute(app, getActiveRoute, routeDeps, adapter);
}
