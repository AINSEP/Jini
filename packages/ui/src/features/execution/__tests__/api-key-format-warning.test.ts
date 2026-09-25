import { describe, expect, it } from 'vitest';
import {
  API_KEY_CROSS_VENDOR_WARNING,
  API_KEY_TOO_SHORT_WARNING,
  DEFAULT_PROVIDER_PRESETS,
  MIN_PLAUSIBLE_API_KEY_LENGTH,
} from '../constants.js';
import { apiKeyFormatWarning, missingRequiredFields, resolveSelectedPreset } from '../rules.js';
import type { ByokConfig, ProviderPreset } from '../types.js';

/**
 * @file `apiKeyFormatWarning` as a rule, plus the three properties that make it safe to ship: it
 * warns only on things it POSITIVELY recognises as wrong, it is DATA (a preset row, not a
 * provider-id branch), and it is ADVISORY (absent from the gate).
 *
 * The direction of the rule is the point. It used to be a positive allowlist — "warn on anything
 * this catalog does not recognise" — and that shipped a false positive within hours: an operator
 * pasted a REAL Google Gemini key whose shape predated the `/^AIza/` row and was told their working
 * credential did not look like a Google key. A format guess that can call a valid key invalid is
 * worse than one that misses an invalid one, so the rule is now inverted: silence unless the string
 * is recognisably SOMEONE ELSE'S key, or too short to be anyone's.
 */

/** A 39-char Google key in a shape this catalog has never heard of. Synthetic. This is the exact
 *  class of value the old allowlist condemned; it must produce silence. */
const UNRECOGNISED_BUT_PLAUSIBLE_GOOGLE_KEY = 'AQ.Ab8RN6JDUMMY000000000000000000000000';
/** Chrome autofilled a saved PASSWORD into the key field. Observed at ~15 characters, no prefix. */
const AUTOFILLED_PASSWORD = 'hunter2-hunter2';

function configWith(apiKey: string, preset: ProviderPreset | null): ByokConfig {
  return {
    protocol: preset?.protocol ?? 'openai',
    providerId: preset?.id ?? null,
    apiKey,
    baseUrl: preset?.baseUrl ?? 'https://example.com',
    model: 'some-model',
  };
}

function presetById(id: string): ProviderPreset {
  const found = DEFAULT_PROVIDER_PRESETS.find((preset) => preset.id === id);
  if (!found) throw new Error(`no preset '${id}' in DEFAULT_PROVIDER_PRESETS`);
  return found;
}

/** The rule as the shipped screen calls it: against the whole default catalog. */
function warnFor(apiKey: string, preset: ProviderPreset | null) {
  return apiKeyFormatWarning(configWith(apiKey, preset), preset, DEFAULT_PROVIDER_PRESETS);
}

describe('apiKeyFormatWarning — silence on anything not positively recognised', () => {
  it('says NOTHING about a real Google key in a shape the catalog does not know', () => {
    // THE REPORTED BUG. The old rule returned "This does not look like a Google API key" here, about
    // a credential that worked. Nothing in this catalog can prove a key is invalid, so nothing in
    // this catalog may claim it.
    expect(warnFor(UNRECOGNISED_BUT_PLAUSIBLE_GOOGLE_KEY, presetById('google-gemini'))).toBeNull();
  });

  it('says nothing about an unrecognised key on ANY preset in the shipped catalog', () => {
    // The general form of the same bug, swept across every row so a future preset cannot quietly
    // reintroduce an allowlist for itself. `zzz…` matches no vendor prefix and is long enough to be
    // a real secret, so every preset must be silent about it.
    const unknownShape = `zzz-${'0'.repeat(48)}`;
    for (const preset of DEFAULT_PROVIDER_PRESETS) {
      expect(warnFor(unknownShape, preset)).toBeNull();
    }
  });

  it('stays silent on each preset own correctly-shaped key', () => {
    expect(warnFor('AIzaSyDUMMY0000000000000000000000000000', presetById('google-gemini'))).toBeNull();
    expect(warnFor(`sk-ant-api03-${'0'.repeat(95)}`, presetById('anthropic'))).toBeNull();
    expect(warnFor(`sk-proj-${'0'.repeat(48)}`, presetById('openai'))).toBeNull();
    expect(warnFor(`sk-or-v1-${'0'.repeat(64)}`, presetById('openrouter'))).toBeNull();
    // Azure ships no prefix at all — a bare 32-char hex key must pass unremarked.
    expect(warnFor('a'.repeat(32), presetById('azure-openai'))).toBeNull();
  });

  it('is silent for an empty field, a whitespace-only field, and a null preset', () => {
    const google = presetById('google-gemini');
    expect(warnFor('', google)).toBeNull();
    expect(warnFor('   ', google)).toBeNull();
    expect(warnFor(UNRECOGNISED_BUT_PLAUSIBLE_GOOGLE_KEY, null)).toBeNull();
  });

  it('trims before judging, so a pasted key with stray whitespace is not condemned for it', () => {
    expect(warnFor(`  AIzaSyDUMMY0000000000000000000000000000  `, presetById('google-gemini'))).toBeNull();
  });

  it('degrades to silence, not noise, when no catalog is supplied', () => {
    // A host calling the rule with only the selected preset loses the cross-vendor arm. It must lose
    // it by going QUIET, never by falling back to "does this match my own prefix".
    const google = presetById('google-gemini');
    expect(apiKeyFormatWarning(configWith(UNRECOGNISED_BUT_PLAUSIBLE_GOOGLE_KEY, google), google)).toBeNull();
    expect(apiKeyFormatWarning(configWith(`sk-ant-api03-${'0'.repeat(95)}`, google), google)).toBeNull();
  });
});

