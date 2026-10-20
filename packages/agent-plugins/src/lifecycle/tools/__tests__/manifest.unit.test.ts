/**
 * @file Unit tests for the tool contribution parser: every rule that refuses a declaration file
 * (version, list bounds, name, description, effect, module, input schema, duplicates) and the
 * shape of an accepted descriptor. Pure: the parser does no I/O.
 */
import { describe, expect, test } from 'vitest';
import { parseAgentPluginToolsFile } from '../manifest.js';

const SCHEMA = { type: 'object', properties: { q: { type: 'string' } } };
const TOOL = { name: 'list_rows', description: 'Lists rows.', effect: 'read', module: 'tools/list.mjs', inputSchema: SCHEMA };

function parse(raw: string) {
  return parseAgentPluginToolsFile({ raw });
}

function parseTools(tools: readonly unknown[]) {
  return parse(JSON.stringify({ schemaVersion: 1, tools }));
}

function withTool(overrides: Record<string, unknown>) {
  return parseTools([{ ...TOOL, ...overrides }]);
}

describe('file shape', () => {
  test('accepts one declaration and returns a frozen descriptor without unknown keys', () => {
    const parsed = parseTools([{ ...TOOL, extra: 'ignored' }]);
    expect(parsed).toEqual({ ok: true, descriptors: [TOOL] });
    expect(Object.isFrozen(parsed.ok ? parsed.descriptors[0] : undefined)).toBe(true);
  });

  test('refuses text that is not JSON', () => {
    expect(parse('{not json')).toEqual({ ok: false, reason: 'not valid JSON' });
  });

  test('refuses a JSON array at the top level', () => {
    expect(parse('[]')).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
  });

  test('refuses another schema version', () => {
    expect(parse(JSON.stringify({ schemaVersion: 2, tools: [TOOL] }))).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
  });

  test('refuses tools that is not an array', () => {
    expect(parse(JSON.stringify({ schemaVersion: 1, tools: { a: TOOL } }))).toEqual({ ok: false, reason: 'tools must list 1 to 128 declarations' });
  });

  test('refuses an empty tool list', () => {
    expect(parseTools([])).toEqual({ ok: false, reason: 'tools must list 1 to 128 declarations' });
  });

  test('accepts exactly 128 declarations', () => {
    const tools = Array.from({ length: 128 }, (_, index) => ({ ...TOOL, name: `tool_${index}` }));
    const parsed = parseTools(tools);
    expect(parsed.ok && parsed.descriptors.length).toBe(128);
  });

  test('refuses 129 declarations', () => {
    const tools = Array.from({ length: 129 }, (_, index) => ({ ...TOOL, name: `tool_${index}` }));
    expect(parseTools(tools)).toEqual({ ok: false, reason: 'tools must list 1 to 128 declarations' });
  });

  test('refuses a declaration that is not an object', () => {
    expect(parseTools([TOOL, 'list_rows'])).toEqual({ ok: false, reason: 'every tool declaration must be an object' });
  });

  test('refuses the whole file when a later declaration is invalid', () => {
    expect(parseTools([TOOL, { ...TOOL, name: 'second', effect: 'admin' }])).toEqual({ ok: false, reason: "tool 'second' effect must be read, write or destructive" });
  });
});

describe('name', () => {
  test.each([['Upper'], ['1digit'], ['has-dash'], [`a${'b'.repeat(64)}`], [7]])('refuses %j', (name) => {
    expect(withTool({ name })).toEqual({ ok: false, reason: 'a tool name must be lower snake case, at most 64 characters' });
  });

  test('accepts a 64-character lower snake case name', () => {
    const name = `a${'b'.repeat(63)}`;
    expect(withTool({ name }).ok).toBe(true);
  });
});

describe('description', () => {
  const reason = "tool 'list_rows' needs a description of at most 8000 characters";

  test('refuses a missing description', () => {
    expect(withTool({ description: undefined })).toEqual({ ok: false, reason });
  });

  test('refuses a whitespace-only description', () => {
    expect(withTool({ description: '   ' })).toEqual({ ok: false, reason });
  });

  test('refuses a description over 8000 characters', () => {
    expect(withTool({ description: 'd'.repeat(8001) })).toEqual({ ok: false, reason });
  });

  test('accepts a description of exactly 8000 characters', () => {
    expect(withTool({ description: 'd'.repeat(8000) }).ok).toBe(true);
  });

  test('a description problem is reported before an effect problem', () => {
    expect(withTool({ description: '', effect: 'admin' })).toEqual({ ok: false, reason });
  });
});

describe('effect', () => {
  test.each(['write', 'destructive'])('accepts %s', (effect) => {
    expect(withTool({ effect }).ok).toBe(true);
  });

  test('an effect problem is reported before a module problem', () => {
    expect(withTool({ effect: 'admin', module: 'x.js' })).toEqual({ ok: false, reason: "tool 'list_rows' effect must be read, write or destructive" });
  });
});

describe('module', () => {
  const reason = "tool 'list_rows' module must be a .mjs path inside the plugin";

  test('refuses a non-string module', () => {
    expect(withTool({ module: 42 })).toEqual({ ok: false, reason });
  });

  test('refuses a module path over 256 characters', () => {
    expect(withTool({ module: `${'m'.repeat(253)}.mjs` })).toEqual({ ok: false, reason });
  });

  test('accepts a module path of exactly 256 characters', () => {
    expect(withTool({ module: `${'m'.repeat(252)}.mjs` }).ok).toBe(true);
  });
});

describe('input schema', () => {
  const reason = 'inputSchema must be a JSON Schema describing an object';

  test('refuses a missing schema', () => {
    expect(withTool({ inputSchema: undefined })).toEqual({ ok: false, reason });
  });

  test('refuses a schema whose type is not object', () => {
    expect(withTool({ inputSchema: { type: 'string' } })).toEqual({ ok: false, reason });
  });

  test('refuses a schema larger than 64 KiB', () => {
    expect(withTool({ inputSchema: { type: 'object', description: 'x'.repeat(65536) } })).toEqual({ ok: false, reason: 'inputSchema is larger than 64 KiB' });
  });

  test('measures the schema in UTF-8 bytes, not characters', () => {
    // 22,000 three-byte characters are 66,000 bytes: over the bound although far under it in length.
    expect(withTool({ inputSchema: { type: 'object', description: '€'.repeat(22000) } })).toEqual({ ok: false, reason: 'inputSchema is larger than 64 KiB' });
  });
});

test('a local name declared twice refuses the whole file', () => {
  expect(parseTools([TOOL, { ...TOOL }])).toEqual({ ok: false, reason: "tool 'list_rows' is declared more than once" });
});
