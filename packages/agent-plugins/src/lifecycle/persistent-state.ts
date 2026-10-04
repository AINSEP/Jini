import { createPluginMemory, migratePluginLayout, assertPluginStatePath, withPluginStateLock } from '../../persistent-state.js';
import { withFileLock } from '@jini-ai/platform/fs/file-lock';
import { createPackagePathsModule } from './package-paths.js';
import { parseAgentPluginManifest } from './manifest.js';
import type { AgentPluginLifecyclePorts } from './ports.js';

/** Reuses the platform lock with injected effects, never age-stealing a living migration. */
export function createPersistentStateModule(ports: AgentPluginLifecyclePorts, _optional: Record<string, never> = {}) {
  const { assertContainedOnDisk } = createPackagePathsModule(ports);
  const effects = {
    filesystem: ports.filesystem,
    contain: ({ root, entryPath }: { root: string; entryPath: string }) => assertContainedOnDisk(root, entryPath),
    withLock: <T>({ lockPath, run }: { lockPath: string; run(): Promise<T> }) => withFileLock({ lockPath, run }, {
      filesystem: ports.filesystem, clock: ports.clock, process: ports.process,
      hostname: () => ports.process.hostname({}), token: () => ports.ids.newId(),
      monotonicMs: () => ports.clock.monotonicMs(), sleep: ({ durationMs }) => ports.clock.sleep({ ms: durationMs }),
      staleMs: Infinity, createParent: true,
    }),
  };
  return {
    withPluginLock: <T>(required: { workspaceRoot: string; pluginId: string; run(): Promise<T> }, optional = {}) => withPluginStateLock({ ...effects, ...required }, optional),
    memory: (required: { workspaceRoot: string; pluginId: string }, optional = {}) => createPluginMemory({ ...effects, ...required }, optional),
    assertOwnedPath: (required: { workspaceRoot: string; entryPath: string }, optional = {}) => assertPluginStatePath({ ...effects, ...required }, optional),
    migrate: (required: { workspaceRoot: string }, optional = {}) => migratePluginLayout({ ...effects, ...required,
      parsePluginId: ({ value }) => {
        const parsed = parseAgentPluginManifest({ value });
        if (!parsed.ok) throw new Error(parsed.errors.join('; '));
        return parsed.manifest.name;
      }, ...(ports.onEvent ? { onEvent: ports.onEvent } : {}),
    }, optional),
  };
}
