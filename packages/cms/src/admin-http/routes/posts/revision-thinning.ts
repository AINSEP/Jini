import { defineJsonRoute, ok, type JsonRouteSpec } from '@jini-ai/core/contracts/server';
import type { createRevisionThinning } from '../../../posts/revision-thinning.js';

type PreviewResult = Awaited<ReturnType<ReturnType<typeof createRevisionThinning>['preview']>>;
type ApplyResult = Awaited<ReturnType<ReturnType<typeof createRevisionThinning>['apply']>>;

export interface RevisionThinningPreviewDeps<Context> {
  resolve: (required: { context: Context | undefined; selection: { postId: unknown; kind: unknown; params: Record<string, string> } }, optional: Record<string, never>) => Promise<{ principal: string; scope: { workspaceId: string; postId: string; kind: string } }>;
  refuse: (required: { error: unknown }, optional: Record<string, never>) => never;
  readOlderThan: (required: { body: unknown }) => number;
  preview: (required: { principal: string; scope: { workspaceId: string; postId: string; kind: string }; before: number }, optional: Record<string, never>) => Promise<PreviewResult>;
}
export interface RevisionThinningApplyDeps<Context> extends Pick<RevisionThinningPreviewDeps<Context>, 'resolve' | 'refuse'> {
  readApply: (required: { body: unknown }) => { previewToken: string; confirm: unknown };
  missingTokenError: unknown;
  confirmationError: unknown;
  apply: (required: { principal: string; scope: { workspaceId: string; postId: string; kind: string }; previewToken: string; confirm: boolean }, optional: Record<string, never>) => Promise<ApplyResult>;
}

export function createRevisionThinningRoutes<Context>({ paths }: { paths: { preview: string; apply: string } }, _optional = {}): {
  preview: JsonRouteSpec<{ body: unknown; selection: Parameters<RevisionThinningPreviewDeps<Context>['resolve']>[0]['selection'] }, PreviewResult, RevisionThinningPreviewDeps<Context>, Context>;
  apply: JsonRouteSpec<{ body: unknown; selection: Parameters<RevisionThinningApplyDeps<Context>['resolve']>[0]['selection'] }, ApplyResult, RevisionThinningApplyDeps<Context>, Context>;
} {
  return {
    preview: defineJsonRoute<{ body: unknown; selection: Parameters<RevisionThinningPreviewDeps<Context>['resolve']>[0]['selection'] }, PreviewResult, RevisionThinningPreviewDeps<Context>, Context>({
      method: 'post', path: paths.preview, parse: raw => {
        const body = raw.body as { postId?: unknown; kind?: unknown } | null | undefined;
        return ok({ value: { body: raw.body, selection: { postId: body?.postId, kind: body?.kind, params: raw.params } } });
      },
      handle: async ({ input, deps, context }) => {
        try {
          const { principal, scope } = await deps.resolve({ context, selection: input.selection }, {});
          return ok({ value: await deps.preview({ principal, scope, before: deps.readOlderThan(input) }, {}) });
        } catch (error) { return deps.refuse({ error }, {}); }
      },
    }, { requireSameOrigin: true }),
    apply: defineJsonRoute<{ body: unknown; selection: Parameters<RevisionThinningApplyDeps<Context>['resolve']>[0]['selection'] }, ApplyResult, RevisionThinningApplyDeps<Context>, Context>({
      method: 'post', path: paths.apply, parse: raw => {
        const body = raw.body as { postId?: unknown; kind?: unknown } | null | undefined;
        return ok({ value: { body: raw.body, selection: { postId: body?.postId, kind: body?.kind, params: raw.params } } });
      },
      handle: async ({ input, deps, context }) => {
        try {
          const { principal, scope } = await deps.resolve({ context, selection: input.selection }, {});
          const { previewToken, confirm } = deps.readApply(input);
          if (!previewToken) throw deps.missingTokenError;
          if (confirm !== true) throw deps.confirmationError;
          return ok({ value: await deps.apply({ principal, scope, previewToken, confirm }, {}) });
        } catch (error) { return deps.refuse({ error }, {}); }
      },
    }, { requireSameOrigin: true }),
  };
}
