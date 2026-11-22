import { describe, expect, it } from 'vitest';
import { CONSENT_PREVIEW_DESKTOP_WIDTH, consentPreviewScale } from '../preview-scale.js';

describe('consentPreviewScale', () => {
  it('lays Desktop out above the engine phone breakpoint (480px) and fits it to the pane', () => {
    expect(CONSENT_PREVIEW_DESKTOP_WIDTH).toBeGreaterThan(480);
    expect(consentPreviewScale({ paneWidth: CONSENT_PREVIEW_DESKTOP_WIDTH / 2 })).toBe(0.5);
  });

  it('never enlarges, and an unmeasured pane keeps the natural size', () => {
    expect(consentPreviewScale({ paneWidth: CONSENT_PREVIEW_DESKTOP_WIDTH * 2 })).toBe(1);
    expect(consentPreviewScale({ paneWidth: 0 })).toBe(1);
  });
});
