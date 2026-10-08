import { runTier2Call as run } from '../../worker/run-call.js';
import type { Tier2Request } from '../../worker/protocol.js';
import { pluginSdkBinding, createInvocationCoreDeps } from './fixture-bindings.js';
export function runTier2Call(required: { request: Tier2Request; importModule: (entryPath: string) => Promise<unknown> }, optional = {}) {
  return run({ ...required, pluginSdkBinding, createInvocationCoreDeps,
    importModule: async ({ modulePath }) => ({ exported: (await required.importModule(modulePath) as { default?: unknown } | null)?.default }),
  }, optional);
}
