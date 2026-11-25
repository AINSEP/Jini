/** A fake of `AgentRuntimePort` for launcher tests: every member records its call (`calls`) and returns a plain
 * default. It implements the interface only; it never imports `@jini-ai/agent-runtime`. Override a group by spreading. */
import type { RuntimeAgentDef, RuntimeCapabilityMap } from '@jini-ai/core/contracts/agents';
import type { AgentRuntimePort, AgentStreamHandler } from '../agent-runtime.js';
import type { AcpSessionController, PiRpcSession } from '../agent-runtime-sessions.js';

export interface FakeAgentRuntimeCall { readonly member: string; readonly required: unknown; readonly optional: unknown }
export interface FakeAgentRuntimePort extends AgentRuntimePort { readonly calls: FakeAgentRuntimeCall[] }

/** A definition with no flags: `buildArgs` returns the prompt, so a test can see what reached the child's argv. */
export function fakeAgentDef(required: { id: string }, optional: Partial<RuntimeAgentDef> = {}): RuntimeAgentDef {
  return { id: required.id, name: required.id, bin: required.id, versionArgs: ['--version'], fallbackModels: [],
    buildArgs: ({ prompt }) => [prompt], streamFormat: 'plain', ...optional };
}

const idleStream = (): AgentStreamHandler => ({ feed: () => {}, flush: () => {} });

function fakeDefsAndLaunch(log: (member: string, required: unknown, optional?: unknown) => void, capabilities: Map<string, RuntimeCapabilityMap>): Pick<AgentRuntimePort, 'defs' | 'launch'> {
  return {
    defs: {
      get(required) { log('defs.get', required); return fakeAgentDef({ id: required.id }); },
      bind(required) { log('defs.bind', required); return required.def; },
      capabilities(required) { log('defs.capabilities', required); return capabilities.get(required.defId); },
      async ensureCapabilities(required) { log('defs.ensureCapabilities', required); },
    },
    launch: {
      resolve(required, optional) {
        log('launch.resolve', required, optional);
        const path = `/fake/bin/${required.def.bin}`;
        return { configuredOverridePath: null, pathResolvedPath: path, selectedPath: path, launchPath: path, launchKind: 'selected', childPathPrepend: ['/fake/bin'], diagnostic: null };
      },
      applyEnv(required, optional) { log('launch.applyEnv', required, optional); return { ...required.env }; },
      toolchainBinDirs(required, optional) { log('launch.toolchainBinDirs', required, optional); return []; },
      hostEnvNames() { log('launch.hostEnvNames', undefined); return []; },
      planRun(required) { log('launch.planRun', required); return { verdict: 'RUN', loadsOwn: false, bridged: false }; },
      resolveNativeToolPolicy(required) { log('launch.resolveNativeToolPolicy', required); return required.policy; },
      promptArgvBudget(required, optional) { log('launch.promptArgvBudget', required, optional); return null; },
      windowsCmdShimBudget(required) { log('launch.windowsCmdShimBudget', required); return null; },
      windowsDirectExeBudget(required) { log('launch.windowsDirectExeBudget', required); return null; },
      async preparePromptFile(required) { log('launch.preparePromptFile', required); return null; },
      async prepareLogFile(required) { log('launch.prepareLogFile', required); return null; },
    },
  };
}

function fakeFilesystemAndModels(log: (member: string, required: unknown, optional?: unknown) => void): Pick<AgentRuntimePort, 'filesystem' | 'models'> {
  return {
    filesystem: {
      validateLaunch(required) { log('filesystem.validateLaunch', required); return required.filesystemRoot; },
      validateReadOnlyExtraDirs(required, optional) { log('filesystem.validateReadOnlyExtraDirs', required, optional); return [...required.dirs]; },
      async assertSupport(required) { log('filesystem.assertSupport', required); return true; },
      createSupportProbe() { log('filesystem.createSupportProbe', undefined); return async (required) => { log('filesystem.supportProbe', required); return true; }; },
      runtimePaths(required) { log('filesystem.runtimePaths', required); return [required.launchPath]; },
      settings(required, optional) { log('filesystem.settings', required, optional); return '{}'; },
    },
    models: {
      async resolveForLaunch(required, optional) {
        log('models.resolveForLaunch', required, optional);
        const model = required.context.model ?? 'fake-model';
        return { model, resolution: { status: 'resolved', id: model, source: 'offline-fallback', resolvedAt: '1970-01-01T00:00:00.000Z', launchFingerprint: 'fake' },
          catalog: { models: [], source: 'offline-fallback', freshness: 'offline-fallback', fetchedAt: '1970-01-01T00:00:00.000Z', expiresAt: '1970-01-01T00:00:00.000Z', coverage: 'configured', launchFingerprint: 'fake', diagnostics: [] } };
      },
      identityKind(required) { log('models.identityKind', required); return 'concrete'; },
    },
  };
}

/** Sessions have no neutral default: a test that reaches one must supply it, and the error says which. */
function unsupplied(member: string): never {
  throw new Error(`fakeAgentRuntimePort: ${member} was called but the test supplied no session. Pass { sessions: { ... } } to fakeAgentRuntimePort.`);
}

export function fakeAgentRuntimePort(_required: Record<string, never> = {}, optional: Partial<AgentRuntimePort> & { capabilities?: Map<string, RuntimeCapabilityMap> } = {}): FakeAgentRuntimePort {
  const calls: FakeAgentRuntimeCall[] = [];
  const log = (member: string, required: unknown, opt?: unknown): void => { calls.push({ member, required, optional: opt }); };
  const { capabilities = new Map<string, RuntimeCapabilityMap>(), ...overrides } = optional;
  return {
    calls,
    ...fakeDefsAndLaunch(log, capabilities),
    ...fakeFilesystemAndModels(log),
    sessions: {
      attachAcp(required, opt): AcpSessionController { log('sessions.attachAcp', required, opt); return unsupplied('sessions.attachAcp'); },
      attachPiRpc(required, opt): PiRpcSession { log('sessions.attachPiRpc', required, opt); return unsupplied('sessions.attachPiRpc'); },
    },
    streams: {
      claude(required, opt) { log('streams.claude', required, opt); return idleStream(); },
      qoder(required) { log('streams.qoder', required); return idleStream(); },
      jsonEvents(required) { log('streams.jsonEvents', required); return idleStream(); },
    },
    strategies: { for(required) { log('strategies.for', required); return {}; } },
    failures: { startupMessage(required, opt) { log('failures.startupMessage', required, opt); return `${required.stage}: ${String(required.error)}`; } },
    ...overrides,
  };
}
