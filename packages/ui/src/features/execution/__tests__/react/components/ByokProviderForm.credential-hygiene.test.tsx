import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentCliEnvFields } from '../../../react/components/AgentCliEnvFields.js';
import { ByokProviderForm } from '../../../react/components/ByokProviderForm.js';
import type { AgentCliEnvFieldSpec, ByokConfig, LocalCliConfig, ProviderPreset } from '../../../types.js';

/**
 * @file Two defects reported together on one screen, which turned out to be one defect and one
 * missing guard.
 *
 * REPORTED: an operator's Google BYOK form kept answering "API key not valid. Please pass a valid
 * API key." with a valid key in hand. The field actually held a 15-character value with no `AIza`
 * prefix — Chrome had autofilled a saved PASSWORD into it, because `autoComplete="off"` is
 * deliberately ignored by Chrome on credential-shaped fields. The provider's rejection was true and
 * unactionable: it described a string the operator never typed.
 *
 * So: `new-password` stops the wrong value arriving, and `apiKeyFormatWarning` names it if one
 * arrives anyway (a different browser, a paste from the wrong clipboard entry).
 *
 * The warning half was then reported BACKWARDS: it began as "warn unless the key matches this
 * provider's known prefix", which told an operator holding a real Google key in an unfamiliar shape
 * that their working credential did not look like a Google key. It now warns only on what it can
 * positively recognise as wrong — another vendor's prefix, or a length no real key reaches — and the
 * assertions below are written around that direction, at the DOM.
 *
 * Every assertion here reads the RENDERED DOM ATTRIBUTE rather than a prop, because the prop is not
 * the thing Chrome consults and a test on the prop would have passed against the broken version.
 */

const GOOGLE_PRESET: ProviderPreset = {
  id: 'google-gemini',
  title: 'Google Gemini',
  protocol: 'google',
  baseUrl: 'https://generativelanguage.googleapis.com',
  preferredModels: ['gemini-3.6-flash'],
  apiKeyPrefix: 'AIza',
};

/** A host row with no prefix of its own, and one this package has never heard of — the
 *  "silence is the default" case a host's own catalog gets. */
const NO_PREFIX_PRESET: ProviderPreset = {
  id: 'mystery',
  title: 'Mystery Provider',
  protocol: 'openai',
  baseUrl: 'https://mystery.example.com',
  preferredModels: ['m-1'],
};

/** Synthetic. A real Google key in a shape this catalog does not know — the reported false positive. */
const UNRECOGNISED_BUT_PLAUSIBLE_GOOGLE_KEY = 'AQ.Ab8RN6JDUMMY000000000000000000000000';
/** Synthetic. An Anthropic-shaped key, i.e. the wrong clipboard entry. */
const ANTHROPIC_SHAPED_KEY = `sk-ant-api03-${'0'.repeat(95)}`;

/** Any rendered key warning, whatever its wording. Stronger than matching the current copy: a
 *  reworded false positive would still have to fail this. The only other `role="status"` in the form
 *  is the model-discovery error, and every render here passes `status: 'idle'`. */
function keyWarning(): HTMLElement | null {
  return screen.queryByRole('status');
}

function configWith(preset: ProviderPreset, apiKey: string): ByokConfig {
  return {
    protocol: preset.protocol,
    providerId: preset.id,
    apiKey,
    baseUrl: preset.baseUrl,
    model: preset.preferredModels[0] ?? '',
  };
}

function renderForm(preset: ProviderPreset, apiKey: string) {
  return render(
    <ByokProviderForm
      config={configWith(preset, apiKey)}
      onConfigChange={vi.fn()}
      preset={preset}
      modelDiscovery={{ status: 'idle' }}
      connectionTest={{ status: 'idle' }}
      onTestConnection={vi.fn()}
    />,
  );
}

function keyInput(): HTMLInputElement {
  return screen.getByLabelText(/API key/i, { exact: false }) as HTMLInputElement;
}

describe('ByokProviderForm — API-key autofill suppression', () => {
  it('renders autocomplete="new-password" on the API-key input, NOT "off"', () => {
    renderForm(GOOGLE_PRESET, '');
    // The literal attribute, not the React prop: `off` is what Chrome ignores, and `new-password`
    // is the only value it honors as "not a saved-login field".
    expect(keyInput().getAttribute('autocomplete')).toBe('new-password');
  });

  it('keeps autocomplete="new-password" while the key is revealed as plain text', () => {
    // `type` flips to `text` on reveal; the autofill suppression must not flip with it, or a
    // revealed field becomes fillable again.
    const { container } = renderForm(GOOGLE_PRESET, 'AIzaSyExample');
    const revealButton = container.querySelector('.jini-input-affix-btn') as HTMLButtonElement;
    revealButton.click();
    expect(keyInput().getAttribute('autocomplete')).toBe('new-password');
  });
});

