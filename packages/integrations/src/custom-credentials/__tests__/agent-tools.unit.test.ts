import { describe, expect, it } from 'vitest';
import { buildCustomCredentialsAgentToolCatalog, type CustomCredentialsAgentToolCopy } from '../agent-tools.js';

const copy: CustomCredentialsAgentToolCopy = {
  labelField: 'Label text',
  tools: { list: 'List text', verify: 'Verify text', makeRequest: 'Request text', setUsername: 'User text', writeFiles: 'Files text' },
  makeRequestFields: { method: 'M', url: 'U', headers: 'H', body: 'B' },
  setUsernameFields: { username: 'Name' },
  writeFilesFields: { owner: 'O', repo: 'R', branch: 'Br', commitMessage: 'CM', path: 'P', content: 'C', files: 'F' },
};
const ids = { list: 't_list', verify: 't_verify', makeRequest: 't_req', setUsername: 't_user', writeFiles: 't_files' };

function build(maxFiles = 7) {
  return buildCustomCredentialsAgentToolCatalog({ ids, permissions: { read: 'p.read', write: 'p.write' }, copy, writeFilesLimits: { maxFiles } });
}

describe('buildCustomCredentialsAgentToolCatalog', () => {
  it('names five tools with host ids, copy, risk and permission split', () => {
    expect(build().map(t => [t.name, t.description, t.sideEffects, t.authorization?.permission])).toEqual([
      ['t_list', 'List text', 'none', 'p.read'],
      ['t_verify', 'Verify text', 'none', 'p.read'],
      ['t_req', 'Request text', 'mutates-durable-state', 'p.write'],
      ['t_user', 'User text', 'mutates-durable-state', 'p.write'],
      ['t_files', 'Files text', 'mutates-durable-state', 'p.write'],
    ]);
  });

  it('every schema is closed and label-bearing tools describe label with the shared copy', () => {
    const tools = build();
    for (const tool of tools) expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(tools[0]!.inputSchema).toEqual({ type: 'object', additionalProperties: false, required: [], properties: {} });
    for (const tool of tools.slice(1)) expect((tool.inputSchema as { properties: { label: unknown } }).properties.label).toEqual({ type: 'string', description: 'Label text' });
    expect(tools[1]!.inputSchema).toMatchObject({ required: ['label'] });
  });

  it('make-request allows only the five methods and string headers', () => {
    expect(build()[2]!.inputSchema).toEqual({ type: 'object', additionalProperties: false, required: ['label', 'method', 'url'], properties: {
      label: { type: 'string', description: 'Label text' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'M' },
      url: { type: 'string', description: 'U' },
      headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'H' },
      body: { type: 'string', description: 'B' },
    } });
  });

  it('set-username requires a username that may be null and has no token field', () => {
    const schema = build()[3]!.inputSchema as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(['label', 'username']);
    expect(schema.properties).toEqual({ label: { type: 'string', description: 'Label text' }, username: { type: ['string', 'null'], description: 'Name' } });
  });

  it('write-files caps the file count at the host limit with closed file items', () => {
    const schema = build(3)[4]!.inputSchema as { required: string[]; properties: Record<string, Record<string, unknown>> };
    expect(schema.required).toEqual(['label', 'owner', 'repo', 'branch', 'commitMessage', 'files']);
    expect(schema.properties.files).toEqual({ type: 'array', minItems: 1, maxItems: 3, description: 'F', items: { type: 'object', additionalProperties: false, required: ['path', 'content'],
      properties: { path: { type: 'string', description: 'P' }, content: { type: 'string', description: 'C' } } } });
    expect([schema.properties.owner, schema.properties.repo, schema.properties.branch, schema.properties.commitMessage].map(p => p!.description)).toEqual(['O', 'R', 'Br', 'CM']);
  });
});
