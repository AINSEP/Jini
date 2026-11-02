import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAgentPluginContent, moduleSpecifiers } from '../check-agent-plugin-content.js';

let root: string;
function write(required: { file: string; content: string }): void {
  const path = join(root, required.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, required.content);
}
const plugin = (name: string) => write({ file: `packages/agent-plugins/${name}/plugin.json`, content: `{"name":"${name}"}` });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jini-agent-plugin-content-'));
  plugin('fixture-host');
  plugin('fixture-other');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('agent plugin content imports', () => {
  it('accepts node built-ins, @jini-ai contracts and relative files inside the same plugin', () => {
    write({ file: 'packages/agent-plugins/fixture-host/lib/deploy.mjs', content: [
      "import { readFile } from 'node:fs/promises';",
      "import { sanitize } from '@jini-ai/core/plugin-directory';",
      "import { helper } from './helper.mjs';",
      "export { other } from '../skills/fixture-host/scripts/other.mjs';",
      "/** @type {import('./types.mjs').Options} */",
      "const options = await import('./optional.mjs');",
    ].join('\n') });
    expect(checkAgentPluginContent({ repoRoot: root })).toEqual([]);
  });

  it.each([
    ["import x from '../../fixture-other/lib/x.mjs';", 'imports a path outside its own plugin folder: ../../fixture-other/lib/x.mjs'],
    ["import x from '../../../../apps/website/src/server/x.mjs';", 'imports a path outside its own plugin folder: ../../../../apps/website/src/server/x.mjs'],
    ["import x from '@jini-ai/plugin-fly/plugin.json';", 'imports another plugin: @jini-ai/plugin-fly/plugin.json'],
    ["import x from '@jini-ai/provider-plugins';", 'imports another plugin: @jini-ai/provider-plugins'],
    ["import yaml from 'yaml';", 'imports a module that is neither node:*, @jini-ai/* nor relative: yaml'],
    ["import x from '/Users/someone/Tovu/x.mjs';", 'imports a module that is neither node:*, @jini-ai/* nor relative: /Users/someone/Tovu/x.mjs'],
    ["export * from '../../fixture-other/x.mjs';", 'imports a path outside its own plugin folder: ../../fixture-other/x.mjs'],
    ["const x = await import('../../fixture-other/x.mjs');", 'imports a path outside its own plugin folder: ../../fixture-other/x.mjs'],
    ["const x = require('fs');", 'imports a module that is neither node:*, @jini-ai/* nor relative: fs'],
    ["/** @param {import('../../fixture-other/types.mjs').T} value */\nexport const f = value => value;", 'imports a path outside its own plugin folder: ../../fixture-other/types.mjs'],
    ["export const f = 1;\n// @typedef {import('@jini-ai/plugin-render').X} X", 'imports another plugin: @jini-ai/plugin-render'],
  ])('refuses %s', (content, reason) => {
    write({ file: 'packages/agent-plugins/fixture-host/lib/deploy.mjs', content });
    expect(checkAgentPluginContent({ repoRoot: root })).toEqual([
      { rule: 'P2-agent-plugin-content', file: 'packages/agent-plugins/fixture-host/lib/deploy.mjs', reason },
    ]);
  });

  it('scans nested skill helpers but not dependency trees, and ignores folders without a plugin.json', () => {
    write({ file: 'packages/agent-plugins/fixture-host/skills/a/scripts/run.mjs', content: "import 'left-pad';" });
    write({ file: 'packages/agent-plugins/fixture-host/node_modules/dep/index.mjs', content: "import 'left-pad';" });
    write({ file: 'packages/agent-plugins/src/lifecycle/x.mjs', content: "import 'left-pad';" });
    expect(checkAgentPluginContent({ repoRoot: root }).map(violation => violation.file))
      .toEqual(['packages/agent-plugins/fixture-host/skills/a/scripts/run.mjs']);
  });

  it('does not read import-like text in strings as a module reference', () => {
    expect(moduleSpecifiers({ file: 'x.mjs', source: "const text = \"import('left-pad')\";\nexport default text;" })).toEqual([]);
  });

  it('the checked-in agent plugin content passes', () => {
    expect(checkAgentPluginContent({ repoRoot: fileURLToPath(new URL('../../', import.meta.url)) })).toEqual([]);
  });
});
