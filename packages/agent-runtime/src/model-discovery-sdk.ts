import type { ModelDiscoveryContext, ModelDiscoveryDeps, ModelProbeResult } from './model-discovery-types.js';
import { ModelProbeError, modelIdentityKind } from './model-discovery.js';

/** UNVERIFIED locally. The host may install the official SDK or inject the RPC port.
 * Use the CLI's authenticated server, not an unrelated HTTP token or an inference prompt.
 * https://github.com/github/copilot-sdk/blob/main/nodejs/src/client.ts */
interface CopilotMetadataClient {
  start(): Promise<unknown>;
  listModels(): Promise<{ id: string; name?: string }[]>;
  forceStop(): Promise<unknown>;
}
export async function probeCopilotSdk(context: ModelDiscoveryContext, signal: AbortSignal, optional: { createClient?: (context: ModelDiscoveryContext) => Promise<CopilotMetadataClient> } = {}): Promise<ModelProbeResult> {
  const client = await (optional.createClient ?? createCopilotMetadataClient)(context);
  if (signal.aborted) { await client.forceStop().catch(() => {}); throw new ModelProbeError('timeout'); }
  const stop = () => { void Promise.resolve(client.forceStop()).catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    await client.start();
    if (signal.aborted) throw new ModelProbeError('timeout');
    const rows = await client.listModels();
    return { models: rows.map((row) => ({ id: row.id, label: row.name || row.id, identityKind: modelIdentityKind(row.id) })), source: 'rpc', coverage: 'account' };
  } finally {
    signal.removeEventListener('abort', stop);
    // forceStop also closes the child when a failed handshake never reached connected state.
    await client.forceStop().catch(() => {});
  }
}
async function createCopilotMetadataClient(context: ModelDiscoveryContext): Promise<CopilotMetadataClient> {
  const packageName = '@github/copilot-sdk';
  const sdk = await import(packageName);
  const env = Object.fromEntries(Object.entries(context.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  // RuntimeConnection is the current SDK API; older SDKs expose cliPath/cwd/useStdio.
  const connection = sdk.RuntimeConnection?.forStdio({ path: context.executable, env });
  return new sdk.CopilotClient(connection
    ? { connection, workingDirectory: context.cwd, autoRestart: false }
    : { cliPath: context.executable, cwd: context.cwd, env, useStdio: true, autoRestart: false });
}

/** UNVERIFIED locally. Official Python SDK metadata bridge; no session/inference call.
 * SDK installation belongs to the host's Python environment.
 * https://docs.factory.com/sdk/python#discover-available-models */
const DROID_METADATA_SCRIPT = `import asyncio, json, os, sys
from droid_sdk import Runtime, list_models
async def main():
    rows = await list_models(cwd=os.getcwd(), runtime=Runtime(executable=sys.argv[1]))
    print(json.dumps({"models": [{"id": m.id, "name": m.display_name, "provider": str(m.provider)} for m in rows if not m.disabled]}))
asyncio.run(main())
`;

export async function probeDroidSdk(context: ModelDiscoveryContext, deps: ModelDiscoveryDeps, signal: AbortSignal): Promise<ModelProbeResult> {
  const { stdout } = await deps.process.run({ context: { ...context, executable: 'python3' }, args: ['-c', DROID_METADATA_SCRIPT, context.executable], stdin: '', signal, timeoutMs: 15_000, terminateProcessTree: true });
  let data: { models?: { id: string; name?: string; provider?: string }[] };
  try { data = JSON.parse(stdout); } catch { throw new ModelProbeError('malformed-response'); }
  if (!Array.isArray(data.models)) throw new ModelProbeError('malformed-response');
  return { models: data.models.filter((row) => typeof row.id === 'string').map((row) => ({ id: row.id, label: row.name || row.id, provider: row.provider, identityKind: modelIdentityKind(row.id) })), source: 'rpc', coverage: 'account' };
}
