/**
 * Each of these defs wires its own static `fallbackModels` list into `createAgentModelDiscovery`.
 * Driven through the def's real `discoverModels` port with every probe offline, the catalog must be
 * exactly that def's own list (normalized), marked offline, so a swapped or stale lambda fails here.
 */
import { describe, expect, it } from 'vitest';
import { normalizeDiscoveredModels } from '../../model-discovery.js';
import { ampAgentDef } from '../amp.js';
import { auggieAgentDef } from '../auggie.js';
import { clineAgentDef } from '../cline.js';
import { copilotAgentDef } from '../copilot.js';
import { crushAgentDef } from '../crush.js';
import { deepseekAgentDef } from '../deepseek.js';
import { droidAgentDef } from '../droid.js';
import { gooseAgentDef } from '../goose.js';
import { grokBuildAgentDef } from '../grok-build.js';
import { hermesAgentDef } from '../hermes.js';
import { kiloAgentDef } from '../kilo.js';
import { kimiAgentDef } from '../kimi.js';
import { discoveryContext, offlineDiscoveryDeps } from './discovery-fakes.js';

const defs = [ampAgentDef, auggieAgentDef, clineAgentDef, copilotAgentDef, crushAgentDef, deepseekAgentDef, droidAgentDef,
  gooseAgentDef, grokBuildAgentDef, hermesAgentDef, kiloAgentDef, kimiAgentDef];

describe('offline discovery falls back to each def\'s own static model list', () => {
  it.each(defs.map((def) => [def.id, def] as const))('%s', async (_id, def) => {
    expect(def.fallbackModels.length).toBeGreaterThan(0);
    const catalog = await def.discoverModels({ context: discoveryContext }, { deps: offlineDiscoveryDeps() });
    expect(catalog.freshness).toBe('offline-fallback');
    expect(catalog.source).toBe('offline-fallback');
    expect(catalog.models).toEqual(normalizeDiscoveredModels(def.fallbackModels));
  });
});
