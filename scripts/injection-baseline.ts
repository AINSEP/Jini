/** One-off maintenance for the injection ratchet. CI never runs this: the debt file only shrinks by hand.
 *   --print-baseline [--lanes <EDGES-sites.tsv>]   every current finding as debt entries (stdout)
 *   --print-test-advisory                          the advisory test-edge count as JSON (stdout) */
import { readFileSync } from 'node:fs';
import { REPO_ROOT } from './lib/walk-imports.js';
import { isMainModule } from './lib/is-main-module.js';
import { sourcePackages } from './lib/package-sources.js';
import { execFileSync } from 'node:child_process';
import { advisoryTestFindings, collectInjectionFindings, liveRuntimePairs } from './lib/injection-gate.js';
import { BOOTSTRAP_RULES, keyOf, loadDebtFile, type DebtEntry, type Finding } from './lib/injection-debt.js';
import { join } from 'node:path';

const OWN_LANES: Readonly<Record<string, string>> = { 'L6-base-purity': 'L-BASE-PURITY', 'L7-css-tokens': 'L-CSS-TOKENS', 'XP4-runtime': 'L-XP4-CONTRACTS' };

/** Lanes already assigned in the checked-in file, by key and (for new keys) by file, so a reseed keeps them. */
function existingLanes(entries: readonly DebtEntry[]): Map<string, string> {
  const lanes = new Map<string, string>();
  for (const entry of entries) {
    lanes.set(keyOf(entry), entry.lane);
    if (entry.lane !== 'unassigned' && !lanes.has(`file\t${entry.file}`)) lanes.set(`file\t${entry.file}`, entry.lane);
  }
  return lanes;
}

/** `file<TAB>spec` -> lane, from the untangle survey; findings it does not know stay "unassigned". */
function laneTable(path: string | undefined): Map<string, string> {
  const lanes = new Map<string, string>();
  if (!path) return lanes;
  for (const line of readFileSync(path, 'utf8').split('\n').slice(1)) {
    const cells = line.split('\t');
    if (cells.length > 10) lanes.set(`${cells[4]}\t${cells[2]}`, cells[10]!);
  }
  return lanes;
}

function laneOf(required: { finding: Finding; lanes: ReadonlyMap<string, string>; kept: ReadonlyMap<string, string> }): string {
  const { finding, lanes, kept } = required;
  return kept.get(keyOf(finding)) ?? lanes.get(`${finding.file}\t${finding.spec}`) ?? OWN_LANES[finding.rule] ?? kept.get(`file\t${finding.file}`) ?? 'unassigned';
}

function toDebt(required: { findings: readonly Finding[]; lanes: ReadonlyMap<string, string>; kept: ReadonlyMap<string, string> }): DebtEntry[] {
  const entries = new Map<string, DebtEntry>();
  for (const finding of required.findings) {
    const key = keyOf(finding);
    const known = entries.get(key);
    if (known) known.count += 1;
    else {
      const lane = laneOf({ finding, lanes: required.lanes, kept: required.kept });
      entries.set(key, { rule: finding.rule, file: finding.file, spec: finding.spec, kind: finding.kind, count: 1, lane });
    }
  }
  return [...entries.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

export function main(argv: readonly string[]): void {
  const root = REPO_ROOT;
  const packages = sourcePackages({ packagesDir: join(root, 'packages') });
  if (argv.includes('--print-test-advisory')) {
    const edges = advisoryTestFindings({ root, packages });
    console.log(JSON.stringify({ _comment: 'Advisory only (owner Q5): cross-package imports in test files besides /testing and /conformance. Not enforced.', files: new Set(edges.map(edge => edge.file)).size, imports: edges.length }, null, 2));
    return;
  }
  const lanePath = argv.includes('--lanes') ? argv[argv.indexOf('--lanes') + 1] : undefined;
  // GC.1: the printed seed always carries metadata. approvedRuntime is seeded from what the base packages'
  // public entries ship now (C1); initialized marks every bootstrap rule as captured (C3).
  const current = loadDebtFile({ root });
  const approvedRuntime = liveRuntimePairs({ root, packages });
  const entries = toDebt({ findings: collectInjectionFindings({ root, packages }, { approvedRuntime }), lanes: laneTable(lanePath), kept: existingLanes(current.entries) });
  const seedSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const metadata = { approvedRuntime, initialized: [...BOOTSTRAP_RULES].sort(), seedSha };
  console.log(JSON.stringify({ _comment: current._comment ?? 'Injection ratchet baseline. Keyed by rule+file+spec+kind; shrink only, never regenerate in CI.', metadata, entries }, null, 2));
}

if (isMainModule({ moduleUrl: import.meta.url, entryPath: process.argv[1] })) main(process.argv.slice(2));
