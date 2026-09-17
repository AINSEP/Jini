import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ByokProviderForm } from '../../../react/components/ByokProviderForm.js';
import { I18nProvider, SETTINGS_DIALOG_DICTIONARIES } from '../../../../i18n/index.js';
import type { ByokConfig, ProviderPreset } from '../../../types.js';

/**
 * @file The key-format warnings (`apiKeyFormatWarning` in `rules.ts`) are correctly routed through
 * `t()` at the call site (`ByokProviderForm.tsx`'s `{t(keyFormatWarning.message, keyFormatWarning.vars)}`)
 * — `ByokProviderForm.credential-hygiene.test.tsx` already covers that composition. What that file
 * cannot catch: `t()` only translates a key it can find in the mounted dictionary, and neither
 * `API_KEY_CROSS_VENDOR_WARNING` nor `API_KEY_TOO_SHORT_WARNING` (`execution/constants.ts`) was ever
 * added to `SETTINGS_DIALOG_EN`/`SETTINGS_DIALOG_ES`/... — the two warnings were missed when the
 * dictionaries' call-site enumeration walked variable-keyed `t()` calls (see
 * `settings-dialog.en.ts`'s header comment, which lists the OTHER variable-keyed calls it traced and
 * omits these two). The English key equals the English string, so this was invisible in English:
 * every non-English locale silently showed raw English instead of its own language, forever, with no
 * missing-key warning anywhere — this is the exact path a host's admin uses
 * (`apps/admin/src/features/ai-assistant/AiAssistant.tsx` mounts `ByokProviderForm` under
 * `<I18nProvider dictionaries={SETTINGS_DIALOG_DICTIONARIES}>`).
 */

const GOOGLE_PRESET: ProviderPreset = {
  id: 'google-gemini',
  title: 'Google Gemini',
  protocol: 'google',
  baseUrl: 'https://generativelanguage.googleapis.com',
  preferredModels: ['gemini-3.6-flash'],
  apiKeyPrefix: 'AIza',
};

/** Synthetic. An Anthropic-shaped key pasted into a Google row — triggers the cross-vendor warning. */
const ANTHROPIC_SHAPED_KEY = `sk-ant-api03-${'0'.repeat(95)}`;
/** Synthetic. Too short to be any real provider key — triggers the length-floor warning. */
const TOO_SHORT_KEY = 'hunter2-hunter2';

function configWith(apiKey: string): ByokConfig {
  return {
    protocol: GOOGLE_PRESET.protocol,
    providerId: GOOGLE_PRESET.id,
    apiKey,
    baseUrl: GOOGLE_PRESET.baseUrl,
    model: GOOGLE_PRESET.preferredModels[0] ?? '',
  };
}

/** Mounts the form exactly as a host's admin does: a real `I18nProvider` carrying this package's own
 *  shipped dictionaries, in a non-English locale. */
function renderLocalized(locale: 'es', apiKey: string) {
  return render(
    <I18nProvider initialLocale={locale} dictionaries={SETTINGS_DIALOG_DICTIONARIES}>
      <ByokProviderForm
        config={configWith(apiKey)}
        onConfigChange={vi.fn()}
        preset={GOOGLE_PRESET}
        modelDiscovery={{ status: 'idle' }}
        connectionTest={{ status: 'idle' }}
        onTestConnection={vi.fn()}
      />
    </I18nProvider>,
  );
}

const ENGLISH_VENDOR_TEXT =
  'This looks like an API key for Anthropic, not Google Gemini. You can still save and test it.';
const ENGLISH_TOO_SHORT_TEXT = /shorter than any provider API key/;

describe('ByokProviderForm — key-format warnings under a real non-English dictionary', () => {
  it('renders the cross-vendor warning in Spanish, not the raw English string', () => {
    renderLocalized('es', ANTHROPIC_SHAPED_KEY);
    expect(screen.getByText('Esto parece una clave de API de Anthropic, no de Google Gemini. Aun así puedes guardarla y probarla.')).toBeInTheDocument();
    expect(screen.queryByText(ENGLISH_VENDOR_TEXT)).not.toBeInTheDocument();
  });

  it('renders the too-short warning in Spanish, not the raw English string', () => {
    renderLocalized('es', TOO_SHORT_KEY);
    expect(
      screen.getByText(
        'Esto es más corto que cualquier clave de API de un proveedor. Comprueba que se haya pegado la clave completa. Aun así puedes guardarla y probarla.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(ENGLISH_TOO_SHORT_TEXT)).not.toBeInTheDocument();
  });
});

describe('ByokProviderForm — key-format warnings with no I18nProvider mounted', () => {
  it('still renders the cross-vendor warning in English via the passthrough translator', () => {
    render(
      <ByokProviderForm
        config={configWith(ANTHROPIC_SHAPED_KEY)}
        onConfigChange={vi.fn()}
        preset={GOOGLE_PRESET}
        modelDiscovery={{ status: 'idle' }}
        connectionTest={{ status: 'idle' }}
        onTestConnection={vi.fn()}
      />,
    );
    expect(screen.getByText(ENGLISH_VENDOR_TEXT)).toBeInTheDocument();
  });

  it('still renders the too-short warning in English via the passthrough translator', () => {
    render(
      <ByokProviderForm
        config={configWith(TOO_SHORT_KEY)}
        onConfigChange={vi.fn()}
        preset={GOOGLE_PRESET}
        modelDiscovery={{ status: 'idle' }}
        connectionTest={{ status: 'idle' }}
        onTestConnection={vi.fn()}
      />,
    );
    expect(screen.getByText(ENGLISH_TOO_SHORT_TEXT)).toBeInTheDocument();
  });
});
