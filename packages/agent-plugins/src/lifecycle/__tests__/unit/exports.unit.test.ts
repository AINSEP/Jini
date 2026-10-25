import { describe, expect, it } from 'vitest';
import { parseAgentPluginExports, parseAgentPluginManifest, validateAgentPluginExportProps, type AgentPluginExport } from '../../manifest.js';

const definition: AgentPluginExport = {
  template: 'exports/sign-in.html',
  props: { type: 'object', properties: { variant: { type: 'string', enum: ['light', 'dark', 'neutral'] } }, additionalProperties: false },
  consent: 'necessary', staticExport: 'fallback-only', version: 3, minVersion: 2,
  aliases: ['old-button'], hostLinks: { signIn: 'member-login:example' },
  styles: 'exports/button.css', assets: { mark: 'exports/mark.svg' },
};
const parse = (entry: unknown = definition) => parseAgentPluginExports({ extension: { exports: { 'sign-in': entry } }, provides: ['member-login:example'] });
const plugin = (extension: Record<string, unknown>) => ({
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'fixture',
  extensions: { example: { id: 'publisher/fixture', provides: ['member-login:example'], ...extension } },
});

describe('plugin export contracts', () => {
  it('retains every declared field and explicit rename in the selected namespace', () => {
    const result = parseAgentPluginManifest({ value: plugin({ exports: { 'sign-in': definition }, renamedFrom: ['publisher/previous'] }) }, { identityNamespace: 'example' });
    expect(result).toMatchObject({ ok: true, manifest: { exports: { 'sign-in': definition }, renamedFrom: ['publisher/previous'] }, warnings: [] });
  });

  it('keeps legacy metadata absent and ignores other namespaces', () => {
    expect(parseAgentPluginExports({ extension: {}, provides: [] })).toEqual({ ok: true, metadata: {}, warnings: [] });
    const result = parseAgentPluginManifest({ value: plugin({ exports: { broken: null } }) }, { identityNamespace: 'other' });
    if (!result.ok) throw new Error(result.errors.join('; '));
    expect(Object.hasOwn(result.manifest, 'exports')).toBe(false);
    expect(Object.hasOwn(result.manifest, 'renamedFrom')).toBe(false);
  });

  it('warns about future export keys without refusing or exposing them as contract fields', () => {
    expect(parse({ ...definition, surfaces: ['future'] })).toEqual({
      ok: true, metadata: { exports: { 'sign-in': definition } },
      warnings: ["unrecognized exports.sign-in field 'surfaces' (ignored)"],
    });
  });

  it.each([undefined, null, [], 'exports'])('rejects a malformed exports block %j when present', value => {
    const result = parseAgentPluginExports({ extension: { exports: value }, provides: [] });
    expect(result.ok).toBe(value === undefined);
  });

  it.each([
    ['version', 0], ['version', 1.2], ['version', Number.MAX_SAFE_INTEGER + 1],
    ['minVersion', 0], ['minVersion', 4], ['consent', undefined], ['consent', 'other'],
    ['staticExport', undefined], ['staticExport', 'dynamic'], ['aliases', ['not a name']],
    ['hostLinks', { signIn: 'member-login:undeclared' }], ['hostLinks', []],
    ['props', { type: 'string' }], ['props', { type: 'object', pattern: 'ignored?' }],
    ['props', { type: 'object', additionalProperties: true }],
    ['template', '../escape.html'], ['template', 'C:\\escape.html'], ['template', '/absolute.html'],
    ['template', 'exports/%2e%2e/escape.html'], ['template', 'exports/button.js'],
    ['styles', '../escape.css'], ['assets', { mark: 'https://example.com/logo.png' }],
    ['assets', { mark: 'exports/code.js' }],
  ])('rejects invalid %s = %j', (key, value) => {
    expect(parse({ ...definition, [key]: value })).toMatchObject({ ok: false, errors: [expect.stringContaining('exports.sign-in:')] });
  });

  it('accepts minimum version 1 by omission and every approved consent/static mode', () => {
    const { minVersion: _minVersion, ...entry } = definition;
    for (const consent of ['necessary', 'functional', 'analytics', 'marketing']) {
      for (const staticExport of ['full', 'link-only', 'fallback-only']) {
        expect(parse({ ...entry, consent, staticExport }).ok).toBe(true);
      }
    }
    expect(parse({ ...definition, minVersion: 3 }).ok).toBe(true);
    expect(parse({ ...definition, assets: { mark: 'exports/mark.png' } }).ok).toBe(true);
  });

  it.each([{ renamedFrom: ['local-name'] }, { renamedFrom: ['unknown/fixture'] }, { renamedFrom: [4] }, { renamedFrom: 'publisher/old' }])('rejects invalid renamedFrom $renamedFrom', ({ renamedFrom }) => {
    expect(parseAgentPluginExports({ extension: { renamedFrom }, provides: [] })).toMatchObject({ ok: false });
  });

  const reasonOf = (entry: unknown) => {
    const result = parse(entry);
    return result.ok ? null : result.errors;
  };

  it.each([
    ['template', 123, 'template must be a contained .html path'],
    ['template', undefined, 'template must be a contained .html path'],
    ['styles', 7, 'styles must be a contained .css path'],
    ['styles', 'exports/button.js', 'styles must be a contained .css path'],
    ['aliases', [1], 'aliases must be an array of component names'],
    ['aliases', ['old-button', 'BAD NAME'], 'aliases must be an array of component names'],
    ['aliases', 'old-button', 'aliases must be an array of component names'],
    ['assets', { mark: 'exports/mark.svg', other: 'exports/code.js' }, 'assets must map names to contained .png or .svg paths'],
    ['assets', { mark: 5 }, 'assets must map names to contained .png or .svg paths'],
    ['assets', { '1bad': 'exports/mark.svg' }, 'assets must map names to contained .png or .svg paths'],
    ['assets', { 'a b': 'exports/mark.svg' }, 'assets must map names to contained .png or .svg paths'],
    ['assets', { 'x!': 'exports/mark.svg' }, 'assets must map names to contained .png or .svg paths'],
    ['hostLinks', { signIn: 'member-login:example', other: 'member-login:undeclared' }, 'hostLinks must name capabilities this plugin provides'],
    ['hostLinks', { signIn: 5 }, 'hostLinks must name capabilities this plugin provides'],
    ['hostLinks', { '1bad': 'member-login:example' }, 'hostLinks must name capabilities this plugin provides'],
    ['hostLinks', { 'x!': 'member-login:example' }, 'hostLinks must name capabilities this plugin provides'],
  ])('refuses %s = %j with the specific reason and never throws', (key, value, message) => {
    expect(reasonOf({ ...definition, [key]: value })).toEqual([`exports.sign-in: ${message}`]);
  });

  it.each([
    ['template', 'x.html'], ['template', 'a/b/c.html'], ['styles', 'a/b/c.css'], ['styles', 'x.css'],
  ])('accepts portable %s path %s at any directory depth', (key, value) => {
    expect(parse({ ...definition, [key]: value }).ok).toBe(true);
    expect(parse({ ...definition, assets: { mark: 'a/b/c.png', flat: 'x.svg' } }).ok).toBe(true);
  });

  it('refuses a non-object entry and a non-object exports block with specific reasons', () => {
    expect(parseAgentPluginExports({ extension: { exports: 'x' }, provides: [] })).toEqual({ ok: false, errors: ['exports must be an object keyed by component name'] });
    expect(parseAgentPluginExports({ extension: { exports: { a: 'x' } }, provides: [] })).toEqual({ ok: false, errors: ['exports.a: must be an object'] });
    expect(parseAgentPluginExports({ extension: { exports: [] }, provides: [] })).toEqual({ ok: false, errors: ['exports must be an object keyed by component name'] });
  });

  it.each([
    [{ renamedFrom: ['publisher/previous', 'local-name'] }], [{ renamedFrom: [4] }], [{ renamedFrom: 'publisher/old' }],
  ])('names the renamedFrom failure for %j', extension => {
    expect(parseAgentPluginExports({ extension, provides: [] })).toEqual({ ok: false, errors: ['renamedFrom must be an array of publisher-qualified plugin ids'] });
  });

  it.each([
    [{ version: 0 }, 'version must be a positive safe integer'],
    [{ minVersion: 4 }, 'minVersion must be between 1 and version'],
    [{ consent: 'other' }, 'consent must name a consent category'],
    [{ staticExport: 'dynamic' }, 'staticExport must be full, link-only or fallback-only'],
    [{ props: { type: 'string' } }, 'props must declare an object schema'],
  ])('reports %j with its own message', (patch, message) => {
    expect(reasonOf({ ...definition, ...patch })?.[0]).toContain(message);
  });

  it('refuses an invalid component name with its reason', () => {
    expect(parseAgentPluginExports({ extension: { exports: { 'Bad Name': definition } }, provides: ['member-login:example'] })).toEqual({ ok: false, errors: ['exports.Bad Name: invalid component name'] });
  });

  it('rejects invalid contracts through the manifest parser', () => {
    expect(parseAgentPluginManifest({ value: plugin({ exports: { 'sign-in': { ...definition, version: -1 } } }) }, { identityNamespace: 'example' }))
      .toEqual({ ok: false, errors: ['exports.sign-in: version must be a positive safe integer'] });
  });

  it('safely handles prototype-named component keys without mutating the source', () => {
    const result = parseAgentPluginExports({ extension: { exports: { constructor: definition } }, provides: ['member-login:example'] });
    expect(result).toEqual({ ok: true, metadata: { exports: { constructor: definition } }, warnings: [] });
    if (!result.ok) throw new Error(result.errors.join('; '));
    expect(Object.hasOwn(result.metadata.exports!, 'constructor')).toBe(true);
    const exports = Object.fromEntries([['constructor', definition], ['__proto__', definition]]);
    expect(parseAgentPluginExports({ extension: { exports }, provides: ['member-login:example'] })).toEqual({ ok: false, errors: ['exports.__proto__: invalid component name'] });
    expect(Object.keys(exports)).toEqual(['constructor', '__proto__']);
    expect(parse(null)).toEqual({ ok: false, errors: ['exports.sign-in: must be an object'] });
  });
});

