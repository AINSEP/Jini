/** Compile-time contract checks for the agent vocabulary: a failure here is a `tsc` error, not a test run. */
import type { AgentLaunchResolution, ProviderModelsQuery, RuntimeAgentDef, RuntimeEnv } from '../index.js';
import { RuntimeSelectionError } from '../index.js';

/** A definition written from core alone: another runtime can implement the contract without `@jini-ai/agent-runtime`. */
export const fixtureDef: RuntimeAgentDef = {
  id: 'fixture', name: 'Fixture', bin: 'fixture', versionArgs: ['--version'], fallbackModels: [{ id: 'default', label: 'Default' }],
  buildArgs: ({ prompt }, { options = {} } = {}) => [prompt, ...(options.filesystemRoot ? ['--root', options.filesystemRoot] : [])],
  streamFormat: 'plain',
};

/** `RuntimeEnv` and Node's `ProcessEnv` assign both ways, so no host needs a cast at the boundary. */
export function envRoundTrip(required: { processEnv: NodeJS.ProcessEnv; runtimeEnv: RuntimeEnv }, _optional: Record<string, never> = {}): { toRuntime: RuntimeEnv; toProcess: NodeJS.ProcessEnv } {
  return { toRuntime: required.processEnv, toProcess: required.runtimeEnv };
}

/** The launch resolution is stated field by field; it no longer depends on a runtime function's return type. */
export const unresolvedLaunch: AgentLaunchResolution = {
  configuredOverridePath: null, pathResolvedPath: null, selectedPath: null,
  launchPath: null, launchKind: 'selected', childPathPrepend: [], diagnostic: null,
};

// @ts-expect-error a universal contract carries no transport-only key (the undici dispatcher stays in the runtime).
export const queryWithDispatcher: ProviderModelsQuery = { protocol: 'openai', baseUrl: 'https://example.test', apiKey: 'k', requestInit: {} };

/** The error class is a value, so a launcher and a runtime share one identity for `instanceof`. */
export const refusal: Error = new RuntimeSelectionError('refused');
