/** Access removal stops the admitted answer; it cannot undo tools that already completed. */
export interface ToolAccessChange {
  readonly agentIds?: readonly string[];
  readonly serverIds?: readonly string[];
  readonly pluginIds?: readonly string[];
}
export interface ToolAccessRun {
  readonly runId: string;
  readonly agentId: string;
  readonly serverIds?: readonly string[];
  readonly pluginIds?: readonly string[];
}
export interface ToolAccessStopResult {
  readonly stoppedRunIds: readonly string[];
  readonly failedRunIds: readonly string[];
}

function intersects(left: readonly string[] = [], right: readonly string[] = []): boolean {
  return left.some(id => right.includes(id));
}

/** Match launch snapshots, so a source change leaves answers without that source running. */
export function runAffectedByToolAccessChange({ run, change }: { run: ToolAccessRun; change: ToolAccessChange }, _optional = {}): boolean {
  return change.agentIds?.includes(run.agentId) === true || intersects(run.serverIds, change.serverIds) || intersects(run.pluginIds?.map(id => id.replace(/-/g, '_')), change.pluginIds?.map(id => id.replace(/-/g, '_')));
}

/** Stream delivery is best effort and must not delay cancellation or cleanup. */
function emitStopNotice(notice: (required: { runId: string; message: string }) => Promise<void>, required: { runId: string; message: string }): void {
  try { void notice(required).catch(() => {}); } catch { /* A closed stream cannot prevent Stop. */ }
}

/** Revoke all selected credentials synchronously before any cancellation can yield.
 * Hosts fence credential remint in revoke and supply the existing Stop/cleanup and notice paths.
 * Cleanup failures remain visible; raw exception text never enters a chat notice.
 * @complexity O(r * s) matching run snapshots against changed source IDs; no polling or storage.
 */
export async function stopRunsForToolAccessChange({ runs, change, revoke, cancel, waitForCleanup, notice }: {
  runs: readonly ToolAccessRun[]; change: ToolAccessChange;
  revoke: (required: { runId: string }) => void;
  cancel: (required: { runId: string }) => Promise<void>;
  waitForCleanup: (required: { runId: string }) => Promise<void>;
  notice: (required: { runId: string; message: string }) => Promise<void>;
}, _optional = {}): Promise<ToolAccessStopResult> {
  const affected = runs.filter(run => runAffectedByToolAccessChange({ run, change }));
  for (const run of affected) revoke({ runId: run.runId });
  const outcomes = await Promise.all(affected.map(async ({ runId }) => {
    try {
      emitStopNotice(notice, { runId, message: 'Stopped because tool access changed.' });
      await cancel({ runId });
      await waitForCleanup({ runId });
      return true;
    } catch {
      emitStopNotice(notice, { runId, message: "Couldn't stop everything the agent started after tool access changed." });
      return false;
    }
  }));
  return {
    stoppedRunIds: affected.filter((_, index) => outcomes[index]).map(run => run.runId),
    failedRunIds: affected.filter((_, index) => !outcomes[index]).map(run => run.runId),
  };
}

function provisioningPlugin(tool: { readonly metadata?: { readonly mcpSource?: { readonly pluginId?: string } } }): string | undefined {
  return tool.metadata?.mcpSource?.pluginId;
}

/** Recover source IDs from the existing tool namespace contracts; no configuration is read.
 * Federation IDs cannot contain underscores; plugin IDs use the registry's hyphen folding.
 * @complexity O(t) descriptor pass with duplicate source IDs collapsed in insertion order.
 */
export function admittedToolSources({ tools }: { tools: readonly { readonly id: string; readonly metadata?: { readonly mcpSource?: { readonly id: string; readonly host: string; readonly pluginId?: string } } }[] }, _optional = {}): {
  serverIds: readonly string[]; pluginIds: readonly string[];
} {
  const serverIds = new Set<string>();
  const pluginIds = new Set<string>();
  for (const tool of tools) {
    const { id } = tool;
    const owner = provisioningPlugin(tool);
    if (owner) pluginIds.add(owner);
    const server = /^mcp__([^_]+)__/.exec(id)?.[1];
    if (server) serverIds.add(server);
    const plugin = /^(?:agent_plugin_|plugin_capability_)(.+)$/.exec(id)?.[1] ?? /^p_(.+?)__/.exec(id)?.[1];
    if (plugin) pluginIds.add(plugin.replace(/_/g, '-'));
  }
  return { serverIds: [...serverIds], pluginIds: [...pluginIds] };
}