describe('ByokProviderForm — key-format warning', () => {
  it('says NOTHING about a real Google key in a shape the catalog does not know', () => {
    // THE REPORTED BUG, at the DOM. The old rule rendered "This does not look like a Google API key"
    // here, under a credential that worked.
    renderForm(GOOGLE_PRESET, UNRECOGNISED_BUT_PLAUSIBLE_GOOGLE_KEY);
    expect(keyWarning()).not.toBeInTheDocument();
  });

  it('names the vendor a cross-pasted key actually belongs to', () => {
    // Composed through `t(message, vars)`, so this also proves the placeholders resolve rather than
    // rendering a raw "{vendor}" at the operator.
    renderForm(GOOGLE_PRESET, ANTHROPIC_SHAPED_KEY);
    expect(
      screen.getByText('This looks like an API key for Anthropic, not Google Gemini. You can still save and test it.'),
    ).toBeInTheDocument();
  });

  it('warns about a value too short to be any provider key', () => {
    // The 15-character autofilled password this whole file exists for.
    renderForm(GOOGLE_PRESET, 'hunter2-hunter2');
    expect(screen.getByText(/shorter than any provider API key/)).toBeInTheDocument();
  });

  it('is advisory only — Test connection stays enabled with a cross-pasted key', () => {
    // The whole point: a client-side format guess must never be able to lock an operator out of a
    // credential the vendor would actually accept. A disabled button here would be the regression.
    renderForm(GOOGLE_PRESET, ANTHROPIC_SHAPED_KEY);
    expect(screen.getByRole('button', { name: /Test connection/i })).toBeEnabled();
  });

  it('stays silent for the provider own correctly-shaped key', () => {
    renderForm(GOOGLE_PRESET, 'AIzaSyDUMMY0000000000000000000000000000');
    expect(keyWarning()).not.toBeInTheDocument();
  });

  it('stays silent for an empty field — a stored-key screen legitimately renders one', () => {
    renderForm(GOOGLE_PRESET, '');
    expect(keyWarning()).not.toBeInTheDocument();
  });

  it('stays silent for a whitespace-only field rather than judging the trimmed empty string', () => {
    renderForm(GOOGLE_PRESET, '   ');
    expect(keyWarning()).not.toBeInTheDocument();
  });

  it('stays silent for a preset with no prefix of its own, given an unrecognised key', () => {
    renderForm(NO_PREFIX_PRESET, `mystery-${'0'.repeat(40)}`);
    expect(keyWarning()).not.toBeInTheDocument();
  });

  it('still catches a cross-pasted key on a preset with no prefix of its own', () => {
    // Recognition is about the KEY's owner, not about the selected preset having a shape to compare
    // against — so a host row that ships no prefix is not opted out of the useful half.
    renderForm(NO_PREFIX_PRESET, ANTHROPIC_SHAPED_KEY);
    expect(
      screen.getByText(
        'This looks like an API key for Anthropic, not Mystery Provider. You can still save and test it.',
      ),
    ).toBeInTheDocument();
  });
});

describe('AgentCliEnvFields — autofill suppression is per-field', () => {
  const FIELDS: readonly AgentCliEnvFieldSpec[] = [
    { agentId: 'claude', envKey: 'ANTHROPIC_AUTH_TOKEN', label: 'Auth token', secret: true },
    { agentId: 'claude', envKey: 'ANTHROPIC_BASE_URL', label: 'Proxy base URL' },
  ];
  // `agentId`, not `selectedAgentId` — the latter is not a field of `LocalCliConfig` and the `as`
  // cast that hid it failed `tsc`, which is what `build` runs. Pre-existing, fixed here rather than
  // left red under an unrelated change. The value is immaterial: `AgentCliEnvFields` reads only
  // `envByAgentId`.
  const CONFIG: LocalCliConfig = { agentId: 'claude' };

  it('a secret field gets new-password; a non-secret one keeps off', () => {
    // Split deliberately: `new-password` on a file-path field invites Chrome to offer to GENERATE a
    // password for it, which is a worse experience than the autofill it would be guarding against.
    render(<AgentCliEnvFields agentId="claude" fields={FIELDS} config={CONFIG} onChange={vi.fn()} />);
    const secret = screen.getByTestId('jini-agent-cli-env-claude-ANTHROPIC_AUTH_TOKEN');
    const plain = screen.getByTestId('jini-agent-cli-env-claude-ANTHROPIC_BASE_URL');
    expect(secret.getAttribute('autocomplete')).toBe('new-password');
    expect(plain.getAttribute('autocomplete')).toBe('off');
  });
});
