import { describe, expect, it } from 'vitest';
import {
  emptySourceDraft,
  isActionPending,
  issueForField,
  maskFieldValue,
  pendingActionKey,
  removeSourceById,
  sourceDisplayLabel,
  updateSourceById,
  upsertSourceById,
  validateSourceDraft,
  withoutPendingAction,
  withPendingAction,
} from '../../../features/source-config-list/rules.js';
import type { SourceConfigItem, SourceFieldSpec } from '../../../features/source-config-list/types.js';

const URL_FIELD: SourceFieldSpec = { key: 'url', label: 'URL', kind: 'url', required: true };
const KEY_FIELD: SourceFieldSpec = { key: 'apiKey', label: 'API Key', kind: 'password', required: true };
const OPTIONAL_FIELD: SourceFieldSpec = { key: 'label', label: 'Label', kind: 'text' };

function makeSource(overrides: Partial<SourceConfigItem> = {}): SourceConfigItem {
  return { id: 's1', fields: { url: 'https://example.com' }, ...overrides };
}

describe('emptySourceDraft', () => {
  it('seeds an empty string for every field spec key', () => {
    expect(emptySourceDraft({ fieldSpecs: [URL_FIELD, KEY_FIELD] })).toEqual({ url: '', apiKey: '' });
  });

  it('returns an empty object for no specs', () => {
    expect(emptySourceDraft({ fieldSpecs: [] })).toEqual({});
  });
});

describe('validateSourceDraft', () => {
  it('is ok when every required field is present and valid', () => {
    const result = validateSourceDraft({ fieldSpecs: [URL_FIELD, OPTIONAL_FIELD], values: { url: 'https://example.com', label: '' } });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('flags a missing required field', () => {
    const result = validateSourceDraft({ fieldSpecs: [URL_FIELD], values: { url: '' } });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ field: 'url', message: '{label} is required.' }]);
  });

  it('flags a required field that is only whitespace', () => {
    const result = validateSourceDraft({ fieldSpecs: [URL_FIELD], values: { url: '   ' } });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.field).toBe('url');
  });

  it('flags an invalid url-kind value even when non-empty', () => {
    const result = validateSourceDraft({ fieldSpecs: [URL_FIELD], values: { url: 'not-a-url' } });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([{ field: 'url', message: '{label} must be a valid http:// or https:// URL.' }]);
  });

  it('rejects a non-http(s) url-kind value', () => {
    const result = validateSourceDraft({ fieldSpecs: [URL_FIELD], values: { url: 'ftp://example.com/file' } });
    expect(result.ok).toBe(false);
  });

  it('does not require an optional field', () => {
    const result = validateSourceDraft({ fieldSpecs: [OPTIONAL_FIELD], values: { label: '' } });
    expect(result.ok).toBe(true);
  });

  it('does not url-validate an empty optional url field', () => {
    const optionalUrl: SourceFieldSpec = { key: 'homepage', label: 'Homepage', kind: 'url' };
    const result = validateSourceDraft({ fieldSpecs: [optionalUrl], values: { homepage: '' } });
    expect(result.ok).toBe(true);
  });

  it('treats a missing key in the values map as empty', () => {
    const result = validateSourceDraft({ fieldSpecs: [URL_FIELD], values: {} });
    expect(result.ok).toBe(false);
  });

  it('accumulates issues across multiple fields', () => {
    const result = validateSourceDraft({ fieldSpecs: [URL_FIELD, KEY_FIELD], values: { url: '', apiKey: '' } });
    expect(result.issues).toHaveLength(2);
  });
});

describe('issueForField', () => {
  it('finds the issue matching a field key', () => {
    const validation = validateSourceDraft({ fieldSpecs: [URL_FIELD, KEY_FIELD], values: { url: '', apiKey: 'x' } });
    expect(issueForField({ validation, fieldKey: 'url' })?.message).toBe('{label} is required.');
  });

  it('returns undefined when no issue matches', () => {
    const validation = validateSourceDraft({ fieldSpecs: [URL_FIELD], values: { url: 'https://example.com' } });
    expect(issueForField({ validation, fieldKey: 'url' })).toBeUndefined();
  });
});

