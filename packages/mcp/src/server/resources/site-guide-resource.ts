import type { McpResourceDef } from '../resource-protocol.js';
import { createExecuteReadonlyDelegatedToolTool, type CreateExecuteDelegatedToolToolOptions } from '../tools/delegated-tool.js';

/** Expose a host's learning tool as an attachable resource through the EXISTING read-only gateway.
 * The run identity is host-bound; bearer headers, cancellation and authorization follow the same
 * path as tools/call. No direct registry read or privileged principal is introduced.
 * @param input - The spawning run id, never supplied by the MCP client.
 * @returns jini://site-guide, with a fresh permission-scoped overview on every read.
 * @throws When the host lacks site_guide, authorization denies, or execution does not complete.
 * @complexity O(1) plus one delegated read and result serialization.
 * @example createSiteGuideResource({ runId });
 */
export function createSiteGuideResource(input: { readonly runId: string }, options: CreateExecuteDelegatedToolToolOptions = {}): McpResourceDef {
  const gateway = createExecuteReadonlyDelegatedToolTool(input, options);
  return {
    uri: 'jini://site-guide', name: 'How this site works', mimeType: 'application/json',
    description: 'Permission-filtered building blocks and live facts for the site hosting this run. Consult before planning or building; use site_guide explain through the delegated gateway for details.',
    read: async ({ ctx }) => {
      const result = await gateway.handler({ args: { toolId: 'site_guide', input: { operation: 'overview' } }, ctx });
      const completed = typeof result === 'object' && result !== null && 'status' in result && result.status === 'completed';
      if (!completed || !('output' in result)) {
        throw new Error('site_guide resource read did not complete. Use the delegated tool result to inspect authorization or availability.');
      }
      return { text: JSON.stringify(result.output, null, 2) };
    },
  };
}
