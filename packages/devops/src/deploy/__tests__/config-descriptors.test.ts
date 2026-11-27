import { describe, expect, it } from 'vitest';
import { asDeployConfigGeneratorModule, isContainedDeployConfigPath, parseDeployConfigsFile } from '../index.js';

const file = (generators: unknown) => JSON.stringify({ schemaVersion: 1, generators });

describe('parseDeployConfigsFile', () => {
  it('parses generators in declared order with their publish hints', () => {
    const entries = [
      { id: 'app-host', label: 'App host', module: 'configs/app-host.mjs', candidatePaths: [{ path: 'app-host.toml', order: 1 }] },
      { id: 'ci', label: 'CI', module: 'configs/ci.mjs', workflowFile: 'deploy.yml' },
    ];
    expect(parseDeployConfigsFile({ raw: file(entries) })).toEqual({ ok: true, descriptors: entries });
  });

  it('refuses a bad schema, a duplicate id, an escaping candidate path and a bad workflow file', () => {
    const entry = { id: 'a', label: 'A', module: 'a.mjs' };
    expect(parseDeployConfigsFile({ raw: JSON.stringify({ schemaVersion: 1 }) })).toEqual({ ok: false, reason: 'generators must be an array' });
    expect(parseDeployConfigsFile({ raw: file([entry, entry]) })).toEqual({ ok: false, reason: "generators[1].id 'a' is declared twice" });
    expect(parseDeployConfigsFile({ raw: file([{ ...entry, candidatePaths: [{ path: '../x', order: 1 }] }]) }))
      .toEqual({ ok: false, reason: 'generators[0].candidatePaths must contain repo-relative paths and finite orders' });
    expect(parseDeployConfigsFile({ raw: file([{ ...entry, workflowFile: 'a/b.yml' }]) })).toEqual({ ok: false, reason: 'generators[0].workflowFile must be a workflow filename' });
  });

  it('keeps declaration paths repo-relative', () => {
    expect(isContainedDeployConfigPath({ value: 'deploy/app.toml' })).toBe(true);
    for (const value of ['../app.toml', './app.toml', 'a//b', 'C:\\app', 42]) expect(isContainedDeployConfigPath({ value })).toBe(false);
  });
});

describe('asDeployConfigGeneratorModule', () => {
  it('accepts an export with render() and refuses anything else', () => {
    const module = { render: () => ({ filename: 'f', contents: '', notes: [] }) };
    expect(asDeployConfigGeneratorModule({ exported: module })).toBe(module);
    expect(asDeployConfigGeneratorModule({ exported: null })).toBe('its module has no render() function');
  });
});

it.each([
  { field: 'entry', entry: null, reason: 'generators[0] must be an object' },
  { field: 'id length', entry: { id: 'a'.repeat(65), label: 'A', module: 'a.mjs' }, reason: 'generators[0].id must be a lowercase hyphenated id' },
  { field: 'label', entry: { id: 'a', label: ' '.repeat(2), module: 'a.mjs' }, reason: 'generators[0].label must be a non-empty string' },
  { field: 'module', entry: { id: 'a', label: 'A', module: '/app.mjs' }, reason: 'generators[0].module must be a relative path ending in .mjs' },
  { field: 'candidate order', entry: { id: 'a', label: 'A', module: 'a.mjs', candidatePaths: [{ path: 'release.toml', order: '1' }] }, reason: 'generators[0].candidatePaths must contain repo-relative paths and finite orders' },
])('refuses an invalid generator $field with its location', ({ entry, reason }) => {
  expect(parseDeployConfigsFile({ raw: file([entry]) })).toEqual({ ok: false, reason });
});
