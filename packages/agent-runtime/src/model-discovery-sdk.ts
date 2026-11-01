import type { ModelDiscoveryContext, ModelDiscoveryDeps, ModelProbeResult } from './model-discovery-types.js';
import { ModelProbeError, modelIdentityKind } from './model-discovery-shared.js';

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
