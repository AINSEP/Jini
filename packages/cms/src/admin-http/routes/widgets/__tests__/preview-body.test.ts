import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseWidgetPreviewBody } from '../preview.js';

test('preview body rejects non-object, null and array envelopes', () => {
  for (const raw of [undefined, null, [], 'text', 42, false]) {
    assert.equal(parseWidgetPreviewBody({ raw }), null);
  }
});

test('preview body rejects unknown keys, invalid widget types and invalid content independently', () => {
  for (const raw of [
    { widgetType: 'text', content: {}, unexpected: true },
    { content: {} },
    { widgetType: 42, content: {} },
    { widgetType: 'x'.repeat(101), content: {} },
    { widgetType: 'text' },
    { widgetType: 'text', content: null },
    { widgetType: 'text', content: [] },
    { widgetType: 'text', content: 'text' },
    { widgetType: 'text', content: 42 },
    { widgetType: 'text', content: false },
  ]) {
    assert.equal(parseWidgetPreviewBody({ raw }), null);
  }
});

test('preview body accepts empty and 100-character widget types without trimming and preserves content identity', () => {
  const content = { nested: { value: 'draft' } };
  for (const widgetType of ['', 'x'.repeat(100), ' text ']) {
    const parsed = parseWidgetPreviewBody({ raw: { widgetType, content } });
    assert.deepEqual(parsed, { widgetType, content });
    assert.equal(parsed?.content, content);
  }
});

test('preview body accepts class instances and null-prototype records as envelopes and content', () => {
  class Content { body = 'draft'; }
  class Body { widgetType = 'text'; content = new Content(); }
  const record: Record<string, unknown> = Object.create(null);
  record.widgetType = 'text';
  record.content = Object.create(null);
  for (const raw of [new Body(), record]) {
    const parsed = parseWidgetPreviewBody({ raw });
    assert.equal(parsed?.widgetType, 'text');
    assert.equal(parsed?.content, raw.content);
  }
});

test('preview body accepts exactly 128 KiB and rejects one byte over using UTF-8 bytes', () => {
  // This envelope contributes 43 bytes; each accented character contributes two.
  const atLimit = { widgetType: 'text', content: { body: `${'é'.repeat(65514)}x` } };
  assert.equal(Buffer.byteLength(JSON.stringify(atLimit), 'utf8'), 131072);
  assert.deepEqual(parseWidgetPreviewBody({ raw: atLimit }), atLimit);
  const overLimit = { widgetType: 'text', content: { body: `${atLimit.content.body}x` } };
  assert.equal(parseWidgetPreviewBody({ raw: overLimit }), null);
});

test('preview body rejects invalid fields before attempting serialization', () => {
  const content: Record<string, unknown> = {};
  content.self = content;
  assert.equal(parseWidgetPreviewBody({ raw: { widgetType: 42, content } }), null);
  assert.equal(parseWidgetPreviewBody({ raw: { widgetType: 'text', content, extra: true } }), null);
});

test('preview body propagates serialization errors for otherwise valid fields', () => {
  const content: Record<string, unknown> = {};
  content.self = content;
  assert.throws(() => parseWidgetPreviewBody({ raw: { widgetType: 'text', content } }), TypeError);
});