describe('apiKeyFormatWarning — cross-vendor paste', () => {
  it('names the vendor the key actually belongs to, and the one selected', () => {
    const google = presetById('google-gemini');
    expect(warnFor(`sk-ant-api03-${'0'.repeat(95)}`, google)).toEqual({
      message: API_KEY_CROSS_VENDOR_WARNING,
      vars: { vendor: 'Anthropic', provider: 'Google Gemini' },
    });
  });

  it.each([
    ['anthropic', 'AIzaSyDUMMY0000000000000000000000000000', 'Google Gemini'],
    ['openai', `sk-or-v1-${'0'.repeat(64)}`, 'OpenRouter'],
    ['openrouter', `sk-ant-api03-${'0'.repeat(95)}`, 'Anthropic'],
    ['google-gemini', `sk-proj-${'0'.repeat(48)}`, 'OpenAI'],
    // Azure carries no prefix of its own, and still gets the benefit: the check is about the key's
    // OWNER, not about the selected preset having a shape to compare against.
    ['azure-openai', `sk-ant-api03-${'0'.repeat(95)}`, 'Anthropic'],
  ])('%s field holding another vendor key names %s', (id, key, vendor) => {
    const preset = presetById(id);
    expect(warnFor(key, preset)).toEqual({
      message: API_KEY_CROSS_VENDOR_WARNING,
      vars: { vendor, provider: preset.title },
    });
  });

  it('prefers the MOST specific claim, so an OpenRouter key is not blamed on OpenAI', () => {
    // `sk-or-v1-…` starts with both `sk-or-` and OpenAI's `sk-`. The longer prefix is the truer
    // claim; resolving this by catalog order instead would make the message depend on row position.
    const openrouter = presetById('openrouter');
    expect(warnFor(`sk-or-v1-${'0'.repeat(64)}`, openrouter)).toBeNull();
    const anthropic = presetById('anthropic');
    expect(warnFor(`sk-or-v1-${'0'.repeat(64)}`, anthropic)?.vars).toEqual({
      vendor: 'OpenRouter',
      provider: 'Anthropic',
    });
  });

  it('lets the selected preset own claim win a tie, so an equally-specific match is silence', () => {
    // A host whose own row speaks Anthropic protocol with Anthropic-shaped keys (a proxy) must not
    // be told its key belongs to Anthropic. Its claim is exactly as specific, so it keeps it.
    const proxy: ProviderPreset = {
      id: 'acme-anthropic-proxy',
      title: 'Acme Proxy',
      protocol: 'anthropic',
      baseUrl: 'https://proxy.acme.example.com',
      preferredModels: [],
      apiKeyPrefix: 'sk-ant-',
    };
    const catalog = [...DEFAULT_PROVIDER_PRESETS, proxy];
    const config = configWith(`sk-ant-api03-${'0'.repeat(95)}`, proxy);
    expect(apiKeyFormatWarning(config, proxy, catalog)).toBeNull();
  });

  it('says nothing on custom/manual, where any vendor key may legitimately be right', () => {
    // `resolveSelectedPreset` returns null for Custom. An operator pointing a custom base URL at an
    // Anthropic-compatible proxy is pasting an Anthropic key on purpose.
    expect(apiKeyFormatWarning(configWith(`sk-ant-api03-${'0'.repeat(95)}`, null), null, DEFAULT_PROVIDER_PRESETS))
      .toBeNull();
  });
});

