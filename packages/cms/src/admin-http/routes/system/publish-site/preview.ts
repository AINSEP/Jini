import { ToolInputError } from '@jini-ai/core';
import { defineJsonRoute, ok } from '@jini-ai/core/contracts/server';
import { rejectRoute } from '@jini-ai/core/errors/route-refusal';

import { authorizePublish, type PublishSitePrincipal } from './shared.js';

/**
 * @file `GET .../system/publish/preview` — the same reads the chat publish preview performs (the
 * registry's plan, local credential readiness, the authenticated provider inspection), as one HTTP
 * read. No export runs. The query is the host's to judge (which config fields a target takes is the
 * registry's call), so the spec passes it through; a missing/invalid part comes back as a refusal
 * message and answers a flat `400`.
 */

/** The host's preview verdict: the preview body, or the 400 message for a malformed query. */
export type PublishPreviewResult = { ok: true; value: Readonly<Record<string, unknown>> } | { ok: false; error: string };
/** The host's preview read for this workspace. */
export type PublishPreviewFn = (required: { query: Readonly<Record<string, unknown>> }) => Promise<PublishPreviewResult>;

/** The deps this route reads. */
export interface PublishPreviewRouteDeps {
  workspaceId: string;
  previewPublish: PublishPreviewFn;
}

/**
 * The preview body, or the refusal. A provider inspection that rejects the caller's input (a stale
 * connection id) is a `400` with `PROVIDER_INSPECTION_FAILED`, not a 500; anything else is rethrown
 * for the host's redacted 500 (the DB-backed credential read can reach a real backing store).
 * @complexity O(1) plus the injected preview.
 */
async function readPreview({ deps, query }: { deps: PublishPreviewRouteDeps; query: Readonly<Record<string, unknown>> }, _optional: Record<string, never> = {}) {
  try {
    const result = await deps.previewPublish({ query });
    if (!result.ok) rejectRoute({ status: 400, error: result.error });
    return result.value;
  } catch (err) {
    if (err instanceof ToolInputError) rejectRoute({ status: 400, error: err.message, code: 'PROVIDER_INSPECTION_FAILED' });
    throw err;
  }
}

/** `GET .../system/publish/preview`: the preview for the queried target and config. */
export const publishPreviewRoute = defineJsonRoute<{ query: Readonly<Record<string, unknown>> }, Readonly<Record<string, unknown>>, PublishPreviewRouteDeps, PublishSitePrincipal>({
  method: 'get',
  path: '/api/admin/v1/workspaces/:workspaceId/system/publish/preview',
  parse: (raw) => ok({ value: { query: raw.query } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizePublish({ authorize, permission: 'system.read' });
    return ok({ value: await readPreview({ deps, query: input.query }) });
  },
});
