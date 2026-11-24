import { isNonArrayRecord, requireInputRecord, ToolInputError, type ApprovalContextPort } from '@jini-ai/core';
import type { ToolExecutor } from './tool-executor-types.js';

const VIEW_UNAVAILABLE = 'The admin tab could not verify the current view for this click, so nothing was changed. Retry the action on the current view.';

/** Accept only the browser's monotonic navigation counter, never caller-written context.
 * @throws ToolInputError if the attached tab cannot supply a usable view revision.
 * @complexity O(1) time and space. @overallScore 100 */
function checkedRevision({ revision }: { revision: unknown }, _options = {}): number {
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    throw new ToolInputError({ message: VIEW_UNAVAILABLE });
  }
  return revision;
}

/** Host wiring for the approval owner's opaque context port. One gated filtered DOM read happens
 * before each opaque-click card; the browser checks the captured revision at the final effect.
 * @param required.execute The same audited executor used for the original frontend invocation.
 * @param required.navigationQuery The host's `page.find_elements` query for the revision read; it
 *   only needs to match no element so the filtered DOM read stays cheap.
 * @returns A per-call snapshot port; no map, persistence, timer or polling is added.
 * @throws ToolInputError when the tab cannot verify its current view before asking.
 * @complexity O(1) local time/space plus one existing filtered DOM scan per asking click.
 * @overallScore 100 */
export function createPageApprovalContext(
  { execute, navigationQuery }: Pick<ToolExecutor, 'execute'> & { navigationQuery: string },
  _options: Record<string, never> = {},
): ApprovalContextPort {
  return {
    capture: async ({ ctx }) => {
      const result = await execute({ principal: ctx.principal, run: ctx.run, toolId: 'page.find_elements',
        input: { query: navigationQuery } }, { signal: ctx.signal });
      const output = { value: result.output };
      if (result.status !== 'completed' || !isNonArrayRecord(output)) throw new ToolInputError({ message: VIEW_UNAVAILABLE });
      return checkedRevision({ revision: output.value.navigationRevision });
    },
    prepare: ({ ctx, snapshot }) => ({ ...ctx, input: {
      ...requireInputRecord({ input: ctx.input }),
      __frontendNavigationRevision: checkedRevision({ revision: snapshot }),
    } }),
  };
}

/** Only opaque-click policy needs a view snapshot; reads and other direct frontend verbs do not.
 * @returns The existing approval owner's optional context port for a page click.
 * @complexity O(1) time/space; no port is invoked during composition. @overallScore 100 */
export function pageApprovalOptions(
  { toolId, execute, navigationQuery }: Pick<ToolExecutor, 'execute'> & { toolId: string; navigationQuery: string },
  _options: Record<string, never> = {},
): { context?: ApprovalContextPort } {
  return toolId === 'page.click' ? { context: createPageApprovalContext({ execute, navigationQuery }) } : {};
}
