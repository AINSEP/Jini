import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';

// The command owns orchestration and reporting; guard behavior has real fixture suites.
vi.mock('node:fs', () => ({ readFileSync: () => '{"violations":[]}' }));
vi.mock('../check-agentic-dom-purity.js', () => ({ checkAgenticDomPurity: () => [] }));
vi.mock('../check-chatpane-public-surface.js', () => ({ checkChatPanePublicSurface: () => [] }));
vi.mock('../check-driver-isolation.js', () => ({ checkDriverIsolation: () => [] }));
vi.mock('../check-hardwiring.js', () => ({ checkHardwiring: () => [] }));
vi.mock('../check-engine-boundaries.js', () => ({ checkEngineBoundaries: () => [] }));
vi.mock('../check-extensionless-imports.js', () => ({ checkExtensionlessImports: () => [] }));
vi.mock('../check-model-fallback-freshness.js', () => ({ checkModelFallbackFreshness: () => [] }));
vi.mock('../check-protocol-purity.js', () => ({ checkProtocolPurity: () => [] }));
vi.mock('../check-package-layers.js', () => ({ checkPackageLayers: () => [] }));
vi.mock('../check-subpath-isolation.js', () => ({ checkSubpathIsolation: () => [] }));
vi.mock('../lib/source-neutrality.js', () => ({ checkSourceNeutrality: () => [] }));
vi.mock('../lib/publish-hygiene-self-test.js', () => ({ runPublishHygieneSelfTest: () => [] }));
vi.mock('../lib/self-test.js', () => ({ runGuardSelfTest: () => [] }));

afterEach(() => vi.restoreAllMocks());

it('reports success when the command finds no drift against an empty baseline', async () => {
  const originalArgv = process.argv;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('unexpected process exit'); });
  process.argv = [process.execPath, fileURLToPath(new URL('../check-guard-drift.ts', import.meta.url))];
  try {
    await import('../check-guard-drift.js');
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(
      '[guard:drift] ok — 0 new guard violations (0 total, 0 in baseline).',
    ));
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  } finally {
    process.argv = originalArgv;
  }
});
