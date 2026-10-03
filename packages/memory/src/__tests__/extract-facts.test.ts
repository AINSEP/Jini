import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_FACTS,
  DEFAULT_SYSTEM_PROMPT,
  extractFacts,
  factToNoteDraft,
  type ExtractedFact,
} from '../extract-facts.js';
import { createExtractionLog } from '../extraction-log.js';
import type { LlmProviderConfig } from '../llm-provider.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function anthropicConfig(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return { provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-test', ...overrides };
}

/** Mocks a single Anthropic-shaped response whose text content is `JSON.stringify(payload)`. */
function stubAnthropicJsonReply(payload: unknown): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(async () =>
    jsonResponse({ content: [{ type: 'text', text: JSON.stringify(payload) }] }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

describe('extractFacts', () => {
  it('short-circuits to an empty result without a network call when content is empty/whitespace', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await extractFacts({ llmConfig: anthropicConfig(), content: '   ' }, {});
    expect(result).toEqual({ facts: [], raw: '' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls the LLM with the default system prompt and returns sanitized facts', async () => {
    const payload = {
      facts: [
        { statement: 'The sky is blue.', category: 'observation', entities: ['sky'], confidence: 0.9, sourceQuote: 'sky is blue' },
      ],
    };
    const fetchSpy = stubAnthropicJsonReply(payload);

    const result = await extractFacts({ llmConfig: anthropicConfig(), content: 'The sky is blue today.' }, {});

    expect(result.facts).toEqual([
      { statement: 'The sky is blue.', category: 'observation', entities: ['sky'], confidence: 0.9, sourceQuote: 'sky is blue' },
    ]);
    // `raw` is the model's untouched raw text output — exactly what the stub sent back.
    expect(result.raw).toBe(JSON.stringify(payload));

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(body.messages[0].content).toContain('The sky is blue today.');
    expect(body.messages[0].content).toContain('Extract at most 20 facts.');
  });

  it('folds sourceLabel and suggestedCategories into the user prompt', async () => {
    const fetchSpy = stubAnthropicJsonReply({ facts: [] });
    await extractFacts({ llmConfig: anthropicConfig(), content: 'Some content.' }, { ...{ prompt: { suggestedCategories: ['preference', 'decision'] } }, sourceLabel: 'chat message from 2026-07-21' });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.messages[0].content).toContain('Source: chat message from 2026-07-21');
    expect(body.messages[0].content).toContain('Suggested categories (optional hints, not a fixed list): preference, decision');
  });

  it('overrides the system prompt entirely when supplied', async () => {
    const fetchSpy = stubAnthropicJsonReply({ facts: [] });
    await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, { prompt: { systemPrompt: 'Custom prompt.' } });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.system).toBe('Custom prompt.');
  });

  it('drops a candidate fact with no usable statement', async () => {
    stubAnthropicJsonReply({
      facts: [{ category: 'no-statement' }, { statement: '   ' }, { statement: 'Real fact.' }, 'not-an-object', null],
    });
    const result = await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, {});
    expect(result.facts).toEqual([{ statement: 'Real fact.' }]);
  });

  it('drops non-string entities and omits an empty entities array entirely', async () => {
    stubAnthropicJsonReply({
      facts: [{ statement: 'Fact one.', entities: ['Alice', 42, '  ', 'Bob'] }, { statement: 'Fact two.', entities: [] }],
    });
    const result = await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, {});
    expect(result.facts[0]).toEqual({ statement: 'Fact one.', entities: ['Alice', 'Bob'] });
    expect(result.facts[1]).toEqual({ statement: 'Fact two.' });
    expect(result.facts[1]).not.toHaveProperty('entities');
  });

  it('clamps an out-of-range confidence into [0, 1]', async () => {
    stubAnthropicJsonReply({
      facts: [
        { statement: 'Too high.', confidence: 5 },
        { statement: 'Too low.', confidence: -3 },
        { statement: 'Not a number.', confidence: 'high' },
      ],
    });
    const result = await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, {});
    expect(result.facts[0]?.confidence).toBe(1);
    expect(result.facts[1]?.confidence).toBe(0);
    expect(result.facts[2]).not.toHaveProperty('confidence');
  });

  it('treats a non-array facts field as zero facts', async () => {
    stubAnthropicJsonReply({ facts: 'not-an-array' });
    const result = await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, {});
    expect(result.facts).toEqual([]);
  });

  it('caps the returned facts at the default max (20)', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ statement: `Fact ${i}` }));
    stubAnthropicJsonReply({ facts: many });
    const result = await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, {});
    expect(result.facts).toHaveLength(DEFAULT_MAX_FACTS);
    expect(result.facts[0]).toEqual({ statement: 'Fact 0' });
    expect(result.facts[19]).toEqual({ statement: 'Fact 19' });
  });

  it('honors a caller-supplied maxFacts, flooring and ignoring non-positive values', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ statement: `Fact ${i}` }));

    stubAnthropicJsonReply({ facts: many });
    const capped = await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, { prompt: { maxFacts: 3.9 } });
    expect(capped.facts).toHaveLength(3);

    stubAnthropicJsonReply({ facts: many });
    const zero = await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, { prompt: { maxFacts: 0 } });
    expect(zero.facts).toHaveLength(DEFAULT_MAX_FACTS < 10 ? DEFAULT_MAX_FACTS : 10);

    stubAnthropicJsonReply({ facts: many });
    const negative = await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, { prompt: { maxFacts: -5 } });
    expect(negative.facts).toHaveLength(10);
  });

  it('propagates a network/HTTP error from callLlmProvider unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'bad request' } }, 400)));
    await expect(extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, {})).rejects.toThrow(/anthropic 400/);
  });

  it('throws when the model response is not valid JSON even after fence-stripping', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'not json at all, no braces' }] })),
    );
    await expect(extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, {})).rejects.toThrow(/not valid JSON/);
  });

  describe('extraction-log integration', () => {
    it('rejects a JSON null response and records the shape failure instead of leaving the attempt running', async () => {
      stubAnthropicJsonReply(null);
      const log = createExtractionLog({});

      await expect(
        extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, { logging: { log, kind: 'note-extraction' } }),
      ).rejects.toThrow('extract-facts: response must not be null');

      expect(log.list()).toHaveLength(1);
      expect(log.list()[0]?.phase).toBe('failed');
      expect(log.list()[0]?.error).toBe('extract-facts: response must not be null');
      expect(log.list()[0]).not.toHaveProperty('proposedCount');
      expect(log.list()[0]).not.toHaveProperty('writtenCount');
    });

    it('rejects a JSON null response with the same diagnostic when logging is omitted', async () => {
      stubAnthropicJsonReply(null);
      await expect(extractFacts({ llmConfig: anthropicConfig(), content: 'x' })).rejects.toThrow(
        'extract-facts: response must not be null',
      );
    });

    it('records start → provider → proposed → success on a successful call', async () => {
      stubAnthropicJsonReply({ facts: [{ statement: 'Logged fact.' }] });
      const log = createExtractionLog({});

      const result = await extractFacts({ llmConfig: anthropicConfig({ model: 'claude-logging-test' }), content: 'x' }, { logging: { log, kind: 'note-extraction' } });

      expect(result.facts).toHaveLength(1);
      const records = log.list();
      expect(records).toHaveLength(1);
      const record = records[0]!;
      expect(record.kind).toBe('note-extraction');
      expect(record.phase).toBe('success');
      expect(record.provider).toEqual({ kind: 'anthropic', model: 'claude-logging-test', credentialSource: null });
      expect(record.proposedCount).toBe(1);
      expect(record.writtenCount).toBe(1);
      expect(record.writtenIds).toEqual([]);
    });

    it('records a failed attempt when the LLM call itself throws', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'nope' } }, 500)));
      const log = createExtractionLog({});

      await expect(
        extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, { logging: { log, kind: 'note-extraction' } }),
      ).rejects.toThrow();

      const record = log.list()[0]!;
      expect(record.phase).toBe('failed');
      expect(record.error).toMatch(/anthropic 500/);
    });

    it('records a failed attempt when the response cannot be parsed as JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse({ content: [{ type: 'text', text: 'nope, not json' }] })),
      );
      const log = createExtractionLog({});

      await expect(
        extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, { logging: { log, kind: 'note-extraction' } }),
      ).rejects.toThrow();

      const record = log.list()[0]!;
      expect(record.phase).toBe('failed');
    });

    it('does not touch a log when logging options are omitted', async () => {
      stubAnthropicJsonReply({ facts: [] });
      // No log passed at all — this just proves no crash/side effect occurs; nothing to assert on.
      await extractFacts({ llmConfig: anthropicConfig(), content: 'x' }, {});
    });
  });
});

describe('factToNoteDraft', () => {
  it('uses the full statement as both name and description when short and no sourceQuote', () => {
    const fact: ExtractedFact = { statement: 'A short fact.' };
    expect(factToNoteDraft({ fact, type: 'reference' })).toEqual({
      name: 'A short fact.',
      description: 'A short fact.',
      type: 'reference',
    });
  });

  it('appends a Source line to description when sourceQuote is present', () => {
    const fact: ExtractedFact = { statement: 'A fact with a quote.', sourceQuote: 'quoted text' };
    const draft = factToNoteDraft({ fact, type: 'reference' });
    expect(draft.description).toBe('A fact with a quote.\n\nSource: "quoted text"');
    expect(draft.name).toBe('A fact with a quote.');
  });

  it('truncates a long statement for name but keeps the full statement in description', () => {
    const longStatement = 'X'.repeat(120);
    const fact: ExtractedFact = { statement: longStatement };
    const draft = factToNoteDraft({ fact, type: 'profile' });
    expect(draft.name.length).toBe(80);
    expect(draft.name.endsWith('…')).toBe(true);
    expect(draft.description).toBe(longStatement);
    expect(draft.type).toBe('profile');
  });
});
