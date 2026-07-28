// The barrel itself has no test-suite call sites (every other test in this
// feature imports its target module directly, per the vertical-slice
// convention), so it was never actually exercised by the rest of the suite.
// This is the smoke test proving the public surface a host actually imports
// (`from '@injini/ui'` → this file) really re-exports what `source-map.md`
// documents, not just that each underlying module compiles on its own.
import { describe, expect, it } from 'vitest';
import * as SketchEditorFeature from '../index.js';

describe('sketch-editor barrel (index.ts)', () => {
  it('re-exports constants', () => {
    expect(SketchEditorFeature.SAVED_VISIBLE_MS).toBe(2000);
    expect(SketchEditorFeature.EXPORTED_IMAGE_MIME_TYPE).toBe('image/png');
    expect(SketchEditorFeature.DEFAULT_MERMAID_INSERT_LABEL_PATTERN).toBeInstanceOf(RegExp);
  });

  it('re-exports rules', () => {
    expect(typeof SketchEditorFeature.sketchSceneHasContent).toBe('function');
    expect(typeof SketchEditorFeature.exportedImageFileName).toBe('function');
  });

  it('re-exports the DOM toolkit', () => {
    expect(typeof SketchEditorFeature.applySketchEditorTooltips).toBe('function');
    expect(typeof SketchEditorFeature.clampSketchContextPopover).toBe('function');
  });

  it('re-exports dependencies + fakes', () => {
    expect(SketchEditorFeature.defaultSketchEditorDependencies).toBeDefined();
    expect(typeof SketchEditorFeature.createFakeSketchEditorDependencies).toBe('function');
  });

  it('re-exports hooks, including the wired one', () => {
    expect(typeof SketchEditorFeature.useSketchTheme).toBe('function');
    expect(typeof SketchEditorFeature.useSketchScene).toBe('function');
    expect(typeof SketchEditorFeature.useSketchSaveWorkflow).toBe('function');
    expect(typeof SketchEditorFeature.useWiredSketchSaveWorkflow).toBe('function');
    expect(typeof SketchEditorFeature.useSketchDomEnhancements).toBe('function');
  });

  it('re-exports components', () => {
    expect(typeof SketchEditorFeature.SketchEditor).toBe('function');
    expect(typeof SketchEditorFeature.SketchMainMenu).toBe('function');
    expect(typeof SketchEditorFeature.SketchSaveStateBadge).toBe('function');
  });
});
