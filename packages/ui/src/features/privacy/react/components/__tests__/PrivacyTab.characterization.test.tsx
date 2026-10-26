import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import type { PrivacyConsentState } from '../../../types.js';
import { PrivacyTab, type PrivacyTabLabels } from '../PrivacyTab.js';

const COPY = {
  consentKicker: 'Help improve this product',
  consentLead: 'Choose what you share. You can change this anytime.',
  consentFooter: 'Nothing is shared unless you opt in.',
  metricsLabel: 'Anonymous metrics',
  metricsHint: 'Feature usage and performance data, with no personal content.',
  contentLabel: 'Conversation and tool content',
  contentHint: 'Helps improve model quality. Off by default.',
  installationIdLabel: 'Installation ID',
  installationIdHint: 'An anonymous id used to group your shared data.',
  optedOutLabel: 'Not sharing',
  deleteMyDataLabel: 'Delete my data',
} satisfies Required<PrivacyTabLabels>;

const NOW = 1_700_000_000_000;
const STATE: PrivacyConsentState = {
  telemetry: { metrics: true, content: false },
  installationId: null,
  privacyDecisionAt: 0,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PrivacyTab label characterization', () => {
  it.each(['omitted', 'undefined', 'custom', 'empty'] as const)(
    'preserves all label values with %s host overrides', (mode) => {
      const labels: PrivacyTabLabels = {};
      const expected: PrivacyTabLabels = {};
      const dictionary: Record<string, string> = {};
      for (const key of Object.keys(COPY) as (keyof typeof COPY)[]) {
        dictionary[COPY[key]] = `Translated ${COPY[key]}`;
        if (mode === 'custom') labels[key] = `Host ${key}`;
        if (mode === 'empty') labels[key] = '';
        if (mode === 'undefined') Object.defineProperty(labels, key, { value: undefined, enumerable: true });
        expected[key] = labels[key] ?? `Translated ${COPY[key]}`;
      }
      const { container } = render(
        <I18nProvider dictionaries={{ fr: dictionary }} initialLocale="fr">
          <PrivacyTab state={STATE} onChange={vi.fn()} {...(mode === 'omitted' ? {} : { labels })} />
        </I18nProvider>,
      );
      expect(container.querySelector('.jini-section-head h4')).toHaveProperty('textContent', expected.consentKicker);
      expect(container.querySelector('.jini-section-head p')).toHaveProperty('textContent', expected.consentLead);
      expect(container.querySelector('.jini-settings-subsection > p')).toHaveProperty('textContent', expected.consentFooter);
      expect(Array.from(container.querySelectorAll('.jini-toggle-row-label'), (node) => node.textContent)).toEqual([
        expected.metricsLabel, expected.contentLabel,
      ]);
      expect(Array.from(container.querySelectorAll('.jini-toggle-row-hint'), (node) => node.textContent)).toEqual([
        expected.metricsHint, expected.contentHint,
      ]);
      expect(container.querySelector('.jini-settings-subsection:last-child h4')).toHaveProperty('textContent', expected.installationIdLabel);
      expect(container.querySelector('.jini-settings-subsection:last-child p')).toHaveProperty('textContent', expected.installationIdHint);
      expect(screen.getByRole('textbox')).toHaveAttribute('aria-label', expected.installationIdLabel);
      expect(screen.getByRole('textbox')).toHaveValue(expected.optedOutLabel);
      expect(container.querySelector('.jini-button-ghost > span:last-child')).toHaveProperty('textContent', expected.deleteMyDataLabel);
    },
  );

  it('uses Date.now at click time when the host omits its clock', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const onChange = vi.fn<(next: PrivacyConsentState) => void>();
    render(<PrivacyTab state={{ ...STATE, installationId: 'existing-id' }} onChange={onChange} />);
    clock.mockReturnValue(NOW + 100);
    await userEvent.click(screen.getByRole('button', { name: /Anonymous metrics/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      telemetry: { metrics: false, content: false },
      installationId: null,
      privacyDecisionAt: NOW + 100,
    });
  });
});
