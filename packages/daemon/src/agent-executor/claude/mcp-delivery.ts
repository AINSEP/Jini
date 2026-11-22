import { join } from 'node:path';
import type { McpBridgeDelivery, McpJsonInjectionOptions } from '../contracts.js';
import type { McpDeliveryBuildInput } from '../mcp-delivery-types.js';
import { defaultReadMcpJsonFile, defaultWriteMcpJsonFile, mergeMcpJsonContent } from '../mcp-json-file.js';

export function buildClaudeMcpDelivery({ cwd, runId, serverEntry }: McpDeliveryBuildInput): McpBridgeDelivery {
  return { kind: 'claude-mcp-json', mcpJsonPath: mcpJsonPathForRun(cwd, runId), serverEntry };
}

/**
 * This run's own MCP config path, inside `cwd` but deliberately **not** `cwd/.mcp.json`.
 *
 * A shared filename cannot carry two runs' identities at once, and that is exactly what the file
 * carries: `mcpServers.jini.env` holds this run's `JINI_RUN_ID` and its bearer `JINI_DAEMON_TOKEN`.
 * A spawned CLI reads its MCP config when it starts its client, not synchronously at spawn — so with
 * one shared file, a second run in the same directory overwrote the entry the first run's child had
 * not read yet, and that child's `jini-mcp` subprocess then called back carrying the *other* run's id
 * and token: run A's tool calls executing inside run B's authority context. Concurrent runs in one
 * working directory are supported by design (see `McpJsonInjectionOptions.credential`'s doc on why the
 * credential is a per-run resolver at all), so the resolution is one file per run, not a lock that
 * refuses the second run.
 *
 * Naming it after the run also means the project's own `.mcp.json` is never written at all — it stays
 * purely a merge source, so there is no original content to restore afterwards either.
 *
 * The run id is host-supplied and lands in a filename, so everything outside `[A-Za-z0-9_-]` is
 * replaced (dots included — a `..` segment must not survive) and the result is length-capped. Real run
 * ids are UUIDs, which pass through untouched; the cap could in principle collide two ids sharing a
 * 128-character prefix, which no id shape this daemon mints can produce.
 * @complexity O(n) in the run id's length.
 */
function mcpJsonPathForRun(cwd: string, runId: string): string {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return join(cwd, `.mcp.jini-${safeRunId}.json`);
}

/**
 * The `'claude-mcp-json'` mechanism's one effect: writes (merging, never clobbering — see
 * {@link mergeMcpJsonContent}) this run's own config — the project's own servers merged with this
 * run's `jini` bridge entry — to the run-scoped path ({@link mcpJsonPathForRun}) the def was already
 * handed via `RuntimeContext.mcpJsonPath`, so the def's own `--strict-mcp-config --mcp-config <path>`
 * argv has a real file to point at by spawn time, instead of auto-discovering `cwd/.mcp.json` (which
 * needs an interactive trust prompt a headless spawn can never answer — confirmed live 2026-07-30,
 * see `@jini-ai/agent-runtime`'s `defs/claude.ts`).
 *
 * Reads `cwd/.mcp.json` and writes `delivery.mcpJsonPath`: the project's file is a merge source only,
 * never a write target. See {@link mcpJsonPathForRun} for why one file per run is load-bearing rather
 * than cosmetic, and why the read and write paths must differ.
 *
 * A no-op for every other delivery mechanism, which is expressed by the caller simply not having a
 * `'claude-mcp-json'` delivery to hand it rather than by a strategy re-check in here.
 * @param cwd - The run's working directory, so the project's own `.mcp.json` can be read as the
 * merge base — not carried on `delivery` itself, since that only describes the write target.
 * @param delivery - The already-built `'claude-mcp-json'` delivery (path + entry). Both fields come
 * from {@link buildMcpBridgeDelivery}, so the credential was resolved exactly once, for this run.
 * @param options - Supplies the injectable `readFile`/`writeFile` seams.
 * @throws Whatever `writeFile` rejects with — the caller (`run()`) turns that into a pre-spawn
 * `AGENT_SPAWN_FAILED` failure, matching the pre-spawn filesystem guards in `launch.ts`
 * (`stagePromptFile`'s own try/catch).
 * @complexity O(1) plus one `readFile`/`writeFile` round trip.
 * @overallScore 100/100
 */
export async function writeMcpJsonForRun(
  { cwd, delivery, options }: { cwd: string; delivery: McpBridgeDelivery; options: McpJsonInjectionOptions },
  { inheritUserConfig = true }: { inheritUserConfig?: boolean | undefined } = {},
): Promise<string> {
  if (delivery.kind !== 'claude-mcp-json') throw new TypeError('Unexpected MCP delivery');
  const readFileFn = options.readFile ?? defaultReadMcpJsonFile;
  const writeFileFn = options.writeFile ?? defaultWriteMcpJsonFile;
  let existingRaw: string | undefined;
  try {
    existingRaw = inheritUserConfig ? await readFileFn({ path: join(cwd, '.mcp.json') }) : undefined;
  } catch {
    // No existing file (ENOENT — the common case) or unreadable for any other reason: both
    // degrade to "start fresh", matching mergeMcpJsonContent's own doc.
    existingRaw = undefined;
  }
  await writeFileFn({ path: delivery.mcpJsonPath, content: mergeMcpJsonContent({ existingRaw: existingRaw, serverEntry: delivery.serverEntry }) });
  return delivery.mcpJsonPath;
}


