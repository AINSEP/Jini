import { defineJsonRoute, err, ok } from '@jini-ai/core/contracts/server';

export function createStorageRoutes({ paths }: { paths: { report: string; cleanup: string } }, _optional = {}) {
  return {
    report: defineJsonRoute<Record<string, never>, object, { measure: (required: Record<string, never>, optional: Record<string, never>) => Promise<object> }>({
      method: 'get', path: paths.report, parse: () => ok({ value: {} }),
      handle: async ({ deps, authorize }) => {
        await authorize!({ permission: 'storage.manage' });
        return ok({ value: await deps.measure({}, {}) });
      },
    }),
    cleanup: defineJsonRoute<{ dryRun?: boolean; classes?: string[] }, object, {
      runOnce: (required: { dryRun: boolean; classes?: string[] }, optional: Record<string, never>) => Promise<object>;
      copy: { invalidClass: string };
    }>({
      method: 'post', path: paths.cleanup,
      parse: raw => ok({ value: (raw.body ?? {}) as { dryRun?: boolean; classes?: string[] } }),
      handle: async ({ input, deps, authorize }) => {
        await authorize!({ permission: 'storage.manage' });
        if (input.classes?.some(kind => !['cache', 'derived', 'old-copy'].includes(kind))) return err({ error: { code: 'INVALID_INPUT', message: deps.copy.invalidClass } });
        // Measurement describes what exists; a sweep separately reports what it actually freed.
        return ok({ value: await deps.runOnce({ dryRun: input.dryRun !== false, ...(input.classes === undefined ? {} : { classes: input.classes }) }, {}) });
      },
    }, { requireSameOrigin: true }),
  };
}
