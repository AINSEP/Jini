import { AdminApiError } from '../../core/transport/errors.js';
import type { AdminRedirect, AdminRedirectCreateInput, AdminRedirectHitStats, AdminRedirectImportResult, AdminRedirectsPort } from '../../core/ports/redirects.js';
/** Presentation backend, not a routing engine: host validators/origin policy remain server owned.
 * Optional validation lets a host model its own open match vocabulary without a second schema.
 * @example createMemoryRedirectsApi({ redirects: [] }, {});
 */
export function createMemoryRedirectsApi(
  { redirects = [], hits = {} }: { redirects?: readonly AdminRedirect[]; hits?: Readonly<Record<string, AdminRedirectHitStats>> },
  { validate, onImport }: {
    validate?: (input: AdminRedirectCreateInput) => void;
    onImport?: (rules: readonly AdminRedirectCreateInput[]) => AdminRedirectImportResult | undefined;
  } = {},
): AdminRedirectsPort {
  const rows = new Map(redirects.map(row => [row.id, Object.freeze({ ...row })]));
  const stats = new Map(Object.entries(hits).map(([id, value]) => [id, Object.freeze({ ...value })]));
  let nextId = 1;
  function get(id: string): AdminRedirect {
    const row = rows.get(id);
    if (!row) throw new AdminApiError({ message: `redirect '${id}' was not found`, status: 404 }, { code: 'REDIRECT_NOT_FOUND' });
    return row;
  }
  function create(input: AdminRedirectCreateInput, source: 'manual' | 'import'): AdminRedirect {
    // The core port documents reference-host rejection. A supplied validator owns alternate hosts.
    if (validate) validate(input);
    else if (input.matchType === 'regex') throw new AdminApiError({ message: 'regex match type is not supported', status: 400 }, { code: 'REDIRECT_VALIDATION_ERROR' });
    let id: string;
    do { id = `memory-redirect-${nextId++}`; } while (rows.has(id));
    const row: AdminRedirect = Object.freeze({ ...input, id, status: 'active', override: input.override ?? false,
      priority: input.priority ?? 0, source, sourceEntryId: null, fromPathAtCapture: null, toPathAtCapture: null,
      createdByPrincipal: 'memory-principal', createdByPluginId: null,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), version: 1 });
    rows.set(id, row);
    return row;
  }
  return {
    async listRedirects(_required, filter = {}) {
      return Object.freeze([...rows.values()].filter(row =>
        (filter.status === undefined || row.status === filter.status) &&
        (filter.source === undefined || row.source === filter.source) &&
        (filter.matchType === undefined || row.matchType === filter.matchType)));
    },
    async getRedirect({ id }) { return get(id); },
    async createRedirect(input, options = {}) { return create({ ...input, ...options }, 'manual'); },
    async updateRedirect({ id }, patch = {}) {
      const before = get(id);
      const next = { ...before, ...patch };
      if (validate) validate(next);
      else if (patch.matchType === 'regex') throw new AdminApiError({ message: 'regex match type is not supported', status: 400 }, { code: 'REDIRECT_VALIDATION_ERROR' });
      const row = Object.freeze({ ...next, version: before.version + 1 });
      rows.set(id, row);
      return row;
    },
    async tombstoneRedirect({ id }) {
      const row = get(id);
      if (row.status === 'disabled') return row;
      const disabled = Object.freeze({ ...row, status: 'disabled', version: row.version + 1 });
      rows.set(id, disabled);
      return disabled;
    },
    async getRedirectHitStats({ id }) {
      get(id);
      return stats.get(id) ?? Object.freeze({ redirectId: id, hitCount: 0, lastHitAt: null });
    },
    async importRedirects({ rules }) {
      const overridden = onImport?.(rules);
      if (overridden) return overridden;
      const created: AdminRedirect[] = [], failed: AdminRedirectImportResult['failed'][number][] = [];
      // One failed item never discards successful siblings; no per-item network I/O.
      for (const [index, input] of rules.entries()) {
        try { created.push(create(input, 'import')); }
        catch (error) {
          failed.push({ index, code: error instanceof AdminApiError ? error.code ?? 'INTERNAL_ERROR' : 'INTERNAL_ERROR',
            message: error instanceof AdminApiError ? error.message : 'an internal error occurred' });
        }
      }
      return { created: Object.freeze(created), failed: Object.freeze(failed) };
    },
  };
}
