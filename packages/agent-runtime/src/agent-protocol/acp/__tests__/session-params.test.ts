import { describe, expect, it } from 'vitest';
import { buildAcpSessionNewParams, buildPromptBlocks } from '../session-params.js';
import path from 'node:path';

describe('buildAcpSessionNewParams', () => {
  it('resolves cwd to an absolute path and defaults to no MCP servers', () => {
    const params = buildAcpSessionNewParams({ cwd: 'some/relative/dir' });
    expect(params.cwd).toBe(path.resolve('some/relative/dir'));
    expect(params.mcpServers).toEqual([]);
  });

  it('normalises a server with array-format env, keeping array format by default', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, {
      mcpServers: [
        { type: 'stdio', name: 'srv', command: 'cmd', args: ['--a'], env: [{ name: 'K', value: 'v' }] },
      ],
    });
    expect(params.mcpServers).toEqual([
      { type: 'stdio', name: 'srv', command: 'cmd', args: ['--a'], env: [{ name: 'K', value: 'v' }] },
    ]);
  });

  it('converts array-format env to map format when envFormat is "map"', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, {
      mcpServers: [{ env: [{ name: 'K', value: 'v' }] }],
      envFormat: 'map',
    });
    expect(params.mcpServers).toEqual([{ type: 'stdio', name: '', command: '', args: [], env: { K: 'v' } }]);
  });

  it('passes a plain-object env through unchanged when envFormat is "map"', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, {
      mcpServers: [{ type: 'http', name: 'srv', command: 'cmd', args: ['x'], env: { K: 'v' } }],
      envFormat: 'map',
    });
    expect(params.mcpServers).toEqual([{ type: 'http', name: 'srv', command: 'cmd', args: ['x'], env: { K: 'v' } }]);
  });

  it('defaults type/name/command/args in the map+plain-object-env branch when absent', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, {
      mcpServers: [{ env: { K: 'v' } }],
      envFormat: 'map',
    });
    expect(params.mcpServers).toEqual([{ type: 'stdio', name: '', command: '', args: [], env: { K: 'v' } }]);
  });

  it('converts a plain-object env to array format when envFormat is "array" (default)', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, {
      mcpServers: [{ env: { K: 'v', J: 'w' } }],
    });
    expect(params.mcpServers).toEqual([
      { type: 'stdio', name: '', command: '', args: [], env: [{ name: 'K', value: 'v' }, { name: 'J', value: 'w' }] },
    ]);
  });

  it('defaults type/name/command/args/env when the server entry has none', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, { mcpServers: [{}] });
    expect(params.mcpServers).toEqual([{ type: 'stdio', name: '', command: '', args: [], env: [] }]);
  });

  it('handles a missing env field entirely (array mode)', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, { mcpServers: [{ name: 'x' }] });
    expect(params.mcpServers[0]!.env).toEqual([]);
  });

  it('handles a missing env field entirely (map mode)', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, { mcpServers: [{ name: 'x' }], envFormat: 'map' });
    expect(params.mcpServers[0]!.env).toEqual({});
  });

  it('ignores a non-array mcpServers value (treats it as no servers)', () => {
    // @ts-expect-error - exercising the runtime Array.isArray guard directly
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, { mcpServers: 'not-an-array' });
    expect(params.mcpServers).toEqual([]);
  });

  it('handles an env array entry missing name/value keys (map mode)', () => {
    const params = buildAcpSessionNewParams({ cwd: '/tmp' }, {
      mcpServers: [{ env: [{}] }],
      envFormat: 'map',
    });
    expect(params.mcpServers[0]!.env).toEqual({ '': '' });
  });
});

describe('buildPromptBlocks', () => {
  it('always includes a leading text block', () => {
    expect(buildPromptBlocks('hello', [])).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('appends a resource_link block per non-empty image path', () => {
    expect(buildPromptBlocks('hello', ['/a.png', '/b.png'])).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'resource_link', uri: '/a.png' },
      { type: 'resource_link', uri: '/b.png' },
    ]);
  });

  it('skips empty or whitespace-only image paths', () => {
    expect(buildPromptBlocks('hello', ['', '   ', '/a.png'])).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'resource_link', uri: '/a.png' },
    ]);
  });

  it('skips non-string image path entries', () => {
    // @ts-expect-error - exercising the runtime typeof guard directly
    expect(buildPromptBlocks('hello', [42])).toEqual([{ type: 'text', text: 'hello' }]);
  });
});
