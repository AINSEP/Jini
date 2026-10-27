/**
 * @file The one vertical-slice proof: a real installed, bundled, active plugin ships a host-named
 * tool file and an `.mjs` module; the trusted loader imports it, the projection registers it in a
 * real ToolRegistry under `p_<plugin>__<local>`, and a call runs with injected fake capabilities.
 */
import { expect, test } from 'vitest';
import { createHarness, FAKE_TOKEN, installPlugin, toolsFile, TOOLS_FILENAME, withWorkspace } from './support.js';

const APPEND_MODULE = `export default {
  async invoke({ input, capabilities }) {
    const token = await capabilities.connections.getAccessToken({ connectionRef: input.connectionRef });
    const response = await capabilities.http.fetch({ url: 'https://api.example.test/tables/' + input.table + '/rows' },
      { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ values: input.values }) });
    return { status: response.status, appended: input.values.length };
  },
  describeAffectedResources({ input }) { return ['table ' + input.table]; },
};
`;

test('load a fake plugin .mjs tool, project it, invoke it with injected capabilities and get its result', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await installPlugin({ workspaceRoot, pluginId: 'acme-office', files: {
      [TOOLS_FILENAME]: toolsFile([{ name: 'append_rows', description: 'Append rows to a table.', effect: 'write', module: 'tools/append-rows.mjs',
        inputSchema: { type: 'object', required: ['connectionRef', 'table', 'values'], additionalProperties: false, properties: {
          connectionRef: { type: 'string' }, table: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } } } }]),
      'tools/append-rows.mjs': APPEND_MODULE,
    } });
    const harness = createHarness();

    expect(await harness.refresh()).toEqual([]);
    expect(harness.tools.has({ toolId: 'p_acme_office__append_rows' })).toBe(true);
    const input = { connectionRef: 'conn-1', table: 'leads', values: ['a', 'b'] };
    expect(await harness.projection.describeAffectedResources({ toolId: 'p_acme_office__append_rows', input })).toEqual({ effect: 'write', resources: ['table leads'], connections: ['conn-1'] });

    expect(await harness.invoke('p_acme_office__append_rows', input)).toEqual({ status: 200, appended: 2 });
    expect(harness.log.tokenRequests).toEqual(['conn-1']);
    expect(harness.log.requests).toEqual([{ url: 'https://api.example.test/tables/leads/rows',
      headers: { authorization: `Bearer ${FAKE_TOKEN}` }, body: '{"values":["a","b"]}' }]);
  });
});
