import { describe, expect, it } from 'vitest';
import { assertRepairKeywords, missingArgumentGuidance } from '../tool-input-repairs.js';

const schemaOf = (properties: Record<string, unknown>, required: readonly string[]) => ({ type: 'object', required, properties });
const THEME_ID = { type: 'string', obtainFrom: 'theme_list' };
const known = (...ids: string[]) => ({ isKnownTool: (toolId: string) => ids.includes(toolId) });

describe('missingArgumentGuidance', () => {
  it('names the tool that lists valid values for a required property the input lacks', () => {
    expect(missingArgumentGuidance({ inputSchema: schemaOf({ themeId: THEME_ID }, ['themeId']), input: {} }, known('theme_list')))
      .toEqual([{ property: 'themeId', toolId: 'theme_list', sentence: 'List valid values for `themeId` with theme_list.' }]);
  });

  it('says nothing for a required property that is present', () => {
    expect(missingArgumentGuidance({ inputSchema: schemaOf({ themeId: THEME_ID }, ['themeId']), input: { themeId: 'dark' } }, known('theme_list'))).toEqual([]);
  });

  it('says nothing for a required property that declares no obtainFrom', () => {
    expect(missingArgumentGuidance({ inputSchema: schemaOf({ themeId: { type: 'string' } }, ['themeId']), input: {} }, known('theme_list'))).toEqual([]);
  });

  it('says nothing for an optional property, even one that declares obtainFrom', () => {
    expect(missingArgumentGuidance({ inputSchema: schemaOf({ themeId: THEME_ID }, []), input: {} }, known('theme_list'))).toEqual([]);
  });

  it('never points at a tool the caller cannot see', () => {
    expect(missingArgumentGuidance({ inputSchema: schemaOf({ themeId: THEME_ID }, ['themeId']), input: {} }, known('menus_list'))).toEqual([]);
  });

  it('treats an input that is not an object as having none of the properties', () => {
    expect(missingArgumentGuidance({ inputSchema: schemaOf({ themeId: THEME_ID }, ['themeId']), input: 'nope' }, known('theme_list'))).toHaveLength(1);
  });

  it('says nothing for a schema that is not an object schema', () => {
    expect(missingArgumentGuidance({ inputSchema: undefined, input: {} }, known('theme_list'))).toEqual([]);
    expect(missingArgumentGuidance({ inputSchema: { required: 'themeId' }, input: {} }, known('theme_list'))).toEqual([]);
  });

  it('answers one entry per property, in the schema\'s required order', () => {
    const inputSchema = schemaOf({ themeId: THEME_ID, menuId: { type: 'string', obtainFrom: 'menus_list' } }, ['menuId', 'themeId']);
    expect(missingArgumentGuidance({ inputSchema, input: {} }, known('theme_list', 'menus_list')).map((entry) => entry.property)).toEqual(['menuId', 'themeId']);
  });

  it('does not mutate its arguments', () => {
    const inputSchema = schemaOf({ themeId: THEME_ID }, ['themeId']);
    const input = { other: 1 };
    const before = JSON.stringify({ inputSchema, input });
    missingArgumentGuidance({ inputSchema, input }, known('theme_list'));
    expect(JSON.stringify({ inputSchema, input })).toBe(before);
  });
});

describe('assertRepairKeywords: obtainFrom', () => {
  it('accepts a property that names a tool id', () => {
    expect(() => assertRepairKeywords({ inputSchema: schemaOf({ themeId: THEME_ID }, []) })).not.toThrow();
  });

  it.each([[''], [7], [true], [['theme_list']]])('refuses obtainFrom %j with the property path', (obtainFrom) => {
    const inputSchema = schemaOf({ page: schemaOf({ themeId: { type: 'string', obtainFrom } }, []) }, []);
    expect(() => assertRepairKeywords({ inputSchema })).toThrow("obtainFrom on 'page.themeId' must be the id of a tool");
  });
});

it('provides the repair hint without a visibility callback and ignores malformed required entries', () => {
  const inputSchema = { type: 'object', required: [42, 'themeId'], properties: { themeId: THEME_ID } };
  expect(missingArgumentGuidance({ inputSchema, input: {} }))
    .toEqual([{ property: 'themeId', toolId: 'theme_list', sentence: 'List valid values for `themeId` with theme_list.' }]);
});
