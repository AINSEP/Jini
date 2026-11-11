/**
 * @file Every memoised `create*Module(ports)` returns ONE instance per ports object (built once, so its
 * per-host state/queues are shared) and a DIFFERENT instance for different ports (no cross-host
 * leakage). Closes the Stryker run-2 `if (!instance) { instance = buildModule(ports) … }` survivors
 * (pattern 2) in all 13 memoised lifecycle modules.
 */
import { describe, expect, test } from 'vitest';
import { createActivationModule } from '../../activation.js';
import { createBundledDigestsModule } from '../../bundled-digests.js';
import { createBundledSourceArchiveModule } from '../../bundled-source-archive.js';
import { createCapabilityProjectionModule } from '../../capability-projection.js';
import { createInstallModule } from '../../install.js';
import { createPackagePathsModule } from '../../package-paths.js';
import { createResolveAgentPluginRefsModule } from '../../resolve-agent-plugin-refs.js';
import { createRetireBundledModule } from '../../retire-bundled.js';
import { createSearchModule } from '../../search.js';
import { createSeedBundledModule } from '../../seed-bundled.js';
import { createSetEnabledModule } from '../../set-enabled.js';
import { createTrustedPluginFilesModule } from '../../trusted-plugin-files.js';
import { createUninstallModule } from '../../uninstall.js';
import type { AgentPluginLifecyclePorts } from '../../ports.js';
import { ports } from '../test-support.js';

const factories: ReadonlyArray<[string, (ports: AgentPluginLifecyclePorts) => object]> = [
  ['activation', createActivationModule], ['bundled-digests', createBundledDigestsModule],
  ['bundled-source-archive', createBundledSourceArchiveModule], ['capability-projection', createCapabilityProjectionModule],
  ['install', createInstallModule], ['package-paths', createPackagePathsModule],
  ['resolve-agent-plugin-refs', createResolveAgentPluginRefsModule], ['retire-bundled', createRetireBundledModule],
  ['search', createSearchModule], ['seed-bundled', createSeedBundledModule], ['set-enabled', createSetEnabledModule],
  ['trusted-plugin-files', createTrustedPluginFilesModule], ['uninstall', createUninstallModule],
];

describe('memoised lifecycle modules', () => {
  test.each(factories)('%s: same ports -> the same instance; other ports -> a different one', (_name, create) => {
    const own: AgentPluginLifecyclePorts = { ...ports };
    const other: AgentPluginLifecyclePorts = { ...ports };
    const first = create(own);
    expect(create(own)).toBe(first);
    expect(create(other)).not.toBe(first);
    expect(create(other)).toBe(create(other));
  });
});
