import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import type { createRevisionThinning } from '../../../posts/revision-thinning.js';

export interface RevisionThinningPreviewDeps {
  principal: string;
  scope: { workspaceId: string; postId: string; kind: string };
  thinning: ReturnType<typeof createRevisionThinning>;
  authorize: (required: { principal: string; scope: { workspaceId: string; postId: string; kind: string } }, optional: Record<string, never>) => Promise<void>;
  readOlderThan: (required: { body: unknown }) => number;
}
export interface RevisionThinningApplyDeps extends Omit<RevisionThinningPreviewDeps, 'readOlderThan'> {
  readApply: (required: { body: unknown }) => { previewToken: string; confirm: boolean };
}

export function createRevisionThinningRoutes({ paths }: { paths: { preview: string; apply: string } }, _optional = {}) {
  return {
    preview: defineJsonRoute<{ body: unknown }, object, RevisionThinningPreviewDeps>({
      method: 'post', path: paths.preview, parse: raw => ok({ value: { body: raw.body } }),
      handle: async ({ input, deps }) => {
        await deps.authorize({ principal: deps.principal, scope: deps.scope }, {});
        return ok({ value: await deps.thinning.preview({ principal: deps.principal, scope: deps.scope, olderThan: deps.readOlderThan(input) }, {}) });
      },
    }, { requireSameOrigin: true }),
    apply: defineJsonRoute<{ body: unknown }, object, RevisionThinningApplyDeps>({
      method: 'post', path: paths.apply, parse: raw => ok({ value: { body: raw.body } }),
      handle: async ({ input, deps }) => {
        await deps.authorize({ principal: deps.principal, scope: deps.scope }, {});
        return ok({ value: await deps.thinning.apply({ ...deps.readApply(input), principal: deps.principal, scope: deps.scope }, {}) });
      },
    }, { requireSameOrigin: true }),
  };
}
