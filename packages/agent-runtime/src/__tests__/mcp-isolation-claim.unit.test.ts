/** Security review C (2026-11-16): a per-run MCP isolation claim lets `planRun` skip the personal-MCP
 * consent. It is only true when the arguments the definition builds really isolate the run, so every
 * claim in the registry is checked here against built arguments, across the whole option matrix. */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { NativeToolPolicyInput } from '@jini-ai/core/contracts/agents';
import { planRun } from '../native-tool-policy.js';
import { AGENT_DEFS } from '../registry.js';

const ISOLATION_FLAG = '--strict-mcp-config';
const STAGED_CONFIG = '/tmp/run-1/.mcp.json';
/** The folder limit is validated against the real filesystem before any argument is built. */
const FOLDER = realpathSync(mkdtempSync(join(tmpdir(), 'mcp-isolation-claim-')));
afterAll(() => rmSync(FOLDER, { recursive: true, force: true }));

interface Cell { userMcp: boolean | undefined; staged: boolean; parityBypass: boolean; folderLimit: boolean }

/** {capability true / false / unset} x {config staged / not} x {parity+bypass / not} x {folder limit / none}. */
const CELLS: readonly Cell[] = [true, false, undefined].flatMap(userMcp => [true, false].flatMap(staged =>
  [true, false].flatMap(parityBypass => [true, false].map(folderLimit => ({ userMcp, staged, parityBypass, folderLimit })))));

function policyFor({ userMcp, parityBypass }: Cell): NativeToolPolicyInput {
  return { nativeToolAccess: true, cliParity: parityBypass, permissionMode: parityBypass ? 'bypass' : 'restricted',
    nativeCapabilities: userMcp === undefined ? {} : { userMcp } };
}

function builtArgs(def: (typeof AGENT_DEFS)[number], cell: Cell): readonly string[] {
  const options = { ...policyFor(cell), ...(cell.folderLimit ? { filesystemRoot: FOLDER } : {}) };
  return def.buildArgs({ prompt: 'hello', imagePaths: [] }, { extraAllowedDirs: [], options, runtimeContext: cell.staged ? { mcpJsonPath: STAGED_CONFIG } : {} });
}

const perRunClaims = AGENT_DEFS.filter(def => typeof def.mcpIsolation === 'object');

describe('per-run MCP isolation claims', () => {
  it('the matrix has all 24 cells, including the unset capability', () => {
    expect(CELLS).toHaveLength(24);
    expect(CELLS.filter(cell => cell.userMcp === undefined)).toHaveLength(8);
  });

  it('whenever the plan says a run loads no MCP sources of its own, the built arguments carry the isolation flag', () => {
    const untrue: string[] = [];
    for (const def of perRunClaims) for (const cell of CELLS) {
      const plan = planRun({ def, policy: policyFor(cell) });
      if (plan.verdict !== 'RUN' || plan.loadsOwn) continue;
      if (!builtArgs(def, cell).includes(ISOLATION_FLAG)) untrue.push(`${def.id} userMcp=${String(cell.userMcp)} staged=${cell.staged} parityBypass=${cell.parityBypass} folderLimit=${cell.folderLimit}`);
    }
    expect(untrue).toEqual([]);
  });

  it('a claim names the CLI version it was verified on: <name>@<cli version>@<date>', () => {
    for (const def of perRunClaims) {
      const stamp = typeof def.mcpIsolation === 'object' ? def.mcpIsolation.perRun : '';
      expect(stamp, def.id).toMatch(/^[a-z0-9-]+@\d+\.\d+\.\d+[0-9A-Za-z.+-]*@\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('the Claude definition makes no isolation claim, so a run with the personal-MCP switch off or unset asks first', () => {
    const claude = AGENT_DEFS.find(def => def.id === 'claude')!;
    expect(claude.mcpIsolation).toBeUndefined();
    for (const cell of CELLS.filter(candidate => candidate.userMcp !== true)) {
      expect(planRun({ def: claude, policy: policyFor(cell) }), JSON.stringify(cell)).toMatchObject({ verdict: 'ASK', keys: ['userMcp'] });
    }
    for (const cell of CELLS.filter(candidate => candidate.userMcp === true)) {
      expect(planRun({ def: claude, policy: policyFor(cell) }), JSON.stringify(cell)).toMatchObject({ verdict: 'RUN', loadsOwn: true });
    }
  });

  it('the Claude argument builder leaves the flag out in the cells a blanket claim would have covered', () => {
    const claude = AGENT_DEFS.find(def => def.id === 'claude')!;
    const withoutFlag = CELLS.filter(cell => cell.userMcp !== true && !builtArgs(claude, cell).includes(ISOLATION_FLAG));
    // Unset capability with no folder limit: nothing staged, or staged with parity and bypass mode.
    expect(withoutFlag).toEqual([
      { userMcp: undefined, staged: true, parityBypass: true, folderLimit: false },
      { userMcp: undefined, staged: false, parityBypass: true, folderLimit: false },
      { userMcp: undefined, staged: false, parityBypass: false, folderLimit: false },
    ]);
  });
});