describe('plugin export props', () => {
  it('uses the closed schema for valid, invalid and missing properties', () => {
    expect(validateAgentPluginExportProps({ definition, props: { variant: 'dark' } })).toBeNull();
    expect(validateAgentPluginExportProps({ definition, props: {} })).toBeNull();
    expect(validateAgentPluginExportProps({ definition, props: { variant: 'arbitrary' } })).toBe('$.variant is not one of the allowed values');
    expect(validateAgentPluginExportProps({ definition, props: { extra: 'secret-value' } })).toBe('$ has an undeclared property "extra"');
    expect(validateAgentPluginExportProps({ definition, props: null })).toBe('$ must be an object');
    expect(validateAgentPluginExportProps({ definition: { ...definition, props: { ...definition.props, required: ['variant'] } }, props: {} })).toBe('$.variant is required');
  });

  it('reuses the action payload cap and refuses unserializable props', () => {
    expect(validateAgentPluginExportProps({ definition, props: { variant: 'x'.repeat(65536) } })).toBe('props exceed the payload limit');
    const props: Record<string, unknown> = {};
    props.self = props;
    expect(validateAgentPluginExportProps({ definition, props })).toBe('props exceed the payload limit');
  });

  it('reuses the schema depth limit', () => {
    let props: unknown = { type: 'string' };
    for (let depth = 0; depth < 10; depth++) props = { type: 'object', properties: { child: props } };
    expect(parse({ ...definition, props })).toMatchObject({ ok: false, errors: [expect.stringContaining('nests deeper than 8 levels')] });
  });
});
