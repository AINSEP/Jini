// The barrel itself has no test-suite call sites (every other test in this
// feature imports its target module directly, per the vertical-slice
// convention), so it was never actually exercised by the rest of the suite.
// This is the smoke test proving the public surface a host actually imports
// (`from '@injini/ui'` → this file) really re-exports what `source-map.md`
// documents, not just that each underlying module compiles on its own.
import { describe, expect, it } from 'vitest';
import * as SourceConfigListFeature from './index.js';

describe('source-config-list barrel (index.ts)', () => {
  it('re-exports constants', () => {
    expect(SourceConfigListFeature.MASK_CHAR).toBe('•');
    expect(typeof SourceConfigListFeature.MASKED_VALUE_VISIBLE_SUFFIX_LENGTH).toBe('number');
    expect(typeof SourceConfigListFeature.MASKED_VALUE_MIN_MASK_LENGTH).toBe('number');
  });

  it('re-exports rules', () => {
    expect(typeof SourceConfigListFeature.validateSourceDraft).toBe('function');
    expect(typeof SourceConfigListFeature.maskFieldValue).toBe('function');
    expect(typeof SourceConfigListFeature.sourceDisplayLabel).toBe('function');
    expect(typeof SourceConfigListFeature.upsertSourceById).toBe('function');
    expect(typeof SourceConfigListFeature.removeSourceById).toBe('function');
    expect(typeof SourceConfigListFeature.updateSourceById).toBe('function');
    expect(typeof SourceConfigListFeature.pendingActionKey).toBe('function');
    expect(typeof SourceConfigListFeature.isActionPending).toBe('function');
    expect(typeof SourceConfigListFeature.withPendingAction).toBe('function');
    expect(typeof SourceConfigListFeature.withoutPendingAction).toBe('function');
    expect(typeof SourceConfigListFeature.emptySourceDraft).toBe('function');
    expect(typeof SourceConfigListFeature.issueForField).toBe('function');
  });

  it('re-exports dependencies + fakes', () => {
    expect(typeof SourceConfigListFeature.createFakeSourceConfigPort).toBe('function');
    expect(typeof SourceConfigListFeature.createFakeSourceConfigDependencies).toBe('function');
  });

  it('re-exports hooks, including the wired variants', () => {
    expect(typeof SourceConfigListFeature.useSourceConfigList).toBe('function');
    expect(typeof SourceConfigListFeature.useWiredSourceConfigList).toBe('function');
    expect(typeof SourceConfigListFeature.useSourceConfigAddForm).toBe('function');
    expect(typeof SourceConfigListFeature.useWiredSourceConfigAddForm).toBe('function');
  });

  it('re-exports every component, including the orchestrator', () => {
    expect(typeof SourceConfigListFeature.SourceConfigField).toBe('function');
    expect(typeof SourceConfigListFeature.SourceConfigTestControl).toBe('function');
    expect(typeof SourceConfigListFeature.SourceConfigAddForm).toBe('function');
    expect(typeof SourceConfigListFeature.SourceConfigItemCard).toBe('function');
    expect(typeof SourceConfigListFeature.SourceConfigListView).toBe('function');
    expect(typeof SourceConfigListFeature.SourceConfigList).toBe('function');
  });
});