describe('pendingActionKey / isActionPending / withPendingAction / withoutPendingAction', () => {
  it('builds a stable "kind:id" key', () => {
    expect(pendingActionKey({ id: 's1', kind: 'remove' })).toBe('remove:s1');
  });

  it('tracks pending state per (id, kind) independently', () => {
    let keys = withPendingAction({ pendingKeys: new Set(), id: 's1', kind: 'refresh' });
    expect(isActionPending({ pendingKeys: keys, id: 's1', kind: 'refresh' })).toBe(true);
    expect(isActionPending({ pendingKeys: keys, id: 's1', kind: 'remove' })).toBe(false);
    expect(isActionPending({ pendingKeys: keys, id: 's2', kind: 'refresh' })).toBe(false);

    keys = withPendingAction({ pendingKeys: keys, id: 's1', kind: 'remove' });
    expect(isActionPending({ pendingKeys: keys, id: 's1', kind: 'remove' })).toBe(true);
    expect(isActionPending({ pendingKeys: keys, id: 's1', kind: 'refresh' })).toBe(true);

    keys = withoutPendingAction({ pendingKeys: keys, id: 's1', kind: 'refresh' });
    expect(isActionPending({ pendingKeys: keys, id: 's1', kind: 'refresh' })).toBe(false);
    expect(isActionPending({ pendingKeys: keys, id: 's1', kind: 'remove' })).toBe(true);
  });

  it('withoutPendingAction is a no-op (same-value semantics) when the key was never pending', () => {
    const keys = new Set<string>();
    const next = withoutPendingAction({ pendingKeys: keys, id: 's1', kind: 'test' });
    expect(next).toEqual(keys);
  });

  it('withPendingAction does not mutate the input set', () => {
    const original = new Set<string>();
    withPendingAction({ pendingKeys: original, id: 's1', kind: 'add' });
    expect(original.size).toBe(0);
  });
});

