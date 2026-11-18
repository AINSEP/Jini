import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_DEFS, getAgentDef } from '../../registry.js';
import * as definitions from '../index.js';

/** The committed matrix (`docs/mcp-tool-call-behaviour.md`): one row per def, first cell the def id in backticks. */
const DOC = readFileSync(new URL('../../../docs/mcp-tool-call-behaviour.md', import.meta.url), 'utf8');

interface MatrixRow { id: string; transport: string; state: string; source: string }

function matrixRows(): MatrixRow[] {
  return DOC.split('\n')
    .filter(line => /^\| `[a-z0-9-]+` \|/.test(line))
    .map(line => {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
      return { id: cells[0]!.replaceAll('`', ''), transport: cells[2]!.replaceAll('`', ''), state: cells[3]!, source: cells[9]! };
    });
}

const UNSUPPORTED = new Map([['gemini', 'unsupported: retired def'], ['aider', 'unsupported: no tool transport']]);
const rows = matrixRows();
const rowFor = (id: string): MatrixRow | undefined => rows.find(row => row.id === id);

describe('mcp-tool-call matrix', () => {
  it('has exactly one row per def id', () => {
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
  });

  it('has a row, with the def\'s own transport, for every def that has externalMcpInjection', () => {
    const withTransport = AGENT_DEFS.filter(def => def.externalMcpInjection !== undefined);
    expect(withTransport.length).toBeGreaterThan(0);
    for (const def of withTransport) {
      expect(rowFor(def.id), `${def.id} has externalMcpInjection but no matrix row`).toBeDefined();
      expect(rowFor(def.id)!.transport, `${def.id} transport`).toBe(def.externalMcpInjection);
    }
  });

  it('has no row for a def that lost its transport, apart from the two recorded unsupported rows', () => {
    for (const row of rows) {
      if (UNSUPPORTED.has(row.id)) continue;
      const def = AGENT_DEFS.find(candidate => candidate.id === row.id);
      expect(def, `${row.id} is in the matrix but not in the registry`).toBeDefined();
      expect(def!.externalMcpInjection, `${row.id} lost its externalMcpInjection; remove or update its row`).toBeDefined();
    }
  });

  it('names a source for every row and a reason for every unknown one', () => {
    for (const row of rows) {
      expect(row.source, `${row.id} source`).toMatch(/^S\d+$/);
      expect(['source-read', 'unknown', ...UNSUPPORTED.values()], `${row.id} state`).toContain(row.state);
    }
    for (const source of new Set(rows.map(row => row.source))) {
      expect(DOC, `source ${source} is described`).toContain(`- **${source}**`);
    }
  });

  it('records gemini as unsupported and keeps it unselectable', () => {
    expect(rowFor('gemini')?.state).toBe(UNSUPPORTED.get('gemini'));
    expect(AGENT_DEFS.map(def => def.id)).not.toContain('gemini');
    expect(getAgentDef({ id: 'gemini' })).toBeNull();
    expect(Object.keys(definitions)).not.toContain('geminiAgentDef');
  });

  it('records aider as unsupported and keeps it a def with no MCP client and no transport', () => {
    expect(rowFor('aider')?.state).toBe(UNSUPPORTED.get('aider'));
    const aider = getAgentDef({ id: 'aider' });
    expect(aider?.mcpIsolation).toBe('no-client');
    expect(aider?.externalMcpInjection).toBeUndefined();
  });
});
