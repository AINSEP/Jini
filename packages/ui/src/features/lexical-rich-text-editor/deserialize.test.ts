import { createEditor, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { setRichTextFromPlainText } from './deserialize.js';
import { MentionNode } from './mention-node.js';
import { serializeRichText } from './serialize.js';
import type { MentionEntity } from './types.js';

const slack: MentionEntity = { id: 'slack', kind: 'connector', label: 'Slack', token: '@Slack' };
const notion: MentionEntity = { id: 'notion', kind: 'connector', label: 'Notion', token: '@Notion' };

function makeEditor(): LexicalEditor {
  return createEditor({
    namespace: 'deserialize-test',
    nodes: [MentionNode],
    onError(e) {
      throw e;
    },
  });
}

describe('setRichTextFromPlainText', () => {
  it('round-trips plain text with no mentions', () => {
    const editor = makeEditor();
    setRichTextFromPlainText(editor, 'hello world', []);
    expect(serializeRichText(editor.getEditorState())).toEqual({
      text: 'hello world',
      mentions: [],
    });
  });

  it('round-trips a known @token into an atomic mention node and back', () => {
    const editor = makeEditor();
    setRichTextFromPlainText(editor, 'hi @Slack there', [slack]);
    const result = serializeRichText(editor.getEditorState());
    expect(result.text).toBe('hi @Slack there');
    expect(result.mentions).toEqual([slack]);
  });

  it('round-trips multiple known mentions', () => {
    const editor = makeEditor();
    setRichTextFromPlainText(editor, '@Slack and @Notion', [slack, notion]);
    const result = serializeRichText(editor.getEditorState());
    expect(result.text).toBe('@Slack and @Notion');
    expect(result.mentions.map((m) => m.id)).toEqual(['slack', 'notion']);
  });

  it('leaves an unknown @token as plain text (highlightUnknown disabled for deserialize)', () => {
    const editor = makeEditor();
    setRichTextFromPlainText(editor, 'hi @Ghost', []);
    const result = serializeRichText(editor.getEditorState());
    expect(result.text).toBe('hi @Ghost');
    expect(result.mentions).toEqual([]);
  });

  it('round-trips embedded newlines as line breaks within one paragraph', () => {
    const editor = makeEditor();
    setRichTextFromPlainText(editor, 'line1\nline2\nline3', []);
    expect(serializeRichText(editor.getEditorState()).text).toBe('line1\nline2\nline3');
  });

  it('handles a leading/trailing empty line from adjacent newlines', () => {
    const editor = makeEditor();
    setRichTextFromPlainText(editor, '\nhello\n', []);
    expect(serializeRichText(editor.getEditorState()).text).toBe('\nhello\n');
  });

  it('clears prior content on reseed (root.clear())', () => {
    const editor = makeEditor();
    setRichTextFromPlainText(editor, 'first @Slack', [slack]);
    setRichTextFromPlainText(editor, 'second only', [slack]);
    const result = serializeRichText(editor.getEditorState());
    expect(result.text).toBe('second only');
    expect(result.mentions).toEqual([]);
  });

  it('handles an empty string (clears to an empty paragraph)', () => {
    const editor = makeEditor();
    setRichTextFromPlainText(editor, 'first', []);
    setRichTextFromPlainText(editor, '', []);
    expect(serializeRichText(editor.getEditorState())).toEqual({ text: '', mentions: [] });
  });

  it("does not create a mention node for a matched part whose entity.kind is 'unknown'", () => {
    // A known-entities list can never itself contain kind 'unknown' (that's
    // the parser's own sentinel for an unmatched token), but deserialize's
    // guard against it is real behavior worth locking down directly.
    const editor = makeEditor();
    const unknownKindEntity: MentionEntity = {
      id: 'weird',
      kind: 'unknown',
      label: 'weird',
      token: '@weird',
    };
    setRichTextFromPlainText(editor, '@weird', [unknownKindEntity]);
    const result = serializeRichText(editor.getEditorState());
    expect(result.text).toBe('@weird');
    expect(result.mentions).toEqual([]);
  });
});