describe('apiKeyFormatWarning — implausibly short', () => {
  it('warns about the reported autofilled password, which carries no vendor prefix', () => {
    expect(AUTOFILLED_PASSWORD.length).toBe(15);
    expect(warnFor(AUTOFILLED_PASSWORD, presetById('google-gemini'))).toEqual({
      message: API_KEY_TOO_SHORT_WARNING,
      vars: {},
    });
  });

  it('warns on a short value even with no preset selected', () => {
    expect(apiKeyFormatWarning(configWith(AUTOFILLED_PASSWORD, null), null, DEFAULT_PROVIDER_PRESETS)).toEqual({
      message: API_KEY_TOO_SHORT_WARNING,
      vars: {},
    });
  });

  it('draws the line at exactly MIN_PLAUSIBLE_API_KEY_LENGTH', () => {
    const google = presetById('google-gemini');
    expect(warnFor('x'.repeat(MIN_PLAUSIBLE_API_KEY_LENGTH), google)).toBeNull();
    expect(warnFor('x'.repeat(MIN_PLAUSIBLE_API_KEY_LENGTH - 1), google)?.message).toBe(API_KEY_TOO_SHORT_WARNING);
  });

  it('sits safely below the shortest key shape the catalog describes', () => {
    // The threshold justification, asserted rather than left in a comment: Azure OpenAI's bare
    // 32-char hex key is the shortest real shape in `DEFAULT_PROVIDER_PRESETS`, and Google's
    // `AIza` + 35 = 39 is the shortest prefixed one. A threshold at or above either would warn on a
    // working credential.
    expect(MIN_PLAUSIBLE_API_KEY_LENGTH).toBeLessThan(32);
    expect(MIN_PLAUSIBLE_API_KEY_LENGTH).toBeGreaterThan(AUTOFILLED_PASSWORD.length);
  });
});

describe('apiKeyFormatWarning — structural properties', () => {
  it('is DATA: a host preset the package has never heard of participates with no code change', () => {
    // The property that makes "add a provider" a catalog edit. If this ever needs a change in
    // `rules.ts` to pass, the rule has grown a provider-id branch.
    const acme: ProviderPreset = {
      id: 'acme-llm',
      title: 'Acme LLM',
      protocol: 'openai',
      baseUrl: 'https://acme.example.com/v1',
      preferredModels: [],
      apiKeyPrefix: 'acme_',
    };
    const catalog = [...DEFAULT_PROVIDER_PRESETS, acme];
    const google = presetById('google-gemini');
    // An Acme key in the Google field is named as Acme's, purely because Acme is a catalog row.
    expect(apiKeyFormatWarning(configWith(`acme_${'0'.repeat(48)}`, google), google, catalog)).toEqual({
      message: API_KEY_CROSS_VENDOR_WARNING,
      vars: { vendor: 'Acme LLM', provider: 'Google Gemini' },
    });
    // And Acme's own field accepts both its own keys and shapes nobody recognises.
    expect(apiKeyFormatWarning(configWith(`acme_${'0'.repeat(48)}`, acme), acme, catalog)).toBeNull();
    expect(apiKeyFormatWarning(configWith('0'.repeat(48), acme), acme, catalog)).toBeNull();
  });

  it('is ADVISORY: a cross-vendor key is not a missing required field', () => {
    // `missingRequiredFields` is the gate (it disables Test connection). The warning must never
    // reach it, or a format guess becomes a block.
    const google = presetById('google-gemini');
    const config = configWith(`sk-ant-api03-${'0'.repeat(95)}`, google);
    expect(apiKeyFormatWarning(config, google, DEFAULT_PROVIDER_PRESETS)).not.toBeNull();
    expect(missingRequiredFields(config, google)).toEqual([]);
  });

  it('reaches the preset the live Gemini form actually resolves', () => {
    // Ties the rule to the selection path the screen uses — a rule that warned on an unreachable
    // preset would pass every test above and reach nobody.
    const google = presetById('google-gemini');
    const selected = resolveSelectedPreset(DEFAULT_PROVIDER_PRESETS, configWith('x', google));
    expect(selected?.id).toBe('google-gemini');
    expect(
      apiKeyFormatWarning(configWith(`sk-ant-api03-${'0'.repeat(95)}`, selected), selected, DEFAULT_PROVIDER_PRESETS)
        ?.vars,
    ).toEqual({ vendor: 'Anthropic', provider: 'Google Gemini' });
  });
});

describe('DEFAULT_PROVIDER_PRESETS key prefixes', () => {
  it('carries no allowlist field on any row', () => {
    // The regression guard for the reported bug's ROOT CAUSE rather than its symptom: `apiKeyPattern`
    // + `apiKeyFormatHint` were the "warn unless it matches" pair. If either reappears on a row,
    // someone has rebuilt the allowlist.
    for (const preset of DEFAULT_PROVIDER_PRESETS) {
      expect(preset).not.toHaveProperty('apiKeyPattern');
      expect(preset).not.toHaveProperty('apiKeyFormatHint');
    }
  });

  it('gives a prefix only to vendors whose keys genuinely carry one', () => {
    const prefixes = Object.fromEntries(
      DEFAULT_PROVIDER_PRESETS.map((preset) => [preset.id, preset.apiKeyPrefix]),
    );
    expect(prefixes).toEqual({
      anthropic: 'sk-ant-',
      openai: 'sk-',
      // Azure keys are bare hex and Ollama needs no key: a prefix for either would be a guess, and a
      // guess here is what mislabels someone else's valid key as theirs.
      'azure-openai': undefined,
      'google-gemini': 'AIza',
      openrouter: 'sk-or-',
      ollama: undefined,
    });
  });
});