describe('upsertSourceById / removeSourceById / updateSourceById', () => {
  it('upsertSourceById appends a new id', () => {
    const list = [makeSource({ id: 'a' })];
    const next = upsertSourceById({ list, next: makeSource({ id: 'b' }) });
    expect(next.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('upsertSourceById replaces an existing id in place', () => {
    const list = [makeSource({ id: 'a', label: 'old' }), makeSource({ id: 'b' })];
    const next = upsertSourceById({ list, next: makeSource({ id: 'a', label: 'new' }) });
    expect(next.map((s) => s.id)).toEqual(['a', 'b']);
    expect(next[0]?.label).toBe('new');
  });

  it('removeSourceById drops the matching id and leaves others untouched', () => {
    const list = [makeSource({ id: 'a' }), makeSource({ id: 'b' })];
    expect(removeSourceById({ list, id: 'a' }).map((s) => s.id)).toEqual(['b']);
  });

  it('removeSourceById is a no-op when the id is absent', () => {
    const list = [makeSource({ id: 'a' })];
    expect(removeSourceById({ list, id: 'zzz' })).toEqual(list);
  });

  it('updateSourceById patches only the matching item', () => {
    const list = [makeSource({ id: 'a', trust: 'restricted' }), makeSource({ id: 'b', trust: 'restricted' })];
    const next = updateSourceById({ list, id: 'a', patch: { trust: 'trusted' } });
    expect(next.find((s) => s.id === 'a')?.trust).toBe('trusted');
    expect(next.find((s) => s.id === 'b')?.trust).toBe('restricted');
  });
});

describe('maskFieldValue', () => {
  it('passes through non-password kinds unchanged', () => {
    expect(maskFieldValue({ kind: 'text', value: 'hello' })).toBe('hello');
    expect(maskFieldValue({ kind: 'url', value: 'https://example.com' })).toBe('https://example.com');
  });

  it('passes through an empty value unchanged', () => {
    expect(maskFieldValue({ kind: 'password', value: '' })).toBe('');
  });

  it('masks a long password, keeping the trailing 4 characters visible', () => {
    const masked = maskFieldValue({ kind: 'password', value: 'sk-ant-1234567890wxyz' });
    expect(masked.endsWith('wxyz')).toBe(true);
    expect(masked).not.toContain('1234567890');
    expect(masked.startsWith('•')).toBe(true);
  });

  it('enforces a minimum mask length for a very short secret', () => {
    const masked = maskFieldValue({ kind: 'password', value: 'abc' });
    // Short secret: no suffix is revealed (length <= visible-suffix length), and the mask
    // itself is padded to MASKED_VALUE_MIN_MASK_LENGTH so a 3-char secret's length doesn't leak.
    expect(masked).toBe('••••••');
  });

  it('masks a value exactly at the visible-suffix boundary with no visible suffix', () => {
    const masked = maskFieldValue({ kind: 'password', value: 'abcd' });
    expect(masked).toBe('••••••');
  });
});

describe('sourceDisplayLabel', () => {
  it('prefers an explicit label', () => {
    const source = makeSource({ label: 'My Server' });
    expect(sourceDisplayLabel({ source, fieldSpecs: [URL_FIELD] })).toBe('My Server');
  });

  it('falls back to the first field spec value when label is absent', () => {
    const source = makeSource({ fields: { url: 'https://example.com' } });
    expect(sourceDisplayLabel({ source, fieldSpecs: [URL_FIELD] })).toBe('https://example.com');
  });

  it('falls back to the id when label and first field are both empty', () => {
    const source = makeSource({ id: 'source-9', fields: { url: '' } });
    expect(sourceDisplayLabel({ source, fieldSpecs: [URL_FIELD] })).toBe('source-9');
  });

  it('falls back to the id when there are no field specs at all', () => {
    const source = makeSource({ id: 'source-9', fields: {} });
    expect(sourceDisplayLabel({ source, fieldSpecs: [] })).toBe('source-9');
  });

  it('treats a whitespace-only label as absent', () => {
    const source = makeSource({ label: '   ', fields: { url: 'https://example.com' } });
    expect(sourceDisplayLabel({ source, fieldSpecs: [URL_FIELD] })).toBe('https://example.com');
  });

  it('masks the fallback value when the first field spec is password-kind, so a labelless secret never leaks into the summary', () => {
    const source = makeSource({ fields: { apiKey: 'sk-ant-1234567890wxyz' } });
    const label = sourceDisplayLabel({ source, fieldSpecs: [KEY_FIELD] });
    expect(label).not.toBe('sk-ant-1234567890wxyz');
    expect(label.endsWith('wxyz')).toBe(true);
  });
});

describe('maskFieldValue — secret-textarea (MCP env block)', () => {
  it('masks each value while keeping the variable name visible', () => {
    const masked = maskFieldValue({ kind: 'secret-textarea', value: 'GITHUB_TOKEN=ghp_liveSecret123\nDEBUG=true' });
    expect(masked).toContain('GITHUB_TOKEN=');
    expect(masked).toContain('DEBUG=');
    // The point of keeping names: an operator must still see WHICH vars are set.
    expect(masked).not.toContain('ghp_liveSecret123');
    expect(masked).not.toContain('true');
  });

  it('fails closed on a line with no `=` rather than passing it through', () => {
    const masked = maskFieldValue({ kind: 'secret-textarea', value: 'just-a-bare-secret' });
    expect(masked).not.toContain('just-a-bare-secret');
  });

  it('leaves blank lines alone and preserves line structure', () => {
    const masked = maskFieldValue({ kind: 'secret-textarea', value: 'A=1\n\nB=2' });
    expect(masked.split('\n')).toHaveLength(3);
    expect(masked.split('\n')[1]).toBe('');
  });

  it('still passes plain textarea through unchanged', () => {
    expect(maskFieldValue({ kind: 'textarea', value: 'GITHUB_TOKEN=ghp_x' })).toBe('GITHUB_TOKEN=ghp_x');
  });

  it('still masks a whole password value', () => {
    expect(maskFieldValue({ kind: 'password', value: 'sk-ant-1234567890wxyz' })).toMatch(/^•+wxyz$/);
  });
});
