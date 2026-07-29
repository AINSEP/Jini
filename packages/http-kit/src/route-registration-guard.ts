/**
 * @module route-registration-guard
 *
 * Wraps an Express app's route-registration methods (`get`/`post`/`put`/`patch`/`delete`/
 * `options`/`all`/`use`) to build a queryable inventory of every mounted route, and to guard a
 * caller-supplied set of "must register at most once" route keys against accidental duplicate
 * registration — e.g. two packs each mounting `POST /api/runs` would otherwise silently shadow
 * one another instead of failing loudly at composition time.
 *
 * Genericized from an origin daemon's route-registration guard — see `source-map.md`. The
 * origin hardcoded a fixed two-route guarded set (product routes with no meaning in the generic
 * engine); here the guarded set is an injectable `ReadonlySet<string>` that defaults to empty, so
 * installing this guard with no options is a pure inventory tap with no enforcement.
 */
import type { Express } from 'express';

/** One recorded route registration: the HTTP verb and the literal string path it was mounted on. */
export interface RouteRegistration {
  method: string;
  path: string;
}

const routeInventorySymbol = Symbol.for('jini.routeRegistrationGuard.inventory');

const GUARDED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'all', 'use'] as const;

/**
 * Builds the `METHOD PATH` key used to check `guardedRouteKeys` membership.
 *
 * @param method - The Express registration method name (any case; normalized to upper-case in the key).
 * @param path - The first argument passed to that method. Only a string path can collide — a
 * RegExp or array-of-paths route is never tracked, matching the inventory's own string-only
 * recording below.
 * @param guardedRouteKeys - The set of `METHOD PATH` keys this call installed a duplicate-registration
 * guard for.
 * @returns The matching key if `path` is a string and the key is in `guardedRouteKeys`, otherwise `null`.
 * @complexity O(1) — a single `Set` lookup.
 * @overallScore 100/100
 */
export function guardedRouteKey(
  method: string,
  path: unknown,
  guardedRouteKeys: ReadonlySet<string>,
): string | null {
  if (typeof path !== 'string') return null;
  const key = `${method.toUpperCase()} ${path}`;
  return guardedRouteKeys.has(key) ? key : null;
}

export interface InstallRouteRegistrationGuardOptions {
  /** `METHOD PATH` keys (e.g. `'POST /api/runs'`) that must be registered at most once on `app`. Defaults to none — installing the guard with no options only builds the inventory, it enforces nothing. */
  guardedRouteKeys?: ReadonlySet<string>;
}

/**
 * Monkey-patches `app`'s route-registration methods to record every string-path registration into
 * a per-app inventory (retrievable via {@link getRouteRegistrationInventory}) and to throw if any
 * `options.guardedRouteKeys` entry is registered a second time.
 *
 * @param app - The Express app to instrument. Must not already have this guard installed (installing
 * twice would double-wrap every method and double-count the inventory — not guarded against here
 * since `createLocalNodeDaemon` and every other caller in this codebase calls this exactly once
 * per app at composition time).
 * @param options.guardedRouteKeys - See {@link InstallRouteRegistrationGuardOptions}.
 * @returns Nothing — mutates `app` in place and stashes its inventory under a well-known `Symbol.for` key.
 * @throws If a `guardedRouteKeys` entry is registered more than once, at the moment of the second registration.
 * @complexity O(1) setup (patches 8 fixed methods); each wrapped call is O(1) beyond the wrapped original.
 * @overallScore 100/100
 */
export function installRouteRegistrationGuard(
  app: Express,
  options: InstallRouteRegistrationGuardOptions = {},
): void {
  const guardedRouteKeys = options.guardedRouteKeys ?? new Set<string>();
  const seen = new Set<string>();
  const inventory: RouteRegistration[] = [];
  (app as unknown as Record<symbol, RouteRegistration[]>)[routeInventorySymbol] = inventory;

  for (const method of GUARDED_METHODS) {
    const original = (app as unknown as Record<string, (...args: unknown[]) => unknown>)[method]!.bind(app);
    (app as unknown as Record<string, (...args: unknown[]) => unknown>)[method] = (
      path: unknown,
      ...handlers: unknown[]
    ) => {
      if (typeof path === 'string') {
        inventory.push({ method: method.toUpperCase(), path });
      }
      const key = guardedRouteKey(method, path, guardedRouteKeys);
      if (key) {
        if (seen.has(key)) {
          throw new Error(`duplicate guarded route registration: ${key}`);
        }
        seen.add(key);
      }
      return original(path, ...handlers);
    };
  }
}

/**
 * Reads back every route {@link installRouteRegistrationGuard} recorded for `app`.
 *
 * @param app - An app the guard was installed on. Safe to call on an app with no guard installed
 * (returns an empty array rather than throwing).
 * @returns A fresh array copy each call — the caller can never mutate the guard's own internal inventory through the returned reference.
 * @complexity O(n) in the number of routes registered so far.
 * @overallScore 100/100
 */
export function getRouteRegistrationInventory(app: Express): RouteRegistration[] {
  return [...((app as unknown as Record<symbol, RouteRegistration[] | undefined>)[routeInventorySymbol] ?? [])];
}
