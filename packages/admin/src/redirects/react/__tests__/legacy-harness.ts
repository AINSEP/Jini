/** Test-only bridge preserving the source suites' calls/assertions while exercising Jini owners.
 * Legacy envelopes, mutable fake rows and physical removal are fixture contracts, not public APIs.
 */
import { createElement } from 'react';
import type { AdminRedirect, AdminRedirectCreateInput, AdminRedirectHitStats, AdminRedirectImportResult, AdminRedirectsPort } from '../../../core/ports/redirects.js';
import { AdminApiError } from '../../../core/transport/errors.js';
import { createHttpRedirectsApi } from '../../adapters/http.js';
import { createMemoryRedirectsApi } from '../../adapters/memory.js';
import { useRedirects as useCoreRedirects } from '../hooks/use-redirects.hooks.js';
import { useHitCountCell as useCoreHitCountCell } from '../hooks/use-hit-count-cell.hooks.js';
import { useImportRedirectsForm as useCoreImportRedirectsForm } from '../hooks/use-import-redirects-form.hooks.js';
import { RedirectsPage } from '../pages/RedirectsPage.js';
import { RedirectsPortsContext } from '../hooks/RedirectsPorts.hooks.js';
import { RedirectsOptionsContext } from '../hooks/RedirectsOptions.hooks.js';
import type { RedirectsTranslate } from '../../models.js';
import * as rules from '../../rules.js';
export type LegacyRedirect = Omit<AdminRedirect, 'statusCode'> & { workspaceId?: string; statusCode: number };
export type RedirectImportRule = Omit<AdminRedirectCreateInput, 'statusCode'> & { statusCode: number };
interface LegacyApi {
  listRedirects(): Promise<{ data: LegacyRedirect[] }>;
  createRedirect(input: RedirectImportRule, options?: { override?: boolean; priority?: number }): Promise<{ data: LegacyRedirect }>;
  updateRedirect(target: { id: string }, patch?: Record<string, unknown>): Promise<{ data: LegacyRedirect }>;
  tombstoneRedirect(id: string): Promise<{ data: LegacyRedirect }>;
  getRedirectHits(id: string): Promise<{ data: AdminRedirectHitStats & { workspaceId?: string } }>;
  importRedirects(rules: RedirectImportRule[]): Promise<AdminRedirectImportResult>;
}
function asCore(port: LegacyApi): AdminRedirectsPort {
  return {
    listRedirects: async () => (await port.listRedirects()).data as AdminRedirect[],
    getRedirect: async ({ id }) => (await port.listRedirects()).data.find(row => row.id === id)! as AdminRedirect,
    createRedirect: async (input, options) => (await (options === undefined ? port.createRedirect(input) : port.createRedirect(input, options))).data as AdminRedirect,
    updateRedirect: async (target, patch) => (await port.updateRedirect(target, patch === undefined ? undefined : { ...patch })).data as AdminRedirect,
    tombstoneRedirect: async ({ id }) => (await port.tombstoneRedirect(id)).data as AdminRedirect,
    getRedirectHitStats: async ({ id }) => (await port.getRedirectHits(id)).data,
    importRedirects: ({ rules }) => port.importRedirects(rules as RedirectImportRule[]),
  };
}
// Cache adapter identity per fixture, so controller lifetimes don't restart on every render.
const corePorts = new WeakMap<LegacyApi, AdminRedirectsPort>();
function corePort(port: LegacyApi): AdminRedirectsPort {
  let core = corePorts.get(port);
  if (!core) { core = asCore(port); corePorts.set(port, core); }
  return core;
}
const http = createHttpRedirectsApi({ basePath: '/api/admin/v1/workspaces/workspace-local/redirects', transport: {
  url: ({ path }) => path,
  async request<T>({ path, method, body }: { path: string; method: string; body?: unknown }): Promise<T> {
    const response = await globalThis.fetch(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new AdminApiError({ message: value.error ?? 'request failed', status: response.status });
    return value as T;
  },
} }, {});
export const defaultRedirectsPort: LegacyApi = {
  listRedirects: async () => ({ data: await http.listRedirects({}) as LegacyRedirect[] }),
  createRedirect: async (input, options) => ({ data: await http.createRedirect(input as AdminRedirectCreateInput, options) as LegacyRedirect }),
  updateRedirect: async (target, patch) => ({ data: await http.updateRedirect(target, patch) as LegacyRedirect }),
  tombstoneRedirect: async id => ({ data: await http.tombstoneRedirect({ id }) as LegacyRedirect }),
  getRedirectHits: async id => ({ data: await http.getRedirectHitStats({ id }) }),
  importRedirects: rules => http.importRedirects({ rules: rules as AdminRedirectCreateInput[] }),
};
export function createFakeRedirectsPort(options: { redirects?: LegacyRedirect[]; hits?: Record<string, AdminRedirectHitStats & { workspaceId?: string }>; onImport?: (rules: RedirectImportRule[]) => AdminRedirectImportResult | undefined } = {}): LegacyApi & { rules: LegacyRedirect[] } {
  const rows = [...options.redirects ?? []];
  function memory() {
    return createMemoryRedirectsApi({ redirects: rows as AdminRedirect[], hits: options.hits ?? {} }, {
      ...(options.onImport ? { onImport: batch => options.onImport!(batch as RedirectImportRule[]) } : {}),
    });
  }
  function legacy(row: AdminRedirect): LegacyRedirect { return { ...row, workspaceId: 'fake-ws' }; }
  return {
    rules: rows,
    async listRedirects() { return { data: [...await memory().listRedirects({})] as LegacyRedirect[] }; },
    async createRedirect(input, opts) {
      const row = legacy(await memory().createRedirect(input as AdminRedirectCreateInput, opts));
      rows.push(row); return { data: row };
    },
    async updateRedirect(target, patch = {}) {
      const index = rows.findIndex(row => row.id === target.id);
      const row = await memory().updateRedirect(target, patch);
      // The original fake only changes supplied fields; retain that fixture contract verbatim.
      const updated = { ...rows[index]!, ...patch, id: row.id } as LegacyRedirect;
      rows[index] = updated; return { data: updated };
    },
    async tombstoneRedirect(id) {
      await memory().tombstoneRedirect({ id });
      // Original fake physically removes rows. Only this test bridge retains that old contract.
      const index = rows.findIndex(row => row.id === id);
      return { data: rows.splice(index, 1)[0]! };
    },
    async getRedirectHits(id) {
      // The original fake permits a hits-only seed. Seed its otherwise implicit rule in memory.
      const synthetic = { id, matchType: 'exact', fromPattern: '/fixture', toTarget: '/destination', statusCode: 301,
        status: 'active', override: false, priority: 0, source: 'manual', sourceEntryId: null,
        fromPathAtCapture: null, toPathAtCapture: null, createdByPrincipal: 'fixture', createdByPluginId: null,
        createdAt: '', updatedAt: '', version: 1 } as AdminRedirect;
      const api = createMemoryRedirectsApi({ redirects: rows.some(row => row.id === id) ? rows as AdminRedirect[] : [synthetic], hits: options.hits ?? {} });
      return { data: await api.getRedirectHitStats({ id }) };
    },
    async importRedirects(batch) {
      const result = await memory().importRedirects({ rules: batch as AdminRedirectCreateInput[] });
      rows.push(...result.created.map(legacy));
      return result;
    },
  };
}
const listeners = new Set<() => void>();
const events = { subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
export function publishContentRefresh(resources?: string[]) {
  if (resources && !resources.includes(rules.REDIRECTS_RESOURCE)) return;
  for (const listener of listeners) listener();
}
export function resetContentRefreshBus() { listeners.clear(); }
export function useRedirects(port: LegacyApi, t: RedirectsTranslate, locale: string) {
  const state = useCoreRedirects({ api: corePort(port) }, { t, locale, events });
  return { ...state,
    onToggleStatus: (rule: LegacyRedirect) => state.onToggleStatus(rule as AdminRedirect),
    onRequestDelete: (rule: LegacyRedirect) => state.onRequestDelete(rule as AdminRedirect),
  };
}
export function useWiredRedirects() { return useRedirects(defaultRedirectsPort, key => key, 'en'); }
export function useHitCountCell(props: { redirectId: string }, port: LegacyApi, t: RedirectsTranslate) {
  return useCoreHitCountCell({ ...props, api: corePort(port) }, { t });
}
export function useWiredHitCountCell(props: { redirectId: string; t: RedirectsTranslate }) { return useHitCountCell(props, defaultRedirectsPort, props.t); }
export function useImportRedirectsForm(port: LegacyApi, t: RedirectsTranslate, locale: string) {
  return useCoreImportRedirectsForm({ api: corePort(port) }, { t, locale });
}
export function useWiredImportRedirectsForm({ t, locale }: { t: RedirectsTranslate; locale: string }) { return useImportRedirectsForm(defaultRedirectsPort, t, locale); }
export function Redirects({ useRedirectsHook }: { useRedirectsHook?: typeof useWiredRedirects } = {}) {
  // Publish is a host-supplied slot; the old host button's tests stay in the host.
  return createElement(RedirectsPortsContext.Provider, { value: { redirectsApi: corePort(defaultRedirectsPort) } },
    createElement(RedirectsOptionsContext.Provider, { value: { headerActions: createElement('button', { type: 'button' }, 'Publish redirects') } },
      createElement<import('../pages/RedirectsPage.js').RedirectsProps>(RedirectsPage, useRedirectsHook ? { useRedirectsHook } : {})));
}
